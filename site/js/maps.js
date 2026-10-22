import { liked, likedList, mapKey, toggle } from "./likes.js";

const DATA = new URL(new URLSearchParams(location.search).get("data") || "https://cdn.openkogama.org/maps/v1/", location.href).href;
const CONTENTS = { models: "https://cdn.openkogama.org/models/v2/", avatars: "https://cdn.openkogama.org/avatars/v1/" };
const PAGE = 60;
const REGIONS = { www: "maps.regions.www", br: "maps.regions.br", friends: "maps.regions.friends" };
const NAMES = { models: "common.nav.models", avatars: "common.nav.avatars" };
const HOSTS = { www: "www.kogama.com", br: "kogama.com.br", friends: "friends.kogama.com" };
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

const list = document.getElementById("list");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const search = document.getElementById("search");
const region = document.getElementById("region");
const sort = document.getElementById("sort");
const favoritesButton = document.getElementById("favorites");
const favoritesCount = favoritesButton.querySelector(".count");
const authorButton = document.getElementById("author");
let favorites = location.hash === "#liked";
let author = "";
const sentinel = document.createElement("div");
sentinel.className = "sentinel";
list.after(sentinel);

let latest, base, images, maps = [], results = [], shown = 0;
let contents = Promise.resolve(null);
const details = new Map();

const fold = text => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/g, "l");
const bare = text => text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function readState() {
  const query = new URLSearchParams(location.search);
  search.value = query.get("q") || "";
  region.value = query.get("region") || "";
  sort.value = query.get("sort") || "plays";
  author = query.get("author") || "";
}

function replaceQuery(query) {
  const text = query.toString();
  history.replaceState(null, "", (text ? "?" + text : location.pathname) + location.hash);
}

function writeState() {
  const query = new URLSearchParams(location.search);
  for (const [key, value, fallback] of [["q", search.value.trim(), ""], ["region", region.value, ""], ["sort", sort.value, "plays"], ["author", author, ""]]) {
    if (value && value !== fallback) query.set(key, value);
    else query.delete(key);
  }
  replaceQuery(query);
}

function load(index) {
  const fields = index.fields;
  const at = name => fields.indexOf(name);
  const [id, site, name, author, authorId, plays, likes, published, format, size, versions, image] =
    ["id", "site", "name", "author", "authorId", "plays", "likes", "published", "format", "size", "versions", "image"].map(at);
  const untitled = i18n.t("common.untitledMap");
  return index.rows.map((row, position) => ({
    position,
    key: mapKey({ id: row[id], site: row[site], name: row[name] || "Untitled map" }),
    id: row[id],
    site: row[site],
    name: row[name] || untitled,
    author: row[author],
    authorId: row[authorId],
    plays: row[plays],
    likes: row[likes],
    published: row[published],
    format: row[format],
    size: row[size],
    versions: row[versions] || 1,
    image: image >= 0 ? row[image] : "",
    text: fold(`${row[name]} ${row[author]} ${row[id]}`),
    folded: fold(row[name] || ""),
    bare: bare(fold(row[name] || "")),
  }));
}

const ORDER = {
  plays: (a, b) => (b.plays ?? -1) - (a.plays ?? -1),
  likes: (a, b) => (b.likes ?? -1) - (a.likes ?? -1),
  new: (a, b) => (b.published || "").localeCompare(a.published || ""),
  old: (a, b) => (a.published || "￿").localeCompare(b.published || "￿"),
  name: (a, b) => a.folded.localeCompare(b.folded),
};

function authorKey(map) {
  if (map.authorId) return `${map.site}:${map.authorId}`;
  return map.author ? `name:${map.author}` : "";
}

function authorName(key) {
  const own = maps.filter(map => authorKey(map) === key);
  return own.find(map => map.author)?.author || (own.length ? `#${own[0].authorId}` : key.split(":").slice(1).join(":"));
}

function showAuthor() {
  authorButton.hidden = !author;
  authorButton.querySelector(".label").textContent = author ? i18n.t("maps.byAuthor", { name: authorName(author) }) : "";
}

function byAuthor(map) {
  closeSheet();
  author = authorKey(map);
  search.value = "";
  region.value = "";
  if (favorites) {
    favorites = false;
    showFavorites();
  }
  history.replaceState(null, "", location.pathname + location.search);
  writeState();
  filter();
  window.scrollTo({ top: 0 });
}

function score(map, query) {
  if (map.id && map.id === query) return 4;
  if (map.bare === query) return 3;
  if (map.bare.startsWith(query)) return 2;
  return 1;
}

