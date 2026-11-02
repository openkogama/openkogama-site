import math
import sys
import unicodedata
from pathlib import Path

from fontTools.agl import UV2AGL
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from shapely import affinity, bounds, get_parts, intersection, set_precision
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "site" / "fonts"
VERSION = "1.000"

CAP, XH, ASC, DESC = 700, 520, 700, -190
S, H, C = 116, 104, 104
W3 = 2 * S + C
R, TILT, K, SB, GAP, MARK, DD, AX = 28, 0.26, 40, 36, 80, 60, 125, 330
PB, PT = -140, 756
ASCENT, DESCENT = 950, 250
DEPTH, SB_MIN, OVERHANG, SPACE = 64, 8, 15, 210
BAND, CLOSEST, PULL, LIMIT = 50, 40, 0.5, 120
KERNED = ".,:;!?-'\"\u2018\u2019\u201a\u201c\u201d\u201e\u00ab\u00bb\u2039\u203a()[]/\u2013\u2014"
PUNCT = {
    ".,": (20, 26), ":;": (24, 26), "!": (30, 26), "?": (30, 30), "\u00aa\u00ba\u00b9\u00b2\u00b3": (20, 20),
    "'\"\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u2032\u2033": (22, 22),
    "-\u00ad\u2010\u2011\u2012\u2013\u2014\u2015\u2212": (26, 26), "([{": (36, 14), ")]}": (14, 36),
    "/\\|\u00a6\u2044": (14, 14), "\u00ab\u00bb\u2039\u203a": (22, 22), "+=<>\u00d7\u00f7\u00b1\u00ac~^": (34, 34),
    "_": (0, 0), "\u2026": (20, 26),
}


def rect(x0, y0, x1, y1):
    return box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def poly(*points):
    return Polygon(points)


def corner(x, y, dx, dy, k=K):
    e = 4
    return poly((x - dx * e, y - dy * e), (x + dx * (k + e), y - dy * e), (x - dx * e, y + dy * (k + e)))


def notch(x, y, d, depth=0.42 * S, h=0.6 * H):
    return poly((x - d * 4, y - h), (x + d * depth, y), (x - d * 4, y + h))


def band(x0, y0, x1, y1, width, a0=0, a1=0):
    c0, c1 = x0, x1
    for _ in range(8):
        half = width * ((c1 - c0) ** 2 + (y1 - y0) ** 2) ** 0.5 / abs(y1 - y0) / 2
        c0, c1 = x0 + a0 * half, x1 + a1 * half
    return poly((c0 - half, y0), (c0 + half, y0), (c1 + half, y1), (c1 - half, y1))


def slab(x0, y0, x1, y1, h):
    return poly((x0, y0 - h / 2), (x1, y1 - h / 2), (x1, y1 + h / 2), (x0, y0 + h / 2))


def round4(w, t, k=K, b=0):
    return [corner(0, t, 1, -1, k), corner(w, t, -1, -1, k), corner(0, b, 1, 1, k), corner(w, b, -1, 1, k)]


def c3(w):
    return [0, S, w - S, w]


def even(w, step=S):
    n = max(1, round(w / step))
    return [w * i / n for i in range(n + 1)]


def polygons(geom):
    return [p for p in get_parts(geom) if isinstance(p, Polygon) and not p.is_empty]


class Glyph:
    def __init__(self, width, cols=None):
        self.width = width
        self.cols = list(cols) if cols else [0, width]
        self.parts, self.holes, self.extra, self.marks = [], [], [], []

    def add(self, *parts):
        self.parts += parts
        return self

    def sub(self, *holes):
        self.holes += holes
        return self

    def over(self, *parts):
        self.extra += parts
        return self

    def put(self, mark, dx, dy):
        self.marks.append((mark, dx, dy))
        return self

    def flat(self):
        geom = unary_union(self.parts)
        if self.holes:
            geom = geom.difference(unary_union(self.holes))
        if self.extra:
            geom = unary_union([geom, *self.extra])
        return geom

    def widen(self, w):
        self.width = w
        self.cols = sorted({*self.cols, w})
        return self

    def shape(self):
        pieces = []
        if self.parts or self.extra:
            flat = self.flat()
            x0, _, x1, _ = flat.bounds
            cols = sorted({min(x0, self.cols[0]), max(x1, self.cols[-1]), *self.cols[1:-1]})
            for a, b in zip(cols, cols[1:]):
                k = R / (b - a)
                for piece in polygons(flat.intersection(box(a, -4000, b, 4000))):
                    pieces.append(affinity.affine_transform(piece, [1, 0, k + TILT, 1, 0, -k * a - R / 2 - TILT * self.width / 2]))
        for mark, dx, dy in self.marks:
            pieces.append(affinity.translate(mark.shape(), dx, dy + TILT * (dx + mark.width / 2 - self.width / 2)))
        return unary_union(pieces)

    def transform(self, fn, cols):
        g = Glyph(self.width, cols)
        g.parts = [fn(p) for p in self.parts]
        g.holes = [fn(p) for p in self.holes]
        g.extra = [fn(p) for p in self.extra]
        return g

    def mirror(self):
        w = self.width
        return self.transform(lambda p: affinity.scale(p, -1, 1, origin=(w / 2, 0)), [w - c for c in reversed(self.cols)])

    def turn(self, dy=0):
        w = self.width
        return self.transform(lambda p: affinity.translate(affinity.rotate(p, 180, origin=(w / 2, 0)), 0, dy), [w - c for c in reversed(self.cols)])

    def scaled(self, f, dx=0, dy=0):
        g = self.transform(lambda p: affinity.translate(affinity.scale(p, f, f, origin=(0, 0)), dx, dy), [c * f + dx for c in self.cols])
        g.width = self.width * f
        return g

    def merge(self, other, dx=0, dy=0):
        moved = other.transform(lambda p: affinity.translate(p, dx, dy), [c + dx for c in other.cols])
        self.extra += [moved.flat()]
        self.cols = sorted(set(self.cols) | set(moved.cols))
        return self


def A(t=CAP):
    w, m = W3, 0.42 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, t - H, w, t), rect(0, m - H / 2, w, m + H / 2)).sub(corner(0, t, 1, -1, 1.8 * K), corner(w, t, -1, -1, 1.8 * K))


def B(t=CAP):
    w, m = W3, 0.53 * t
    return Glyph(w, c3(w)).add(rect(0, 0, w, t)).sub(rect(S, H, w - S, m - H / 2), rect(S, m + H / 2, w - S, t - H), notch(w, m, -1), corner(w, t, -1, -1), corner(w, 0, -1, 1))


def C_(t=CAP):
    w, e = W3, 0.14 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, 0, w, H), rect(w - S, t - H - e, w, t), rect(w - S, 0, w, H + e)).sub(*round4(w, t))


def D(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(w, t, -1, -1, 1.8 * K), corner(w, 0, -1, 1, 1.8 * K))


def E(t=CAP):
    w, m = W3, 0.5 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, m - H / 2, w - 0.3 * S, m + H / 2), rect(0, 0, w, H))


def F(t=CAP):
    w, m = W3, 0.47 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, m - H / 2, w - 0.3 * S, m + H / 2))


def G(t=CAP):
    w, e, m = W3, 0.14 * t, 0.47 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, 0, w, H), rect(w - S, t - H - e, w, t), rect(w - S, 0, w, m + H / 2), rect(S + 0.45 * C, m - H / 2, w, m + H / 2)).sub(*round4(w, t))


def H_(t=CAP):
    w, m = W3, 0.5 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, m - H / 2, w, m + H / 2))


def I(t=CAP):
    return Glyph(S).add(rect(0, 0, S, t))


def J(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(w - S, 0, w, t), rect(0, 0, w, H), rect(0, 0, S, 0.34 * t)).sub(corner(0, 0, 1, 1), corner(w, 0, -1, 1))


def K_(t=CAP):
    w, m = W3 + 0.15 * S, 0.45 * t
    return Glyph(w, [0, S, w]).add(rect(0, 0, S, t), band(S, m, w, t, 0.86 * S, 0, -1), band(S, m, w, 0, 0.86 * S, 0, -1))


def L(t=CAP):
    w = W3 - 0.1 * C
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, 0, w, H))


def M(t=CAP):
    w = 2 * S + 2.3 * C
    c = w / 2
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), poly((S, t), (w - S, t), (w - S, t - 1.3 * H), (c, 0.4 * t), (S, t - 1.3 * H))).sub(poly((c - 0.55 * (c - S), t + 4), (c + 0.55 * (c - S), t + 4), (c, 0.8 * t)))


def N(t=CAP):
    w = 2 * S + 1.75 * C
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), band(S, t, w - S, 0, 0.72 * S, 1, -1))


def O(t=CAP, w=W3):
    return Glyph(w, c3(w)).add(rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), *round4(w, t))


def P(t=CAP):
    w, m = W3, 0.44 * t
    return Glyph(w, [0, S, w]).add(rect(0, 0, S, t), rect(0, m - H / 2, w, t)).sub(rect(S, m + H / 2, w - S, t - H), corner(w, t, -1, -1), corner(w, m - H / 2, -1, 1))


