import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
SOURCE = "https://cdn.openkogama.org/maps/v1/"
ADDRESS = "https://openkogama.org/maps/"
SHARDS = 256
MIN_PLAYS = 1000
NEED_IMAGE = True
DUPLICATE_PLAYS = 1000
OTHERS = 4
DESCRIPTION = 5000
PLACEHOLDERS = {"untitled", "untitled map", "closed", "deleted", "test", "error 404"}
FILLERS = "ᅟᅠㅤﾠ⠀­​"
RUDE_WORDS = {"amk", "ass", "cipa", "cock", "culo", "dick", "huy", "rape", "sex", "sexy", "suka", "tits"}
RUDE_STARTS = (
    "fuck", "shit", "bitch", "cunt", "nigg", "fagg", "whore", "slut", "porn", "hentai", "pussy", "penis", "vagin", "boob", "nude", "naked",
    "porra", "caralh", "buceta", "foder", "foda", "merda", "puta", "viado", "piroca", "punheta", "xoxota", "arrombad",
    "mierda", "pendej", "cabron", "joder", "verga", "chinga", "maricon", "gilipoll",
    "kurw", "pierdol", "jeba", "jebi", "chuj", "huj", "pizd", "kutas", "dziwk",
    "orospu", "siktir", "sikis", "siker", "yarra", "pezevenk", "kahpe", "ibne",
    "blyat", "blyad", "pidor", "nahui", "хуи", "хуе", "пизд", "ебан", "ебат", "ебал", "бля", "сука", "пидор", "мудак", "шлюх", "залуп", "гандон",
)
RUDE_PARTS = ("fuck", "kurw", "pierd", "jeb", "пизд")


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "openkogama-site"})
    return json.load(urllib.request.urlopen(request, timeout=120))


def fnv(text):
    value = 2166136261
    for byte in text.encode():
        value = (value ^ byte) * 16777619 & 0xFFFFFFFF
    return value


def fold(text):
    return "".join(char for char in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(char))


def real(name):
    text = "".join(char for char in name if char not in FILLERS).strip()
    return any(char.isalnum() for char in text) and text.lower().rstrip(".!? ") not in PLACEHOLDERS


def rude(name):
    words = re.findall(r"\w+", fold(name))
    return any(word in RUDE_WORDS or word.startswith(RUDE_STARTS) or any(part in word for part in RUDE_PARTS) for word in words)


def indexed(row):
    name = row["name"] or ""
    return bool(row["image"] or not NEED_IMAGE) and (row["plays"] or 0) >= MIN_PLAYS and real(name) and not rude(name)


def order(row):
    return (not row["image"], -(row["versions"] or 1), row["format"] != "kgmap", not row["name"], row["position"])


def base(row):
    if row["id"]:
        return f"{row['site']}-{row['id']}" if row["site"] else row["id"]
    return "f-%08x" % fnv(f"{row['format']}:{row['size']}:{row['name'] or ''}")


def author(row):
    if row["authorId"]:
        return f"{row['site']}:{row['authorId']}"
    return f"name:{row['author']}" if row["author"] else ""


def keys(rows):
    groups = {}
    for row in rows:
        groups.setdefault(base(row), []).append(row)
    for key, group in groups.items():
        for index, row in enumerate(sorted(group, key=order)):
            row["slug"] = f"{key}-{row['size']}" if index else key


def twins(rows):
    parent = list(range(len(rows)))

    def root(at):
        while parent[at] != at:
            at = parent[at]
        return at

    seen = {}
    for row in rows:
        marks = [("id", row["site"], row["id"])] if row["id"] else []
        who = ("id", row["authorId"]) if row["authorId"] else ("name", row["author"])
        if (row["plays"] or 0) >= DUPLICATE_PLAYS and who[1]:
            marks.append((who, row["plays"], row["likes"]))
        for mark in marks:
            if mark in seen:
                parent[root(row["position"])] = root(seen[mark])
            else:
                seen[mark] = row["position"]
    groups = {}
    for row in rows:
        groups.setdefault(root(row["position"]), []).append(row)
    for group in groups.values():
        main = min(group, key=order)
        for row in group:
            row["main"] = main


def record(row, detail, others):
    description, created, _, versions = detail
    main = row["main"]
    data = {
        "name": row["name"],
        "author": row["author"],
        "authorId": row["authorId"],
        "site": row["site"],
        "id": row["id"],
        "plays": row["plays"],
        "likes": row["likes"],
        "created": (created or "")[:10],
        "published": row["published"],
        "image": row["image"],
        "format": row["format"],
        "size": row["size"],
        "url": versions[0][5][0],
        "description": (description or "").strip()[:DESCRIPTION],
        "others": [[other["slug"], other["name"], other["image"], other["plays"]] for other in others if other is not main][:OTHERS],
        "canonical": "" if main is row else main["slug"],
        "index": indexed(main),
    }
    return {key: value for key, value in data.items() if value not in ("", None, [])}


latest = fetch(SOURCE + "latest.json")
build = f"{SOURCE}builds/{latest['build']}/"
index = fetch(build + latest["index"]["path"])
rows = [dict(zip(index["fields"], row), position=position) for position, row in enumerate(index["rows"])]
per = latest["details"]["perFile"]
details = []
for number in range((len(rows) + per - 1) // per):
    details += fetch(f"{build}{latest['details']['path']}{number:03x}.json")

keys(rows)
if len({row["slug"] for row in rows}) != len(rows):
    sys.exit("map keys are not unique")
twins(rows)

lists = {}
for row in sorted(rows, key=lambda row: (-(row["plays"] or 0), row["position"])):
    if row["main"] is row and author(row):
        lists.setdefault(author(row), []).append(row)

shards = [{} for _ in range(SHARDS)]
for row, detail in zip(rows, details):
    shards[fnv(row["slug"]) % SHARDS][row["slug"]] = record(row, detail, lists.get(author(row), [])[:OTHERS + 1])
folder = SITE / "maps" / "pages"
folder.mkdir(exist_ok=True)
for number, shard in enumerate(shards):
    (folder / f"{number:02x}.json").write_text(json.dumps(dict(sorted(shard.items())), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

listed = [row["slug"] for row in rows if row["main"] is row and indexed(row)]
urls = "".join(f"  <url><loc>{ADDRESS}{slug}/</loc></url>\n" for slug in listed)
(SITE / "sitemap-maps.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n', encoding="utf-8", newline="\n")
print(latest["build"], len(rows), "maps,", len(listed), "in the sitemap")