function filter() {
  const query = fold(search.value.trim());
  const words = query.split(/\s+/).filter(Boolean);
  const wanted = region.value;
  const likedSet = favorites ? new Set(likedList("maps")) : null;
  results = maps.filter(map => (!likedSet || likedSet.has(map.key)) && (!author || authorKey(map) === author)
    && (!wanted || (wanted === "-" ? !map.site : map.site === wanted)) && words.every(word => map.text.includes(word)));
  const order = ORDER[sort.value] || ORDER.plays;
  if (words.length) {
    const plain = bare(query);
    const scores = new Map(results.map(map => [map, score(map, plain)]));
    results.sort((a, b) => scores.get(b) - scores.get(a) || order(a, b));
  } else {
    results.sort(order);
  }
  list.replaceChildren();
  shown = 0;
  status.textContent = results.length ? "" : i18n.t(favorites ? "maps.noLikedYet" : "maps.noneFound");
  showAuthor();
  summary.textContent = words.length || wanted || favorites || author
    ? i18n.t("maps.summaryFiltered", { shown: results.length, total: maps.length })
    : i18n.t("maps.summary", { total: maps.length });
  more();
}

function size(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function count(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(value);
}

function meta(map) {
  const parts = [];
  if (map.author) parts.push(map.author);
  if (map.plays != null) parts.push(i18n.t("maps.plays", { count: map.plays, value: count(map.plays) }));
  if (map.published) parts.push(map.published.slice(0, 4));
  return parts.join(" · ") || `${size(map.size)} .${map.format}`;
}

async function detail(map) {
  const { perFile, path } = latest.details;
  const file = Math.floor(map.position / perFile);
  if (!details.has(file)) {
    details.set(file, fetch(`${base}${path}${file.toString(16).padStart(3, "0")}.json`).then(response => response.json()).catch(error => {
      details.delete(file);
      throw error;
    }));
  }
  const [description, created, publishedAt, versions] = (await details.get(file))[map.position % perFile];
  return {
    description, created, publishedAt,
    versions: versions.map(([sha256, format, bytes, savedAt, exporter, urls]) => ({ sha256, format, bytes, savedAt, exporter, urls })),
  };
}

async function loadContents() {
  if (!latest.rows) return null;
  const [rows, kinds] = await Promise.all([
    fetch(base + latest.rows).then(response => response.json()),
    Promise.all(Object.entries(CONTENTS).map(([kind, data]) => fetch(data + "latest.json", { cache: "no-cache" })
      .then(response => response.json())
      .then(info => info.links && info.maps === latest.files ? kind : null, () => null))),
  ]);
  const ids = new Map();
  rows.forEach((row, file) => {
    if (!ids.has(row)) ids.set(row, []);
    ids.get(row).push(file + 1);
  });
  return { rows, ids, kinds: kinds.filter(Boolean) };
}

function fileName(map, version) {
  const title = Array.from(map.name.normalize("NFC").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 60).join("").replace(/[. ]+$/, "");
  return `${title || "map"}${map.id ? " " + map.id : ""}${version.index ? " v" + (version.index + 1) : ""}.${version.format}`;
}

async function download(map, button, index = 0) {
  button.disabled = true;
  button.classList.remove("error");
  try {
    const version = { ...(await detail(map)).versions[index], index };
    const blob = await fetch(version.urls[0]).then(response => {
      if (!response.ok) throw new Error(response.status);
      return response.blob();
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName(map, version);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch (error) {
    button.classList.add("error");
    console.warn(map.id, error);
  } finally {
    button.disabled = false;
  }
}

async function play(map, button) {
  button.disabled = true;
  try {
    const { versions } = await detail(map);
    const query = new URLSearchParams({ import: versions[0].urls[0], name: map.name });
    location.href = "../play/?" + query;
  } catch (error) {
    button.disabled = false;
    console.warn(map.id, error);
  }
}

function date(value) {
  return value ? new Date(value).toLocaleDateString(i18n.lang, { dateStyle: "medium" }) : "";
}

function line(label, value) {
  if (!value) return null;
  const row = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const data = document.createElement("dd");
  if (value instanceof Node) data.append(value);
  else data.textContent = value;
  row.append(term, data);
  return row;
}

function authorLink(map, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link author";
  button.textContent = text;
  button.title = i18n.t("maps.showByAuthor");
  button.addEventListener("click", () => byAuthor(map));
  return button;
}

function contentLinks(map, inside) {
  const ids = inside?.ids.get(map.position);
  if (!ids || !inside.kinds.length) return null;
  const links = document.createElement("span");
  inside.kinds.forEach((kind, i) => {
    if (i) links.append(" · ");
    const link = document.createElement("a");
    link.href = `../${kind}/?map=${ids.join(",")}`;
    link.textContent = i18n.t(NAMES[kind]);
    links.append(link);
  });
  return links;
}

function anchor(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

let inspecting = null;

function closeSheet() {
  if (!inspecting) return;
  const state = inspecting;
  inspecting = null;
  state.element.remove();
  document.title = i18n.t("maps.title");
  document.documentElement.classList.remove("inspecting");
  document.removeEventListener("keydown", state.keys);
  state.opener?.focus();
  const query = new URLSearchParams(location.search);
  if (query.has("map")) {
    query.delete("map");
    replaceQuery(query);
  }
}

function iconButton(className, label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon " + className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  return button;
}

function showLiked(button, on) {
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = i18n.t(on ? "common.unlike" : "common.like");
  button.setAttribute("aria-label", button.title);
}

function likeButton(map) {
  const button = iconButton("like", i18n.t("common.like"), HEART_ICON);
  button.dataset.sha = map.key;
  showLiked(button, liked("maps", map.key));
  button.addEventListener("click", event => {
    event.stopPropagation();
    toggle("maps", map.key);
  });
  return button;
}

document.addEventListener("liked", ({ detail }) => {
  if (detail.kind !== "maps") return;
  for (const button of document.querySelectorAll(`.like[data-sha="${CSS.escape(detail.sha)}"]`)) showLiked(button, detail.liked);
  favoritesCount.textContent = likedList("maps").length || "";
});

function picture(map) {
  if (!map.image || !images) return null;
  const image = new Image();
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.src = `${images}${map.image}.jpg`;
  image.addEventListener("load", () => image.classList.add("shown"), { once: true });
  image.addEventListener("error", () => image.remove(), { once: true });
  return image;
}

async function openSheet(map, opener) {
  closeSheet();
  const element = document.createElement("div");
  element.className = "inspector";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", map.name);
  const panel = document.createElement("div");
  panel.className = "sheet";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("aria-label", i18n.t("common.close"));
  close.textContent = "×";
  const stage = document.createElement("div");
  stage.className = "stage map-stage";
  const image = picture(map);
  if (image) stage.append(image);
  else stage.dataset.state = "none";
  const about = document.createElement("div");
  about.className = "about";
  const heading = document.createElement("h2");
  heading.className = "title";
  heading.textContent = map.name;
  const details = document.createElement("p");
  details.className = "details";
  details.textContent = meta(map);
  if (map.author && authorKey(map)) details.replaceChildren(authorLink(map, map.author), meta(map).slice(map.author.length));
  const row = document.createElement("div");
  row.className = "actions";
  const start = document.createElement("button");
  start.type = "button";
  start.className = "button primary";
  start.textContent = i18n.t("common.play");
  start.addEventListener("click", () => play(map, start));
  const save = iconButton("save", i18n.t("common.downloadFile", { extension: "." + map.format }), DOWNLOAD_ICON);
  save.addEventListener("click", () => download(map, save));
  row.append(likeButton(map), start, save);
  const box = document.createElement("div");
  box.className = "more";
  box.textContent = i18n.t("common.loading");
  about.append(heading, details, row, box);
  panel.append(close, stage, about);
  element.append(panel);
  document.body.append(element);
  document.documentElement.classList.add("inspecting");
  document.title = `${map.name} - OpenKogama`;
  const state = { element, opener, keys: event => { if (event.key === "Escape") closeSheet(); } };
  inspecting = state;
  document.addEventListener("keydown", state.keys);
  element.addEventListener("click", event => { if (event.target === element) closeSheet(); });
  close.addEventListener("click", closeSheet);
  close.focus();
  try {
    const [info, inside] = await Promise.all([detail(map), contents]);
    if (inspecting !== state) return;
    box.replaceChildren();
    if (info.description) {
      const text = document.createElement("p");
      text.className = "description";
      text.textContent = info.description;
      box.append(text);
    }
    const facts = document.createElement("dl");
    const original = map.id && map.site ? anchor(`https://web.archive.org/web/2024/https://${HOSTS[map.site]}/games/play/${map.id}/`, `${HOSTS[map.site]}/games/play/${map.id}`) : null;
    const items = [...new Map(info.versions.flatMap(version => version.urls).filter(url => url.includes("/download/"))
      .map(url => [url.split("/download/")[1].split("/")[0], url])).entries()];
    const sources = document.createElement("span");
    items.forEach(([item], i) => {
      if (i) sources.append(", ");
      sources.append(anchor(`https://archive.org/details/${item}`, decodeURIComponent(item)));
    });
    facts.append(...[
      line(i18n.t("maps.facts.id"), map.id),
      line(i18n.t("maps.facts.region"), i18n.t(REGIONS[map.site] || "maps.regions.unknown")),
      line(i18n.t("maps.facts.plays"), map.plays != null ? map.plays.toLocaleString(i18n.lang) : ""),
      line(i18n.t("maps.facts.likes"), map.likes != null ? map.likes.toLocaleString(i18n.lang) : ""),
      line(i18n.t("maps.facts.file"), `${size(map.size)} .${map.format}`),
      line(i18n.t("maps.facts.contents"), contentLinks(map, inside)),
      line(i18n.t("maps.facts.author"), authorKey(map) ? authorLink(map, map.author ? `${map.author}${map.authorId ? " (" + map.authorId + ")" : ""}` : map.authorId) : ""),
      line(i18n.t("maps.facts.created"), date(info.created)),
      line(i18n.t("maps.facts.published"), date(info.publishedAt)),
      line(i18n.t("maps.facts.originalPage"), original),
      line(i18n.t("maps.facts.archivedIn"), sources.childNodes.length ? sources : null),
    ].filter(Boolean));
    box.append(facts);
    if (info.versions.length > 1) {
      const files = document.createElement("ul");
      files.className = "versions";
      info.versions.forEach((version, index) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "link";
        button.textContent = `.${version.format} · ${size(version.bytes)}${version.savedAt ? " · " + i18n.t("maps.saved", { date: date(version.savedAt) }) : ""}${index ? "" : " · " + i18n.t("maps.usedForPlay")}`;
        button.addEventListener("click", () => download(map, button, index));
        item.append(button);
        files.append(item);
      });
      box.append(files);
    }
  } catch (error) {
    box.textContent = i18n.t("maps.detailsUnavailable");
    console.warn(map.id, error);
  }
}

function entry(map) {
  const article = document.createElement("article");
  article.className = "card map";
  const frame = document.createElement("div");
  frame.className = "picture";
  frame.tabIndex = 0;
  frame.setAttribute("role", "button");
  frame.setAttribute("aria-label", i18n.t("maps.openDetails"));
  const image = picture(map);
  if (image) frame.append(image);
  frame.addEventListener("click", () => openSheet(map, frame));
  frame.addEventListener("keydown", event => {
    if (event.target === frame && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openSheet(map, frame);
    }
  });
  const tools = document.createElement("div");
  tools.className = "tools";
  const save = iconButton("save", i18n.t("common.downloadFile", { extension: "." + map.format }), DOWNLOAD_ICON);
  save.addEventListener("click", event => {
    event.stopPropagation();
    download(map, save);
  });
  tools.append(save);
  frame.append(likeButton(map), tools);
  const title = document.createElement("p");
  title.className = "name";
  title.textContent = map.name;
  title.title = map.name;
  const info = document.createElement("p");
  info.className = "meta";
  info.textContent = meta(map);
  article.append(frame, title, info);
  return article;
}

function more() {
  if (shown >= results.length) return;
  list.append(...results.slice(shown, shown + PAGE).map(entry));
  shown = Math.min(shown + PAGE, results.length);
}

new IntersectionObserver(entries => {
  if (entries.some(item => item.isIntersecting)) more();
}, { rootMargin: "1500px 0px" }).observe(sentinel);

let typing;
search.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    writeState();
    filter();
  }, 150);
});
for (const control of [region, sort]) control.addEventListener("change", () => {
  writeState();
  filter();
});
function showFavorites() {
  favoritesButton.setAttribute("aria-pressed", String(favorites));
  favoritesCount.textContent = likedList("maps").length || "";
}