def Q(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, w, t), rect(S + 0.5 * C, -0.13 * t, w, H)).sub(rect(S, H, w - S, t - H), *round4(w, t)[:3], corner(w, -0.13 * t, -1, 1))


def R_(t=CAP):
    w, m = W3, 0.44 * t
    return Glyph(w, [0, S, w]).add(rect(0, 0, S, t), rect(0, m - H / 2, w, t), band(S + 0.35 * C, m, w, 0, 0.86 * S, 0, -1)).sub(rect(S, m + H / 2, w - S, t - H), corner(w, t, -1, -1))


def S_(t=CAP):
    w, m, e = W3, 0.5 * t, 0.13 * t
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, m - H / 2, S, t), rect(0, m - H / 2, w, m + H / 2), rect(w - S, 0, w, m + H / 2), rect(0, 0, w, H), rect(w - S, t - H - e, w, t), rect(0, 0, S, H + e)).sub(*round4(w, t), corner(0, m - H / 2, 1, 1), corner(w, m + H / 2, -1, -1))


def T(t=CAP):
    w = W3
    a = (w - S) / 2
    return Glyph(w, [0, a, a + S, w]).add(rect(0, t - H, w, t), rect(a, 0, a + S, t))


def U(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, 0, w, H)).sub(corner(0, 0, 1, 1), corner(w, 0, -1, 1))


def vee(w, top, bottom, y):
    c, b = w / 2, w - 2 * S
    return [poly((0, top), (S, top), (S, y), (c + b / 2, bottom), (c - b / 2, bottom), (0, y)), poly((w, top), (w - S, top), (w - S, y), (c - b / 2, bottom), (c + b / 2, bottom), (w, y))]


def V(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(*vee(w, t, 0, 0.38 * t))


def W(t=CAP):
    w = 2 * S + 2.3 * C
    c = w / 2
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), poly((S, 0), (w - S, 0), (w - S, 1.3 * H), (c, 0.6 * t), (S, 1.3 * H))).sub(poly((c - 0.55 * (c - S), -4), (c + 0.55 * (c - S), -4), (c, 0.2 * t)))


def X(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(*vee(w, t, 0.5 * t, 0.74 * t), *vee(w, 0, 0.5 * t, 0.26 * t))


def Y(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(*vee(w, t, 0.44 * t, 0.72 * t), rect(S, 0, w - S, 0.44 * t))


def Z(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, 0, w, H), band(w, t - H, 0, H, 0.9 * S, -1, 1))


def a_(t=XH):
    w, m = W3, 0.52 * t
    return Glyph(w, c3(w)).add(rect(w - S, 0, w, t), rect(0, t - H, w, t), rect(0, 0, w, m + H / 2)).sub(rect(S, H, w - S, m - H / 2), corner(0, 0, 1, 1), corner(0, t, 1, -1))


def b_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, ASC), rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(w, t, -1, -1), corner(w, 0, -1, 1))


def d_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(w - S, 0, w, ASC), rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(0, t, 1, -1), corner(0, 0, 1, 1))


def e_(t=XH):
    w, m = W3, 0.52 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - S, m - H / 2, w, t), rect(0, m - H / 2, w, m + H / 2), rect(0, 0, w, H)).sub(*round4(w, t))


def f_(t=XH, bar=True):
    d = 0.45 * S
    w = d + S + 0.8 * C
    g = Glyph(w, [0, d + S, w]).add(rect(d, 0, d + S, ASC), rect(d, ASC - H, w, ASC), rect(w - 0.7 * S, ASC - H - 0.12 * t, w, ASC)).sub(corner(d, ASC, 1, -1), corner(w, ASC, -1, -1))
    return g.add(rect(0, t - H, d + S + 0.55 * C, t)) if bar else g


def g_(t=XH):
    w, e = W3, 0.13 * t
    return Glyph(w, c3(w)).add(rect(0, 0, w, t), rect(w - S, DESC, w, t), rect(0, DESC, w, DESC + H), rect(0, DESC, S, DESC + H + e)).sub(rect(S, H, w - S, t - H), corner(0, t, 1, -1), corner(0, 0, 1, 1), corner(0, DESC, 1, 1), corner(w, DESC, -1, 1))


def h_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, ASC), rect(0, t - H, w, t), rect(w - S, 0, w, t)).sub(corner(w, t, -1, -1))


def dotless_i(t=XH):
    return Glyph(S).add(rect(0, 0, S, t))


def i_(t=XH):
    return dotless_i(t).add(rect(0, t + GAP, S, t + GAP + H))


def dotless_j(t=XH):
    w = S + 0.6 * C
    return Glyph(w, [0, w - S, w]).add(rect(w - S, DESC, w, t), rect(0, DESC, w, DESC + H)).sub(corner(0, DESC, 1, 1))


def j_(t=XH):
    w = S + 0.6 * C
    return dotless_j(t).add(rect(w - S, t + GAP, w, t + GAP + H))


def k_(t=XH):
    w, m = W3, 0.42 * t
    return Glyph(w, [0, S, w]).add(rect(0, 0, S, ASC), band(S, m, w, t, 0.84 * S, 0, -1), band(S, m, w, 0, 0.84 * S, 0, -1))


def l_(t=XH):
    w = S + 0.55 * C
    return Glyph(w).add(rect(0, 0, S, ASC), rect(0, 0, w, H))


def m_(t=XH):
    q = 0.85 * C
    w = 3 * S + 2 * q
    return Glyph(w, [0, S, S + q, 2 * S + q, w - S, w]).add(rect(0, 0, S, t), rect(S + q, 0, 2 * S + q, t), rect(w - S, 0, w, t), rect(0, t - H, w, t)).sub(corner(w, t, -1, -1))


def n_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - S, 0, w, t)).sub(corner(w, t, -1, -1))


def p_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, DESC, S, t), rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(w, t, -1, -1), corner(w, 0, -1, 1))


def q_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(w - S, DESC, w, t), rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(0, t, 1, -1), corner(0, 0, 1, 1))


def r_(t=XH):
    w = S + 0.95 * C
    return Glyph(w, [0, S, w]).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - 0.7 * S, t - H - 0.1 * t, w, t)).sub(corner(w, t, -1, -1))


def t_(t=XH):
    d = 0.45 * S
    w = d + S + 0.75 * C
    return Glyph(w, [0, d + S, w]).add(rect(d, 0, d + S, 0.88 * ASC), rect(0, t - H, w, t), rect(d, 0, w, H)).sub(corner(d, 0, 1, 1))


def u_(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, 0, w, H)).sub(corner(0, 0, 1, 1))


def y_(t=XH):
    w, e = W3, 0.13 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, 0, w, H), rect(w - S, DESC, w, t), rect(0, DESC, w, DESC + H), rect(0, DESC, S, DESC + H + e)).sub(corner(0, 0, 1, 1), corner(0, DESC, 1, 1), corner(w, DESC, -1, 1))


def zero():
    w, t = W3, CAP
    return Glyph(w, c3(w)).add(rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), *round4(w, t, 1.4 * K)).over(band(S, H - 2, w - S, t - H + 2, 0.4 * S, 1, -1))


def one():
    w, t = W3, CAP
    x = (w - S) / 2 + 0.12 * S
    return Glyph(w, [0, x, x + S, w]).add(rect(x, 0, x + S, t), rect(x - 0.8 * S, t - 1.9 * H, x, t - 0.9 * H), rect(x - 0.8 * S, 0, x + 1.8 * S, H))


def two():
    w, t, m, e = W3, CAP, 0.5 * CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, t - H - e, S, t), rect(w - S, m - H / 2, w, t), rect(0, m - H / 2, w, m + H / 2), rect(0, 0, S, m + H / 2), rect(0, 0, w, H)).sub(corner(0, t, 1, -1), corner(w, t, -1, -1), corner(w, m - H / 2, -1, 1), corner(0, m + H / 2, 1, -1))


def three():
    w, t, m, e = W3, CAP, 0.53 * CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, t - H - e, S, t), rect(0.45 * S, m - H / 2, w, m + H / 2), rect(w - S, 0, w, t), rect(0, 0, w, H), rect(0, 0, S, H + e)).sub(*round4(w, t), notch(w, m, -1))


def four():
    w, t, m = W3, CAP, 0.34 * CAP
    return Glyph(w, [0, w - S, w]).add(rect(w - S, 0, w, t), rect(0, m - H / 2, w, m + H / 2), band(w - 0.3 * S, t, 0, m, 0.9 * S, -1, 1))


def five():
    w, t, m, e = W3, CAP, 0.53 * CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, m - H / 2, S, t), rect(0, m - H / 2, w, m + H / 2), rect(w - S, 0, w, m + H / 2), rect(0, 0, w, H), rect(0, 0, S, H + e)).sub(corner(w, m + H / 2, -1, -1), corner(w, 0, -1, 1), corner(0, 0, 1, 1))


def six():
    w, t, m, e = W3, CAP, 0.5 * CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - S, t - H - e, w, t), rect(0, 0, w, m + H / 2)).sub(rect(S, H, w - S, m - H / 2), *round4(w, t), corner(w, m + H / 2, -1, -1))


def seven():
    w, t, e = W3, CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, t - H - e, S, t), band(w, t - H, 0.32 * w, 0, 0.95 * S, -1, 0)).sub(corner(0, t, 1, -1))


