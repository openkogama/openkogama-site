const SIZE = 24;
const BINS = 24;

const sampler = typeof document === "undefined" ? new OffscreenCanvas(SIZE, SIZE) : document.createElement("canvas");
sampler.width = sampler.height = SIZE;
const context = sampler.getContext("2d", { willReadFrequently: true });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const linear = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const encode = c => Math.round(255 * clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1));

function oklab(r, g, b) {
  r = linear(r);
  g = linear(g);
  b = linear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function rgb(lightness, chroma, hue) {
  const a = chroma * Math.cos(hue), b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `rgb(${red} ${green} ${blue})`;
}

export function tint(source) {
  context.clearRect(0, 0, SIZE, SIZE);
  context.drawImage(source, 0, 0, SIZE, SIZE);
  const data = context.getImageData(0, 0, SIZE, SIZE).data;
  const chroma = new Float64Array(BINS), weights = new Float64Array(BINS);
  const sumA = new Float64Array(BINS), sumB = new Float64Array(BINS);
  let weight = 0, lightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.5) continue;
    const [l, a, b] = oklab(data[i], data[i + 1], data[i + 2]);
    const c = Math.hypot(a, b);
    weight += alpha;
    lightness += l * alpha;
    if (c < 0.03) continue;
    const bin = Math.floor((Math.atan2(b, a) / (2 * Math.PI) + 1) % 1 * BINS) % BINS;
    chroma[bin] += c * alpha;
    weights[bin] += alpha;
    sumA[bin] += a * alpha;
    sumB[bin] += b * alpha;
  }
  if (!weight) return null;

  let best = 0;
  for (let i = 1; i < BINS; i++) if (chroma[i] > chroma[best]) best = i;
  let a = 0, b = 0, c = 0, w = 0;
  for (const i of [best - 1, best, best + 1].map(i => (i + BINS) % BINS)) {
    a += sumA[i];
    b += sumB[i];
    c += chroma[i];
    w += weights[i];
  }
  const coverage = w / weight;
  const neutral = coverage < 0.2;
  const hue = neutral ? 0 : Math.atan2(b, a);
  const strength = neutral ? 0 : clamp(c / w * 0.4 * Math.min(1, coverage * 2), 0.025, 0.07);
  const level = clamp(0.6 - 0.5 * lightness / weight, 0.25, 0.5);
  return { background: rgb(level, strength, hue), edge: rgb(level + 0.08, neutral ? 0 : strength + 0.01, hue) };
}