authorButton.addEventListener("click", () => {
  author = "";
  writeState();
  filter();
});

favoritesButton.addEventListener("click", () => {
  favorites = !favorites;
  history.replaceState(null, "", location.pathname + location.search + (favorites ? "#liked" : ""));
  showFavorites();
  filter();
});

document.getElementById("filters").addEventListener("submit", event => {
  event.preventDefault();
  clearTimeout(typing);
  writeState();
  filter();
});

async function deepLink() {
  const query = new URLSearchParams(location.search);
  if (query.has("map")) {
    const inside = await contents;
    const map = maps[inside?.rows[Number(query.get("map")) - 1]];
    if (map) return openSheet(map, null);
  }
  const q = (query.get("q") || "").trim();
  if (!q) return;
  const exact = maps.filter(map => map.id === q);
  if (exact.length === 1) openSheet(exact[0], null);
}

async function start() {
  await i18n.ready;
  readState();
  showFavorites();
  try {
    latest = await (await fetch(DATA + "latest.json", { cache: "no-cache" })).json();
    base = `${DATA}builds/${latest.build}/`;
    images = latest.images ? new URL(latest.images.path, base).href : null;
    contents = loadContents().catch(error => {
      console.warn(error);
      return null;
    });
    maps = load(await (await fetch(base + latest.index.path)).json());
    filter();
    deepLink();
  } catch (error) {
    summary.textContent = i18n.t("maps.unavailable");
    console.error(error);
  }
}

start();