def eight():
    w, t, m = W3, CAP, 0.53 * CAP
    return Glyph(w, c3(w)).add(rect(0, 0, w, t)).sub(rect(S, H, w - S, m - H / 2), rect(S, m + H / 2, w - S, t - H), notch(0, m, 1), notch(w, m, -1), *round4(w, t))


def nine():
    w, t, m, e = W3, CAP, 0.5 * CAP, 0.13 * CAP
    return Glyph(w, c3(w)).add(rect(w - S, 0, w, t), rect(0, 0, w, H), rect(0, 0, S, H + e), rect(0, m - H / 2, w, t)).sub(rect(S, m + H / 2, w - S, t - H), *round4(w, t), corner(0, m - H / 2, 1, 1))


def Be(t=CAP):
    w, m = W3, 0.53 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, 0, w, m + H / 2)).sub(rect(S, H, w - S, m - H / 2), corner(w, m + H / 2, -1, -1), corner(w, 0, -1, 1))


def Ghe(t=CAP, up=False):
    w = W3 - 0.3 * C
    g = Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t))
    return g.add(rect(w - 0.75 * S, t - 1, w, t + 0.14 * t)) if up else g


def De(t=CAP):
    f = 0.45 * S
    w = W3 + f
    return Glyph(w, [0, f + S, w - S, w]).add(rect(f, H, f + S, t), rect(f, t - H, w, t), rect(w - S, 0, w, t), rect(0, -DD, w, H)).sub(rect(0.9 * S, -DD - 4, w - 0.9 * S, 0))


def Zhe(t=CAP):
    a = 2.05 * S
    w, m = 2 * a + S, 0.45 * t
    return Glyph(w, [0, a, a + S, w]).add(rect(a, 0, a + S, t), band(a + S, m, w, t, 0.86 * S, 0, -1), band(a + S, m, w, 0, 0.86 * S, 0, -1), band(a, m, 0, t, 0.86 * S, 0, 1), band(a, m, 0, 0, 0.86 * S, 0, 1))


def Ze(t=CAP):
    w, m, e = W3, 0.53 * t, 0.13 * t
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(0, t - H - e, S, t), rect(0.45 * S, m - H / 2, w, m + H / 2), rect(w - S, 0, w, t), rect(0, 0, w, H), rect(0, 0, S, H + e)).sub(*round4(w, t), notch(w, m, -1))


def Ii(t=CAP):
    w = 2 * S + 1.75 * C
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), band(S, 0, w - S, t, 0.72 * S, 1, -1))


def El(t=CAP):
    f = 0.45 * S
    w = W3 + f
    return Glyph(w, [0, f + S, w - S, w]).add(rect(f, 0, f + S, t), rect(0, 0, f + S, H), rect(f, t - H, w, t), rect(w - S, 0, w, t))


def Pe(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, t - H, w, t))


def Uu(t=CAP):
    w, m, e = W3, 0.46 * t, 0.13 * t
    return Glyph(w, c3(w)).add(rect(0, m - H / 2, S, t), rect(0, m - H / 2, w, m + H / 2), rect(w - S, 0, w, t), rect(0, 0, w, H), rect(0, 0, S, H + e)).sub(corner(0, m - H / 2, 1, 1), corner(0, 0, 1, 1), corner(w, 0, -1, 1))


def Ef(t=CAP, small=False):
    q = 0.8 * C
    w = 3 * S + 2 * q
    c = w / 2
    lo, hi, bottom, top = (0, t, DESC, ASC) if small else (0.12 * t, 0.88 * t, 0, t)
    return Glyph(w, [0, S, c - S / 2, c + S / 2, w - S, w]).add(rect(c - S / 2, bottom, c + S / 2, top), rect(0, lo, w, hi)).sub(rect(S, lo + H, c - S / 2, hi - H), rect(c + S / 2, lo + H, w - S, hi - H), *round4(w, hi, K, lo))


def Tse(t=CAP):
    w, f = W3, 0.42 * S
    return Glyph(w + f, [0, S, w - S, w + f]).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, 0, w + f, H), rect(w + f - 0.9 * S, -DD, w + f, H))


def Dzhe(t=CAP):
    w = W3
    c = w / 2
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(w - S, 0, w, t), rect(0, 0, w, H), rect(c - 0.45 * S, -DD, c + 0.45 * S, H))


def Che(t=CAP):
    w, m = W3, 0.45 * t
    return Glyph(w, c3(w)).add(rect(0, m - H / 2, S, t), rect(0, m - H / 2, w, m + H / 2), rect(w - S, 0, w, t)).sub(corner(0, m - H / 2, 1, 1))


def Sha(t=CAP, tail=False):
    q = C
    w = 3 * S + 2 * q
    f = 0.42 * S if tail else 0
    g = Glyph(w + f, [0, S, S + q, 2 * S + q, w - S, w + f]).add(rect(0, 0, S, t), rect(S + q, 0, 2 * S + q, t), rect(w - S, 0, w, t), rect(0, 0, w + f, H))
    return g.add(rect(w + f - 0.9 * S, -DD, w + f, H)) if tail else g


def bowl(g, x, w, t, m):
    return g.add(rect(x, 0, w, m + H / 2)).sub(rect(x + S, H, w - S, m - H / 2), corner(w, m + H / 2, -1, -1), corner(w, 0, -1, 1))


def Hard(t=CAP):
    f = 0.55 * S
    w = f + W3
    return bowl(Glyph(w, [0, f + S, w - S, w]).add(rect(0, t - H, f + S, t), rect(f, 0, f + S, t)), f, w, t, 0.55 * t)


def Soft(t=CAP):
    w = W3
    return bowl(Glyph(w, c3(w)).add(rect(0, 0, S, t)), 0, w, t, 0.55 * t)


def Yeru(t=CAP):
    v = W3
    w = v + 0.55 * C + S
    return bowl(Glyph(w, [0, S, v - S, v, w - S, w]).add(rect(0, 0, S, t), rect(w - S, 0, w, t)), 0, v, t, 0.55 * t)


def Lje(t=CAP):
    f = 0.45 * S
    x = f + S + C
    w = x + W3
    return bowl(Glyph(w, [0, f + S, x, x + S, w - S, w]).add(rect(f, 0, f + S, t), rect(0, 0, f + S, H), rect(f, t - H, x + S, t), rect(x, 0, x + S, t)), x, w, t, 0.55 * t)


def Nje(t=CAP):
    x = S + C
    w = x + W3
    m = 0.55 * t
    return bowl(Glyph(w, [0, S, x, x + S, w - S, w]).add(rect(0, 0, S, t), rect(0, m - H / 2, x + S, m + H / 2), rect(x, 0, x + S, t)), x, w, t, m)


def Ereversed(t=CAP):
    w, m, e = W3, 0.5 * t, 0.14 * t
    return Glyph(w, c3(w)).add(rect(w - S, 0, w, t), rect(0, t - H, w, t), rect(0, 0, w, H), rect(0, t - H - e, S, t), rect(0, 0, S, H + e), rect(0.4 * S, m - H / 2, w, m + H / 2)).sub(*round4(w, t))


def Ye(t=CAP):
    m = 0.5 * t
    return C_(t).add(rect(0, m - H / 2, W3 - 0.4 * S, m + H / 2))


def Yu(t=CAP):
    x, m = S + 0.5 * C, 0.5 * t
    w = x + W3
    return Glyph(w, [0, S, x + S, w - S, w]).add(rect(0, 0, S, t), rect(S - 1, m - H / 2, x + 1, m + H / 2), rect(x, 0, w, t)).sub(rect(x + S, H, w - S, t - H), corner(x, t, 1, -1), corner(x, 0, 1, 1), corner(w, t, -1, -1), corner(w, 0, -1, 1))


def Ya(t=CAP):
    w, m = W3, 0.44 * t
    return Glyph(w, [0, w - S, w]).add(rect(w - S, 0, w, t), rect(0, m - H / 2, w, t), band(w - S - 0.35 * C, m, 0, 0, 0.86 * S, 0, 1)).sub(rect(S, m + H / 2, w - S, t - H), corner(0, t, 1, -1))


def Dje(t=CAP, hook=True):
    d = 0.45 * S
    w, m = d + W3, 0.56 * t
    g = Glyph(w, [0, d + S, w - S, w]).add(rect(0, t - H, d + S + 0.8 * C, t), rect(d, 0, d + S, t), rect(d, m - H, w, m), rect(w - S, 0, w, m)).sub(corner(w, m, -1, -1))
    return g.add(rect(w - S - 0.55 * C, 0, w, H)) if hook else g


def hbar(t=XH, hook=False):
    d = 0.4 * S
    w, y = d + W3, 0.78 * ASC
    g = Glyph(w, [0, d + S, w - S, w]).add(rect(d, 0, d + S, ASC), rect(0, y - 0.4 * H, d + S + 0.6 * C, y + 0.4 * H), rect(d, t - H, w, t)).sub(corner(w, t, -1, -1))
    return g.add(rect(w - S, DESC, w, t), rect(w - S - 0.6 * C, DESC, w, DESC + H)) if hook else g.add(rect(w - S, 0, w, t))


def Eng(t=CAP):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - S, -DD, w, t), rect(w - S - 0.6 * C, -DD, w, -DD + H)).sub(corner(w, t, -1, -1))


def eng(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(w - S, DESC, w, t), rect(0.45 * S, DESC, w, DESC + H)).sub(corner(w, t, -1, -1))


def AE(t=CAP):
    w, m = W3 + C + 0.4 * S, 0.45 * t
    return Glyph(w, [0, S, S + C, W3, w]).add(rect(0, 0, S, t), rect(S + C, 0, W3, t), rect(0, t - H, w, t), rect(0, m - H / 2, w - 0.3 * S, m + H / 2), rect(S + C, 0, w, H)).sub(corner(0, t, 1, -1, 1.8 * K))


def ae(t=XH):
    q = 0.85 * C
    w, m = 3 * S + 2 * q, 0.52 * t
    return Glyph(w, [0, S, S + q, 2 * S + q, w - S, w]).add(rect(0, t - H, w, t), rect(0, 0, S, m + H / 2), rect(0, m - H / 2, w, m + H / 2), rect(0, 0, w, H), rect(S + q, 0, 2 * S + q, t), rect(w - S, m - H / 2, w, t)).sub(*round4(w, t))


def OE(t=CAP):
    w, m = W3 + C + 0.4 * S, 0.5 * t
    return Glyph(w, [0, S, S + C, W3, w]).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, 0, w, H), rect(S + C, 0, W3, t), rect(S + C, m - H / 2, w - 0.3 * S, m + H / 2)).sub(corner(0, t, 1, -1), corner(0, 0, 1, 1))


def oe(t=XH):
    q = 0.85 * C
    w, m = 3 * S + 2 * q, 0.52 * t
    return Glyph(w, [0, S, S + q, 2 * S + q, w - S, w]).add(rect(0, 0, S, t), rect(0, t - H, w, t), rect(0, 0, w, H), rect(S + q, 0, 2 * S + q, t), rect(w - S, m - H / 2, w, t), rect(S + q, m - H / 2, w, m + H / 2)).sub(*round4(w, t))


def Thorn(t=CAP):
    w, lo, hi = W3, 0.18 * t, 0.82 * t
    return Glyph(w, c3(w)).add(rect(0, 0, S, t), rect(0, lo, w, hi)).sub(rect(S, lo + H, w - S, hi - H), corner(w, hi, -1, -1), corner(w, lo, -1, 1))


def thorn(t=XH):
    w = W3
    return Glyph(w, c3(w)).add(rect(0, DESC, S, ASC), rect(0, 0, w, t)).sub(rect(S, H, w - S, t - H), corner(w, t, -1, -1), corner(w, 0, -1, 1))


def germandbls(t=XH):
    w, m = W3, 0.56 * ASC
    return Glyph(w, c3(w)).add(rect(0, 0, w, ASC)).sub(rect(S, H, w - S, m - H / 2), rect(S, m + H / 2, w - S, ASC - H), rect(S, -4, S + 0.5 * C, H + 4), notch(w, m, -1), corner(w, ASC, -1, -1), corner(0, ASC, 1, -1), corner(w, 0, -1, 1))


def eth(t=XH):
    w = W3
    y = 0.8 * ASC
    return Glyph(w, c3(w)).add(rect(0, 0, w, t), rect(w - S, 0, w, 0.95 * ASC), rect(S + 0.3 * C, y - 0.4 * H, w + 0.3 * S, y + 0.4 * H)).sub(rect(S, H, w - S, t - H), *round4(w, t)[:1], corner(0, 0, 1, 1))


def acute():
    w = 1.5 * S
    return Glyph(w).add(poly((0, 0), (0.75 * S, 0), (w, 115), (w - 0.75 * S, 115)))


def grave():
    w = 1.5 * S
    return Glyph(w).add(poly((w, 0), (w - 0.75 * S, 0), (0, 115), (0.75 * S, 115)))


def circumflex():
    w = 2.2 * S
    return Glyph(w).add(band(0, 0, w / 2, 110, 0.62 * S, 1, 0), band(w, 0, w / 2, 110, 0.62 * S, -1, 0))


def caron():
    w = 2.2 * S
    return Glyph(w).add(band(w / 2, 0, 0, 110, 0.62 * S, 0, 1), band(w / 2, 0, w, 110, 0.62 * S, 0, -1))


def dieresis(w=W3, d=0.95 * S):
    return Glyph(w, [0, d, w - d, w]).add(rect(0, 0, d, 0.9 * H), rect(w - d, 0, w, 0.9 * H))


def dotabove():
    return Glyph(S).add(rect(0, 0, S, 0.9 * H))


def ring():
    w, h = 1.9 * S, 1.65 * H
    return Glyph(w).add(rect(0, 0, w, h)).sub(rect(0.55 * S, 0.5 * H, w - 0.55 * S, h - 0.5 * H))


def tilde():
    w, h, d = 2.4 * S, 92, 0.6 * S
    return Glyph(w).add(band(0, 0, w / 3, h, d, 1, 0), band(w / 3, h, 2 * w / 3, 0, d), band(2 * w / 3, 0, w, h, d, 0, -1))


def macron():
    return Glyph(2.2 * S).add(rect(0, 0, 2.2 * S, 0.85 * H))


def breve():
    w, h = 2.2 * S, 110
    return Glyph(w, [0, 0.62 * S, w - 0.62 * S, w]).add(rect(0, 0, w, 0.55 * H), rect(0, 0, 0.62 * S, h), rect(w - 0.62 * S, 0, w, h))


def doubleacute():
    a, g = 1.2 * S, 0.3 * S
    w = 2 * a + g
    return Glyph(w, [0, a, a + g, w]).add(poly((0, 0), (0.6 * S, 0), (a, 115), (a - 0.6 * S, 115)), poly((a + g, 0), (a + g + 0.6 * S, 0), (w, 115), (w - 0.6 * S, 115)))


def cedilla():
    w = 1.15 * S
    return Glyph(w).add(rect(w - 0.6 * S, -150, w, 0), rect(0, -150, w, -150 + 0.55 * H))


def ogonek():
    w = 1.05 * S
    return Glyph(w).add(rect(0, -160, 0.6 * S, 0), rect(0, -160, w, -160 + 0.55 * H))


def comma_shape(x=0, y=0, s=1.0):
    return [rect(x, y, x + S * s, y + 0.95 * H * s), poly((x + 0.4 * S * s, y), (x + S * s, y), (x + 0.55 * S * s, y - 0.95 * H * s), (x, y - 0.95 * H * s))]


def commabelow():
    return Glyph(0.75 * S).add(*comma_shape(0, -0.6 * H - 50, 0.72))


def commaturned():
    return Glyph(0.75 * S).add(*comma_shape(0, 0.68 * H, 0.72)).turn(1.36 * H)


def caronv():
    return Glyph(0.7 * S).add(*comma_shape(0, 0, 0.7))


TOP = {"\u0300": grave, "\u0301": acute, "\u0302": circumflex, "\u0303": tilde, "\u0304": macron, "\u0306": breve, "\u0307": dotabove, "\u0308": dieresis, "\u030a": ring, "\u030b": doubleacute, "\u030c": caron}
BOTTOM = {"\u0326": commabelow, "\u0327": cedilla, "\u0328": ogonek}
DOTLESS = {"i": "\u0131", "j": "\u0237", "\u0456": "\u0131", "\u0458": "\u0237"}


def dot(x=0, y=0, w=S, h=0.95 * H):
    return rect(x, y, x + w, y + h)


def period():
    return Glyph(S).add(dot())


def comma():
    return Glyph(S).add(*comma_shape())


def colon():
    return Glyph(S).add(dot(), dot(0, XH - 0.95 * H))


def semicolon():
    return Glyph(S).add(*comma_shape(), dot(0, XH - 0.95 * H))


def exclam():
    return Glyph(S).add(rect(0, 1.75 * H, S, CAP), dot())


def question():
    w, t, m, e = W3, CAP, 0.55 * CAP, 0.13 * CAP
    a = (w - S) / 2
    return Glyph(w, [0, a, a + S, w]).add(rect(0, t - H, w, t), rect(0, t - H - e, S, t), rect(w - S, m - H / 2, w, t), rect(a, m - H / 2, w, m + H / 2), rect(a, 1.75 * H, a + S, m), dot(a)).sub(corner(0, t, 1, -1), corner(w, t, -1, -1), corner(w, m - H / 2, -1, 1))


def quotesingle():
    return Glyph(0.8 * S).add(rect(0, 0.66 * CAP, 0.8 * S, CAP))


def quotedbl():
    d, g = 0.8 * S, 0.45 * S
    w = 2 * d + g
    return Glyph(w, [0, d, d + g, w]).add(rect(0, 0.66 * CAP, d, CAP), rect(d + g, 0.66 * CAP, w, CAP))


def quote(n, y, turned=False, s=0.85):
    step = S * s + 0.4 * S
    w = S * s + (n - 1) * step
    cols = sorted({0, w, *[i * step for i in range(n)], *[i * step + S * s for i in range(n)]})
    g = Glyph(w, cols).add(*[p for i in range(n) for p in comma_shape(i * step, 0, s)])
    return (g.turn(0.95 * H * s) if turned else g).transform(lambda p: affinity.translate(p, 0, y), cols)


def chevron(w, y, h, d, flip=False):
    if flip:
        return [band(0, y + h / 2, w, y, d, 1, -1), band(w, y, 0, y - h / 2, d, -1, 1)]
    return [band(w, y + h / 2, 0, y, d, -1, 1), band(0, y, w, y - h / 2, d, 1, -1)]


def guillemet(n, flip=False):
    a = 1.1 * S
    step = a + 0.25 * S
    w = a + (n - 1) * step
    parts = [affinity.translate(p, i * step, 0) for i in range(n) for p in chevron(a, 0.5 * XH, 0.6 * XH, 0.62 * S, flip)]
    return Glyph(w, sorted({0, w, *[i * step for i in range(n)], *[i * step + a for i in range(n)]})).add(*parts)


def bar_y(w, y=0.5 * XH, h=0.9 * H, step=1.5 * S):
    return Glyph(w, even(w, step)).add(rect(0, y - h / 2, w, y + h / 2))


def paren(kind):
    w = 1.65 * S
    g = Glyph(w, [0, S, w]).add(rect(0, PB, S, PT), rect(0, PT - H, w, PT), rect(0, PB, w, PB + H))
    if kind == "paren":
        g.sub(corner(0, PT, 1, -1, 1.7 * K), corner(0, PB, 1, 1, 1.7 * K))
    if kind == "brace":
        m = (PB + PT) / 2
        g = Glyph(w + 0.45 * S, [0, 1.45 * S, w + 0.45 * S]).add(rect(0.45 * S, PB, 1.45 * S, PT), rect(0.45 * S, PT - H, w + 0.45 * S, PT), rect(0.45 * S, PB, w + 0.45 * S, PB + H), rect(0, m - 0.55 * H, 0.5 * S, m + 0.55 * H))
    return g


def slash():
    w = 2.6 * S
    return Glyph(w).add(band(0, PB + 40, w, PT - 40, 0.82 * S, 1, -1))


def plus():
    w = W3
    c = w / 2
    return Glyph(w, [0, c - 0.45 * S, c + 0.45 * S, w]).add(rect(0, AX - 0.45 * H, w, AX + 0.45 * H), rect(c - 0.45 * S, AX - w / 2, c + 0.45 * S, AX + w / 2))


def equal():
    w = W3
    return Glyph(w, c3(w)).add(rect(0, AX + 0.35 * H, w, AX + 1.25 * H), rect(0, AX - 1.25 * H, w, AX - 0.35 * H))


def less(flip=False):
    w = 0.85 * W3
    return Glyph(w).add(*chevron(w, AX, 0.62 * CAP, 0.8 * S, flip))


def multiply():
    w = 0.8 * W3
    return Glyph(w).add(band(0, AX - w / 2, w, AX + w / 2, 0.75 * S, 1, -1), band(w, AX - w / 2, 0, AX + w / 2, 0.75 * S, -1, 1))


def divide():
    w = W3
    c = w / 2
    return Glyph(w, [0, c - 0.45 * S, c + 0.45 * S, w]).add(rect(0, AX - 0.45 * H, w, AX + 0.45 * H), dot(c - 0.45 * S, AX + 0.95 * H, 0.9 * S, 0.85 * H), dot(c - 0.45 * S, AX - 1.8 * H, 0.9 * S, 0.85 * H))


def plusminus():
    w = W3
    c, y = w / 2, AX + 0.6 * H
    return Glyph(w, [0, c - 0.45 * S, c + 0.45 * S, w]).add(rect(0, y - 0.45 * H, w, y + 0.45 * H), rect(c - 0.45 * S, y - 0.4 * w, c + 0.45 * S, y + 0.4 * w), rect(0, y - 0.4 * w - 1.35 * H, w, y - 0.4 * w - 0.45 * H))


def asterisk():
    w = 2.3 * S
    c, y = w / 2, 0.79 * CAP
    return Glyph(w).add(rect(c - 0.4 * S, y - 0.2 * CAP, c + 0.4 * S, y + 0.2 * CAP), slab(0, y - 0.12 * CAP, w, y + 0.12 * CAP, 0.7 * H), slab(0, y + 0.12 * CAP, w, y - 0.12 * CAP, 0.7 * H))


def numbersign():
    w = W3 + 0.4 * S
    d = 0.78 * S
    a, b = 0.22 * w, 0.78 * w
    return Glyph(w, [0, a + d / 2, b - d / 2, w]).add(rect(a - d / 2, 0, a + d / 2, CAP), rect(b - d / 2, 0, b + d / 2, CAP), rect(0, 0.6 * CAP, w, 0.6 * CAP + 0.85 * H), rect(0, 0.26 * CAP, w, 0.26 * CAP + 0.85 * H))


def dollar():
    c = W3 / 2
    return S_(CAP).add(rect(c - 0.38 * S, CAP - 1, c + 0.38 * S, 1.12 * CAP), rect(c - 0.38 * S, -0.12 * CAP, c + 0.38 * S, 1))


def cent():
    c = W3 / 2
    return C_(XH).add(rect(c - 0.38 * S, XH - 1, c + 0.38 * S, XH + 0.2 * XH), rect(c - 0.38 * S, -0.2 * XH, c + 0.38 * S, 1))


def percent():
    bw, bh = 1.45 * S, 0.38 * CAP
    w = W3 + 0.7 * S
    rings = [rect(0, CAP - bh, bw, CAP), rect(w - bw, 0, w, bh)]
    holes = [rect(0.5 * S, CAP - bh + 0.45 * H, bw - 0.5 * S, CAP - 0.45 * H), rect(w - bw + 0.5 * S, 0.45 * H, w - 0.5 * S, bh - 0.45 * H)]
    return Glyph(w, [0, bw, w - bw, w]).add(*rings).sub(*holes).over(band(0.2 * S, 0, w - 0.2 * S, CAP, 0.7 * S, 1, -1))


def ampersand():
    w, m = W3 + 0.5 * S, 0.55 * CAP
    v = w - 0.5 * S
    g = Glyph(w, [0, S, v - S, v, w]).add(rect(0, 0, v, m + H / 2), rect(0.15 * S, m - H / 2, v - 0.15 * S, CAP), rect(v - S, m - H / 2, w, m + H / 2), rect(v - S, 0, w, H))
    return g.sub(rect(S, H, v - S, m - H / 2), rect(1.15 * S, m + H / 2, v - 1.15 * S, CAP - H), corner(0, 0, 1, 1), corner(0, m + H / 2, 1, -1), corner(0.15 * S, CAP, 1, -1), corner(v - 0.15 * S, CAP, -1, -1))


def at():
    w, b, t = W3 + 1.6 * S, -0.1 * CAP, 0.9 * CAP
    sx, sy, ix = 0.78 * S, 0.72 * H, 0.62 * S
    x0, x1, y0, y1 = sx + 0.55 * S, w - sx - 0.3 * S, b + sy + 0.55 * H, t - sy - 0.55 * H
    return Glyph(w, [0, sx, x0 + ix, x1 - ix, x1, w]).add(rect(0, b, w, t)).sub(rect(sx, b + sy, w - sx, t - sy), rect(x1 + 1, b - 4, w + 4, b + sy + 4), *round4(w, t, K, b)).over(rect(x0, y0, x1, y1).difference(rect(x0 + ix, y0 + 0.6 * H, x1 - ix, y1 - 0.6 * H)), rect(x1 - ix, b + 1, x1, y0 + 1))


def asciicircum():
    w = 2.4 * S
    return Glyph(w).add(band(0, 0.55 * CAP, w / 2, CAP, 0.7 * S, 1, 0), band(w, 0.55 * CAP, w / 2, CAP, 0.7 * S, -1, 0))


def asciitilde():
    w, h, d = 3.2 * S, 150, 0.75 * S
    y = AX - h / 2
    return Glyph(w).add(band(0, y, w / 3, y + h, d, 1, 0), band(w / 3, y + h, 2 * w / 3, y, d), band(2 * w / 3, y, w, y + h, d, 0, -1))


def sterling():
    d = 0.4 * S
    w, m = W3 + 0.2 * S, 0.45 * CAP
    return Glyph(w, [0, d + S, w - S, w]).add(rect(d, 0, d + S, CAP), rect(d, CAP - H, w, CAP), rect(w - 0.8 * S, CAP - H - 0.12 * CAP, w, CAP), rect(0, m - H / 2, d + S + 0.7 * C, m + H / 2), rect(0, 0, w, H)).sub(corner(d, CAP, 1, -1), corner(w, CAP, -1, -1))


def yen():
    g = Y()
    c = g.width / 2
    return g.add(rect(c - 1.1 * S, 0.17 * CAP, c + 1.1 * S, 0.17 * CAP + 0.75 * H), rect(c - 1.1 * S, 0.33 * CAP, c + 1.1 * S, 0.33 * CAP + 0.75 * H))


def euro():
    d = 0.45 * S
    g = C_(CAP)
    g = g.transform(lambda p: affinity.translate(p, d, 0), [c + d for c in g.cols])
    g.width += d
    return g.over(rect(0, 0.56 * CAP, d + S + 0.5 * C, 0.56 * CAP + 0.72 * H), rect(0, 0.3 * CAP, d + S + 0.5 * C, 0.3 * CAP + 0.72 * H))


def ruble():
    d = 0.45 * S
    g = P()
    g = g.transform(lambda p: affinity.translate(p, d, 0), [0, *[c + d for c in g.cols]])
    g.width += d
    return g.add(rect(0, 0.17 * CAP, d + S + 0.6 * C, 0.17 * CAP + 0.75 * H), rect(0, 0.44 * CAP - H / 2, d + S, 0.44 * CAP + H / 2))


def degree():
    w, h = 1.9 * S, 0.38 * CAP
    return Glyph(w).add(rect(0, CAP - h, w, CAP)).sub(rect(0.55 * S, CAP - h + 0.5 * H, w - 0.55 * S, CAP - 0.5 * H))


def bullet():
    a = 1.3 * S
    y = 0.5 * XH
    return Glyph(a).add(rect(0, y - a / 2, a, y + a / 2)).sub(*[affinity.translate(p, 0, y - a / 2) for p in round4(a, a, 0.6 * K)])


def ellipsis():
    step = S + 0.45 * S
    w = S + 2 * step
    return Glyph(w, [0, S, step, step + S, 2 * step, w]).add(dot(), dot(step), dot(2 * step))


def dagger(double=False):
    w = W3
    c = w / 2
    g = Glyph(w, [0, c - 0.45 * S, c + 0.45 * S, w]).add(rect(c - 0.45 * S, PB + 40, c + 0.45 * S, CAP), rect(0, 0.68 * CAP, w, 0.68 * CAP + 0.85 * H))
    return g.add(rect(0, 0.18 * CAP, w, 0.18 * CAP + 0.85 * H)) if double else g


def arrow(direction):
    w = 3.2 * S
    hh = 0.27 * CAP
    g = Glyph(w).add(rect(0, AX - 0.45 * H, w - 0.4 * S, AX + 0.45 * H), band(w - 1.6 * S, AX + hh, w, AX, 0.75 * S, 0, -1), band(w, AX, w - 1.6 * S, AX - hh, 0.75 * S, -1, 0))
    if direction == "left":
        return g.mirror()
    if direction in ("up", "down"):
        flat = affinity.rotate(g.flat(), 90 if direction == "up" else -90, origin=(w / 2, AX))
        x0, _, x1, _ = flat.bounds
        return Glyph(x1 - x0, [0, (x1 - x0) / 2, x1 - x0]).add(affinity.translate(flat, -x0, 0))
    return g


def logicalnot():
    w = W3
    return Glyph(w, c3(w)).add(rect(0, AX - 0.45 * H, w, AX + 0.45 * H), rect(w - 0.8 * S, AX - 0.45 * H - 0.16 * CAP, w, AX + 0.45 * H))


def brokenbar():
    return Glyph(0.85 * S).add(rect(0, PB, 0.85 * S, 0.27 * CAP), rect(0, 0.43 * CAP, 0.85 * S, PT))


def section():
    w, e = W3, 0.12 * CAP
    t, b = CAP, PB + 40
    m1, m2 = 0.62 * CAP, 0.22 * CAP
    return Glyph(w, c3(w)).add(rect(0, t - H, w, t), rect(w - S, t - H - e, w, t), rect(0, m2, S, t), rect(0, m1 - H / 2, w, m1 + H / 2), rect(0, m2 - H / 2, w, m2 + H / 2), rect(w - S, b, w, m1), rect(0, b, w, b + H), rect(0, b, S, b + H + e)).sub(corner(0, t, 1, -1), corner(w, t, -1, -1), corner(w, b, -1, 1), corner(0, b, 1, 1))


def paragraph():
    w = W3 + 0.2 * S
    x = w - 2 * 0.75 * S - 0.3 * S
    return Glyph(w, [0, x, x + 0.75 * S, w - 0.75 * S, w]).add(rect(0, 0.4 * CAP, x + 1, CAP), rect(x, PB + 40, x + 0.75 * S, CAP), rect(w - 0.75 * S, PB + 40, w, CAP), rect(x, CAP - H, w, CAP)).sub(corner(0, CAP, 1, -1), corner(0, 0.4 * CAP, 1, 1))


def micro():
    return u_().add(rect(0, DESC, S, 1))


def currency():
    w = W3
    return Glyph(w, c3(w)).add(rect(0.4 * S, AX - 0.45 * w + 0.4 * S, w - 0.4 * S, AX + 0.45 * w - 0.4 * S)).sub(rect(1.15 * S, AX - 0.45 * w + 0.4 * S + 0.75 * H, w - 1.15 * S, AX + 0.45 * w - 0.4 * S - 0.75 * H)).over(*[rect(x, y, x + 0.55 * S, y + 0.55 * S) for x in (0, w - 0.55 * S) for y in (AX - 0.45 * w, AX + 0.45 * w - 0.55 * S)])


def framed(inner):
    w, b, t = W3 + 0.9 * S, -0.05 * CAP, 0.95 * CAP
    small = inner().scaled(0.5)
    return Glyph(w, [0, 0.75 * S, w - 0.75 * S, w]).add(rect(0, b, w, t)).sub(rect(0.75 * S, b + 0.7 * H, w - 0.75 * S, t - 0.7 * H), *round4(w, t, 1.4 * K, b)).merge(small, (w - small.width) / 2, (b + t) / 2 - 0.25 * CAP)


def superior(fn, f=0.52):
    return fn().scaled(f, 0, CAP - f * CAP)


def ordinal(fn):
    g = fn().scaled(0.55, 0, CAP - 0.55 * XH)
    return g.add(rect(0, CAP - 0.55 * XH - 1.0 * H, g.width, CAP - 0.55 * XH - 0.45 * H))


def fraction(top, bottom):
    f = 0.48
    a, b = top().scaled(f, 0, CAP - f * CAP), bottom().scaled(f)
    s = Glyph(1.3 * S).add(band(0, 0, 1.3 * S, CAP, 0.5 * S, 1, -1))
    x = a.width + 0.2 * S
    w = x + s.width + 0.2 * S + b.width
    return Glyph(w, [0]).merge(a).merge(s, x, 0).merge(b, x + s.width + 0.2 * S, 0).widen(w)


def numero():
    n = N()
    w = n.width + 0.3 * S + 1.9 * S
    x = n.width + 0.3 * S
    g = n
    g.width = w
    g.cols = [*n.cols, x, x + 0.6 * S, w - 0.6 * S, w]
    h = 0.42 * CAP
    return g.add(rect(x, CAP - h, w, CAP), rect(x, 0.2 * CAP, w, 0.2 * CAP + 0.75 * H)).sub(rect(x + 0.6 * S, CAP - h + 0.55 * H, w - 0.6 * S, CAP - 0.55 * H))


def trademark():
    t, m = T().scaled(0.5, 0, 0.5 * CAP), M().scaled(0.5, 0, 0.5 * CAP)
    x = t.width + 0.2 * S
    return Glyph(x + m.width, [0]).merge(t).merge(m, x, 0).widen(x + m.width)


def spacing(mark, y=XH + R + MARK):
    m = mark()
    return Glyph(m.width).put(m, 0, y)


def lslash(upper):
    if upper:
        return L().over(slab(-0.35 * S, 0.3 * CAP, S + 0.65 * S, 0.5 * CAP, 0.75 * H))
    return l_().over(slab(-0.35 * S, 0.4 * ASC, S + 0.4 * S, 0.6 * ASC, 0.75 * H))


def dcroat(upper):
    if upper:
        return D().over(rect(-0.3 * S, 0.5 * CAP - 0.4 * H, S + 0.45 * C, 0.5 * CAP + 0.4 * H))
    return d_().over(rect(W3 - S - 0.55 * C, 0.8 * ASC - 0.4 * H, W3 + 0.3 * S, 0.8 * ASC + 0.4 * H))


def hstroke(upper):
    if upper:
        return H_().over(rect(-0.25 * S, 0.76 * CAP - 0.4 * H, W3 + 0.25 * S, 0.76 * CAP + 0.4 * H))
    return hbar()


def tbar(upper):
    if upper:
        a = (W3 - S) / 2
        return T().over(rect(a - 0.6 * C, 0.42 * CAP - 0.4 * H, a + S + 0.6 * C, 0.42 * CAP + 0.4 * H))
    return t_().over(rect(0, 0.3 * XH - 0.4 * H, 0.45 * S + S + 0.75 * C, 0.3 * XH + 0.4 * H))


def ldot(upper):
    if upper:
        return L().add(dot(S + 0.55 * C, 0.42 * CAP, 0.85 * S, 0.85 * H))
    g = l_()
    g.width = S + 0.55 * C + 0.3 * S + 0.85 * S
    g.cols = [0, S + 0.55 * C, g.width]
    return g.add(dot(S + 0.55 * C + 0.3 * S, 0.42 * XH, 0.85 * S, 0.85 * H))


def ij(upper):
    if upper:
        j = J()
        x = S + 0.45 * S
        return I().merge(j, x, 0).widen(x + j.width)
    j = j_()
    x = S + 0.4 * S
    return i_().merge(j, x, 0).widen(x + j.width)


def oslash(upper):
    t = CAP if upper else XH
    return O(t).over(band(-0.2 * S, -0.06 * t, W3 + 0.2 * S, 1.06 * t, 0.5 * S, 1, -1))


def kra():
    return K_(XH)


BASE = {
    "A": A, "B": B, "C": C_, "D": D, "E": E, "F": F, "G": G, "H": H_, "I": I, "J": J, "K": K_, "L": L, "M": M,
    "N": N, "O": O, "P": P, "Q": Q, "R": R_, "S": S_, "T": T, "U": U, "V": V, "W": W, "X": X, "Y": Y, "Z": Z,
    "a": a_, "b": b_, "c": lambda: C_(XH), "d": d_, "e": e_, "f": f_, "g": g_, "h": h_, "i": i_, "j": j_, "k": k_,
    "l": l_, "m": m_, "n": n_, "o": lambda: O(XH), "p": p_, "q": q_, "r": r_, "s": lambda: S_(XH), "t": t_, "u": u_,
    "v": lambda: V(XH), "w": lambda: W(XH), "x": lambda: X(XH), "y": y_, "z": lambda: Z(XH),
    "0": zero, "1": one, "2": two, "3": three, "4": four, "5": five, "6": six, "7": seven, "8": eight, "9": nine,
    "\u0131": dotless_i, "\u0237": dotless_j,
    "\u00c6": AE, "\u00e6": ae, "\u0152": OE, "\u0153": oe, "\u00de": Thorn, "\u00fe": thorn, "\u00df": germandbls,
    "\u00f0": eth, "\u00d0": lambda: dcroat(True), "\u0110": lambda: dcroat(True), "\u0111": lambda: dcroat(False),
    "\u0126": lambda: hstroke(True), "\u0127": lambda: hstroke(False), "\u0141": lambda: lslash(True), "\u0142": lambda: lslash(False),
    "\u0166": lambda: tbar(True), "\u0167": lambda: tbar(False), "\u013f": lambda: ldot(True), "\u0140": lambda: ldot(False),
    "\u0132": lambda: ij(True), "\u0133": lambda: ij(False), "\u00d8": lambda: oslash(True), "\u00f8": lambda: oslash(False),
    "\u0138": kra, "\u014a": Eng, "\u014b": eng, "\u017f": lambda: f_(XH, False),
    "\u0410": A, "\u0411": Be, "\u0412": B, "\u0413": Ghe, "\u0414": De, "\u0415": E, "\u0416": Zhe, "\u0417": Ze,
    "\u0418": Ii, "\u041a": K_, "\u041b": El, "\u041c": M, "\u041d": H_, "\u041e": O, "\u041f": Pe, "\u0420": P,
    "\u0421": C_, "\u0422": T, "\u0423": Uu, "\u0424": Ef, "\u0425": X, "\u0426": Tse, "\u0427": Che, "\u0428": Sha,
    "\u0429": lambda: Sha(CAP, True), "\u042a": Hard, "\u042b": Yeru, "\u042c": Soft, "\u042d": Ereversed, "\u042e": Yu,
    "\u042f": Ya, "\u0402": Dje, "\u0404": Ye, "\u0405": S_, "\u0406": I, "\u0408": J, "\u0409": Lje, "\u040a": Nje,
    "\u040b": lambda: Dje(CAP, False), "\u040f": Dzhe, "\u0490": lambda: Ghe(CAP, True),
    "\u0430": a_, "\u0431": lambda: b_().add(rect(0, ASC - H, W3 - 0.1 * C, ASC)), "\u0432": lambda: B(XH),
    "\u0433": lambda: Ghe(XH), "\u0434": lambda: De(XH), "\u0435": e_, "\u0436": lambda: Zhe(XH), "\u0437": lambda: Ze(XH),
    "\u0438": lambda: Ii(XH), "\u043a": lambda: K_(XH), "\u043b": lambda: El(XH), "\u043c": lambda: M(XH), "\u043d": lambda: H_(XH),
    "\u043e": lambda: O(XH), "\u043f": lambda: Pe(XH), "\u0440": p_, "\u0441": lambda: C_(XH), "\u0442": lambda: T(XH),
    "\u0443": y_, "\u0444": lambda: Ef(XH, True), "\u0445": lambda: X(XH), "\u0446": lambda: Tse(XH), "\u0447": lambda: Che(XH),
    "\u0448": lambda: Sha(XH), "\u0449": lambda: Sha(XH, True), "\u044a": lambda: Hard(XH), "\u044b": lambda: Yeru(XH),
    "\u044c": lambda: Soft(XH), "\u044d": lambda: Ereversed(XH), "\u044e": lambda: Yu(XH), "\u044f": lambda: Ya(XH),
    "\u0452": lambda: hbar(XH, True), "\u0454": lambda: Ye(XH), "\u0455": lambda: S_(XH), "\u0456": i_, "\u0458": j_,
    "\u0459": lambda: Lje(XH), "\u045a": lambda: Nje(XH), "\u045b": hbar, "\u045f": lambda: Dzhe(XH), "\u0491": lambda: Ghe(XH, True),
}

SYMBOLS = {
    ".": period, ",": comma, ":": colon, ";": semicolon, "!": exclam, "?": question,
    "'": quotesingle, '"': quotedbl, "-": lambda: bar_y(1.75 * S), "\u00ad": lambda: bar_y(1.75 * S),
    "\u2010": lambda: bar_y(1.75 * S), "\u2011": lambda: bar_y(1.75 * S), "\u2012": lambda: bar_y(W3),
    "\u2013": lambda: bar_y(3.7 * S), "\u2014": lambda: bar_y(7.4 * S), "\u2015": lambda: bar_y(7.4 * S), "\u2212": lambda: bar_y(W3, AX),
    "_": lambda: bar_y(W3, -0.85 * H, 1.0 * H), "(": lambda: paren("paren"), ")": lambda: paren("paren").mirror(),
    "[": lambda: paren("bracket"), "]": lambda: paren("bracket").mirror(), "{": lambda: paren("brace"), "}": lambda: paren("brace").mirror(),
    "/": slash, "\\": lambda: slash().mirror(), "|": lambda: Glyph(0.85 * S).add(rect(0, PB, 0.85 * S, PT)), "\u00a6": brokenbar,
    "+": plus, "=": equal, "<": less, ">": lambda: less(True), "*": asterisk, "#": numbersign, "$": dollar, "%": percent,
    "&": ampersand, "@": at, "^": asciicircum, "~": asciitilde, "`": lambda: spacing(grave, 0.62 * CAP),
    "\u00a1": lambda: exclam().turn(XH), "\u00bf": lambda: question().turn(XH), "\u00a2": cent, "\u00a3": sterling,
    "\u00a4": currency, "\u00a5": yen, "\u00a7": section, "\u00a8": lambda: spacing(dieresis), "\u00a9": lambda: framed(C_),
    "\u00aa": lambda: ordinal(a_), "\u00ba": lambda: ordinal(lambda: O(XH)), "\u00ab": lambda: guillemet(2), "\u00bb": lambda: guillemet(2, True),
    "\u2039": lambda: guillemet(1), "\u203a": lambda: guillemet(1, True), "\u00ac": logicalnot, "\u00ae": lambda: framed(R_),
    "\u00af": lambda: spacing(macron), "\u00b0": degree, "\u00b1": plusminus, "\u00b2": lambda: superior(two),
    "\u00b3": lambda: superior(three), "\u00b9": lambda: superior(one), "\u00b4": lambda: spacing(acute), "\u00b5": micro,
    "\u00b6": paragraph, "\u00b7": lambda: Glyph(S).add(dot(0, AX - 0.475 * H)), "\u00b8": lambda: spacing(cedilla, 0),
    "\u00bc": lambda: fraction(one, four), "\u00bd": lambda: fraction(one, two), "\u00be": lambda: fraction(three, four),
    "\u00d7": multiply, "\u00f7": divide, "\u02c6": lambda: spacing(circumflex), "\u02c7": lambda: spacing(caron),
    "\u02d8": lambda: spacing(breve), "\u02d9": lambda: spacing(dotabove), "\u02da": lambda: spacing(ring),
    "\u02db": lambda: spacing(ogonek, 0), "\u02dc": lambda: spacing(tilde), "\u02dd": lambda: spacing(doubleacute),
    "\u2018": lambda: quote(1, CAP - 0.95 * H * 0.85 * 2, True), "\u2019": lambda: quote(1, CAP - 0.95 * H * 0.85),
    "\u201a": lambda: quote(1, 0), "\u201b": lambda: quote(1, CAP - 0.95 * H * 0.85 * 2, True),
    "\u201c": lambda: quote(2, CAP - 0.95 * H * 0.85 * 2, True), "\u201d": lambda: quote(2, CAP - 0.95 * H * 0.85),
    "\u201e": lambda: quote(2, 0), "\u2020": dagger, "\u2021": lambda: dagger(True), "\u2022": bullet, "\u2026": ellipsis,
    "\u2032": quotesingle, "\u2033": quotedbl, "\u2044": slash, "\u20ac": euro, "\u20bd": ruble, "\u2116": numero,
    "\u2122": trademark, "\u2190": lambda: arrow("left"), "\u2191": lambda: arrow("up"), "\u2192": lambda: arrow("right"),
    "\u2193": lambda: arrow("down"),
}


def composed(ch):
    parts = unicodedata.decomposition(ch).split()
    if len(parts) != 2 or parts[0].startswith("<"):
        return None
    base, mark = chr(int(parts[0], 16)), chr(int(parts[1], 16))
    base = DOTLESS.get(base, base)
    if base not in BASE or (mark not in TOP and mark not in BOTTOM):
        return None
    g = BASE[base]()
    x0, _, x1, y1 = g.flat().bounds
    if mark == "\u030c" and base in "dlLt":
        m = caronv()
        x = {"d": x1 + 0.25 * S, "l": S + 0.3 * S, "L": S + 0.35 * S, "t": 0.45 * S + S + 0.3 * S}[base]
        return g.put(m, x, (ASC if base != "t" else 0.88 * ASC) - 0.95 * H * 0.7)
    if mark == "\u0327" and base in "GKLNRgklnr":
        if base == "g":
            m = commaturned()
            return g.put(m, (x0 + x1) / 2 - m.width / 2, XH + R + MARK)
        mark = "\u0326"
    if mark in TOP:
        m = dieresis(2.3 * S, 0.85 * S) if mark == "\u0308" and x1 - x0 < 2 * S else TOP[mark]()
        return g.put(m, (x0 + x1) / 2 - m.width / 2, y1 + R + MARK)
    m = BOTTOM[mark]()
    if mark == "\u0328":
        return g.put(m, x1 - 0.6 * S, 0)
    if mark == "\u0327":
        return g.put(m, (x0 + x1) / 2 - (m.width - 0.3 * S), 0)
    return g.put(m, (x0 + x1) / 2 - m.width / 2, 0)


def notdef():
    return Glyph(W3, c3(W3)).add(rect(0, 0, W3, CAP)).sub(rect(0.45 * S, 0.4 * H, W3 - 0.45 * S, CAP - 0.4 * H))


def characters():
    table = {}
    for ch in list(BASE) + list(SYMBOLS):
        table[ch] = BASE.get(ch) or SYMBOLS[ch]
    for cp in [*range(0xC0, 0x180), 0x218, 0x219, 0x21A, 0x21B, *range(0x400, 0x460)]:
        ch = chr(cp)
        if ch not in table and unicodedata.category(ch).startswith("L") and composed(ch) is not None:
            table[ch] = lambda ch=ch: composed(ch)
    return table


def glyph_name(cp):
    if cp <= 0x24F or 0x2000 <= cp <= 0x2122:
        return UV2AGL.get(cp, f"uni{cp:04X}")
    return f"uni{cp:04X}"


def outline(geom, dx):
    pen = TTGlyphPen(None)
    geom = set_precision(affinity.translate(geom, dx, 0), 1)
    for p in polygons(geom):
        p = orient(p.simplify(0), -1.0)
        for ring in [p.exterior, *p.interiors]:
            points = [(int(round(x)), int(round(y))) for x, y in ring.coords[:-1]]
            if len(points) < 3:
                continue
            pen.moveTo(points[0])
            for point in points[1:]:
                pen.lineTo(point)
            pen.closePath()
    return pen.glyph()


def scan(geom, y0, y1, step=8):
    ys = range(int(y0), int(y1) + 1, step)
    found = bounds(intersection(geom, [LineString([(-4000, y), (4000, y)]) for y in ys]))
    return [(None, None) if math.isnan(x0) else (x0, x1) for x0, _, x1, _ in found]


def fit(g, ch, geom):
    gx0, _, gx1, _ = geom.bounds
    flat = g.flat() if g.parts or g.extra else geom
    x0, _, x1, _ = flat.bounds
    if unicodedata.category(ch or " ") not in ("Lu", "Ll", "Lo", "Nd") or ch in "\u00aa\u00ba":
        lsb, rsb = next((v for k, v in PUNCT.items() if ch and ch in k), (30, 30))
        left, right = x0 - lsb, x1 + rsb
    else:
        rows = scan(flat, 0, XH if unicodedata.category(ch) == "Ll" else CAP)
        xl = min(l for l, _ in rows if l is not None)
        xr = max(r for _, r in rows if r is not None)
        wl = sum(DEPTH if l is None else min(l - xl, DEPTH) for l, _ in rows) / len(rows)
        wr = sum(DEPTH if r is None else min(xr - r, DEPTH) for _, r in rows) / len(rows)
        left, right = xl - max(SB - wl, SB_MIN), xr + max(SB - wr, SB_MIN)
    return min(left, gx0 + OVERHANG), max(right, gx1 - OVERHANG)


def sides(geom):
    rows = scan(geom, -260, 1020, 10)
    reach = BAND // 10
    right = [max((r for _, r in rows[max(0, i - reach):i + reach + 1] if r is not None), default=None) for i in range(len(rows))]
    return [l for l, _ in rows], right


def kern_value(gap):
    k = CLOSEST - gap if gap < CLOSEST else -(gap - 2 * SB) * PULL if gap > 2 * SB else 0
    k = int(round(k / 10)) * 10
    return max(k, -LIMIT) if abs(k) >= 20 else 0


def kern_feature(edges):
    names = sorted(edges)
    values = {}
    for a in names:
        advance, _, right = edges[a]
        for b in names:
            gaps = [advance - r + l for r, l in zip(right, edges[b][1]) if r is not None and l is not None]
            if gaps and (k := kern_value(min(gaps))):
                values[a, b] = k
    rows, cols = {}, {}
    for a in names:
        rows.setdefault(tuple(values.get((a, b), 0) for b in names), []).append(a)
    for b in names:
        cols.setdefault(tuple(values.get((a, b), 0) for a in names), []).append(b)
    lefts = [members for key, members in rows.items() if any(key)]
    rights = [members for key, members in cols.items() if any(key)]
    lines = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", "languagesystem cyrl dflt;"]
    lines += [f"@L{i} = [{' '.join(m)}];" for i, m in enumerate(lefts)]
    lines += [f"@R{j} = [{' '.join(m)}];" for j, m in enumerate(rights)]
    lines.append("feature kern {")
    lines += [f"    pos @L{i} @R{j} {values[lm[0], rm[0]]};" for i, lm in enumerate(lefts) for j, rm in enumerate(rights) if (lm[0], rm[0]) in values]
    lines.append("} kern;")
    return "\n".join(lines)


def build():
    shapes = {".notdef": (notdef(), None), "space": (None, None)}
    cmap = {0x20: "space", 0xA0: "space"}
    for ch, fn in sorted(characters().items(), key=lambda item: ord(item[0])):
        name = glyph_name(ord(ch))
        if name not in shapes:
            shapes[name] = (fn(), ch)
        cmap[ord(ch)] = name
    glyphs, metrics, edges, top, bottom = {}, {}, {}, 0, 0
    for name, (g, ch) in shapes.items():
        if g is None:
            glyphs[name] = TTGlyphPen(None).glyph()
            metrics[name] = (SPACE, 0)
            continue
        geom = g.shape()
        left, right = fit(g, ch, geom)
        glyphs[name] = outline(geom, -left)
        xs = [x for x, _ in glyphs[name].coordinates] if glyphs[name].numberOfContours > 0 else [0]
        metrics[name] = (int(round(right - left)), min(xs))
        if unicodedata.category(ch or " ") in ("Lu", "Ll", "Lo", "Nd") or (ch and ch in KERNED):
            edges[name] = (metrics[name][0], *sides(affinity.translate(geom, -left, 0)))
        top, bottom = max(top, geom.bounds[3]), min(bottom, geom.bounds[1])
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(list(shapes))
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT, lineGap=0)
    fb.setupNameTable({"familyName": "OpenKogama", "styleName": "Regular", "uniqueFontIdentifier": f"OpenKogama-Regular-{VERSION}", "fullName": "OpenKogama", "psName": "OpenKogama-Regular", "version": f"Version {VERSION}"})
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=-DESCENT, sTypoLineGap=0, usWinAscent=max(ASCENT, int(top) + 10), usWinDescent=max(DESCENT, int(-bottom) + 10), sxHeight=XH, sCapHeight=CAP, achVendID="OKGM", fsType=0, fsSelection=0x40 | 0x80, usWeightClass=400, version=4)
    fb.setupPost()
    addOpenTypeFeaturesFromString(fb.font, kern_feature(edges))
    head = fb.font["head"]
    head.fontRevision = float(VERSION)
    head.created = head.modified = timestampFromString("Mon Nov  2 00:00:00 2026")
    os2 = fb.font["OS/2"]
    os2.recalcUnicodeRanges(fb.font)
    os2.recalcCodePageRanges(fb.font)
    gasp = newTable("gasp")
    gasp.version = 1
    gasp.gaspRange = {0xFFFF: 0x000F}
    fb.font["gasp"] = gasp
    return fb.font


def main():
    font = build()
    font.recalcTimestamp = False
    if len(sys.argv) > 1:
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        font.save(out / "OpenKogama.ttf")
        font = TTFont(out / "OpenKogama.ttf", recalcTimestamp=False)
    else:
        out = FONTS
    font.flavor = "woff2"
    font.save(out / "OpenKogama.woff2")


if __name__ == "__main__":
    main()
