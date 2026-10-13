import { liked, likedList, toggle } from "./likes.js";

const DATA = new URL(new URLSearchParams(location.search).get("data") || "https://cdn.openkogama.org/maps/v1/", location.href).href;
const PAGE = 60;
const REGIONS = { www: "Global", br: "Brazil", friends: "Friends" };
const HOSTS = { www: "www.kogama.com", br: "kogama.com.br", friends: "friends.kogama.com" };
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 13.5 15.4 17M15.4 7 8.6 10.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="18" cy="5.5" r="2.6" fill="currentColor"/><circle cx="6" cy="12" r="2.6" fill="currentColor"/><circle cx="18" cy="18.5" r="2.6" fill="currentColor"/></svg>';

const list = document.getElementById("list");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const search = document.getElementById("search");
const region = document.getElementById("region");
const sort = document.getElementById("sort");
const favoritesButton = document.getElementById("favorites");
const favoritesCount = favoritesButton.querySelector(".count");
let favorites = location.hash === "#liked";
const sentinel = document.createElement("div");
sentinel.className = "sentinel";
list.after(sentinel);

let latest, base, images, maps = [], results = [], shown = 0;
const details = new Map();

const fold = text => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/g, "l");
const bare = text => text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function readState() {
  const query = new URLSearchParams(location.search);
  search.value = query.get("q") || "";
  region.value = query.get("region") || "";
  sort.value = query.get("sort") || "plays";
}

function writeState() {
  const query = new URLSearchParams(location.search);
  for (const [key, value, fallback] of [["q", search.value.trim(), ""], ["region", region.value, ""], ["sort", sort.value, "plays"]]) {
    if (value && value !== fallback) query.set(key, value);
    else query.delete(key);
  }
  const text = query.toString();
  history.replaceState(null, "", (text ? "?" + text : location.pathname) + location.hash);
}

function load(index) {
  const fields = index.fields;
  const at = name => fields.indexOf(name);
  const [id, site, name, author, authorId, plays, likes, published, format, size, versions, image] =
    ["id", "site", "name", "author", "authorId", "plays", "likes", "published", "format", "size", "versions", "image"].map(at);
  return index.rows.map((row, position) => ({
    position,
    id: row[id],
    site: row[site],
    name: row[name] || "Untitled map",
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
  results = maps.filter(map => (!likedSet || likedSet.has(keyOf(map))) && (!wanted || (wanted === "-" ? !map.site : map.site === wanted)) && words.every(word => map.text.includes(word)));
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
  status.textContent = results.length ? "" : favorites ? "No liked maps yet" : "No maps found";
  summary.textContent = words.length || wanted || favorites
    ? `${results.length.toLocaleString("en")} of ${maps.length.toLocaleString("en")} maps`
    : `${maps.length.toLocaleString("en")} archived maps`;
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
  if (map.plays != null) parts.push(`${count(map.plays)} plays`);
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
  return value ? new Date(value).toLocaleDateString("en", { dateStyle: "medium" }) : "";
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
  document.documentElement.classList.remove("inspecting");
  document.removeEventListener("keydown", state.keys);
  state.opener?.focus();
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

function keyOf(map) {
  return map.id ? `${map.site}:${map.id}` : `name:${map.name}`;
}

function showLiked(button, on) {
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Unlike" : "Like";
  button.setAttribute("aria-label", button.title);
}

function likeButton(map) {
  const button = iconButton("like", "Like", HEART_ICON);
  button.dataset.sha = keyOf(map);
  showLiked(button, liked("maps", keyOf(map)));
  button.addEventListener("click", event => {
    event.stopPropagation();
    toggle("maps", keyOf(map));
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
  close.setAttribute("aria-label", "Close");
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
  const row = document.createElement("div");
  row.className = "actions";
  const start = document.createElement("button");
  start.type = "button";
  start.className = "button primary";
  start.textContent = "Play";
  start.addEventListener("click", () => play(map, start));
  const save = iconButton("save", `Download .${map.format}`, DOWNLOAD_ICON);
  save.addEventListener("click", () => download(map, save));
  row.append(likeButton(map), start, save);
  if (map.id) {
    const share = iconButton("save share", "Copy link", SHARE_ICON);
    share.addEventListener("click", async () => {
      const link = `${location.origin}${location.pathname}?q=${encodeURIComponent(map.id)}`;
      try {
        await navigator.clipboard.writeText(link);
        share.title = "Link copied";
        share.classList.add("done");
        setTimeout(() => { share.title = "Copy link"; share.classList.remove("done"); }, 1500);
      } catch {
        share.title = link;
      }
    });
    row.append(share);
  }
  const box = document.createElement("div");
  box.className = "more";
  box.textContent = "Loading";
  about.append(heading, details, row, box);
  panel.append(close, stage, about);
  element.append(panel);
  document.body.append(element);
  document.documentElement.classList.add("inspecting");
  const state = { element, opener, keys: event => { if (event.key === "Escape") closeSheet(); } };
  inspecting = state;
  document.addEventListener("keydown", state.keys);
  element.addEventListener("click", event => { if (event.target === element) closeSheet(); });
  close.addEventListener("click", closeSheet);
  close.focus();
  try {
    const info = await detail(map);
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
      line("Id", map.id),
      line("Region", REGIONS[map.site] || "Unknown"),
      line("Plays", map.plays != null ? map.plays.toLocaleString("en") : ""),
      line("Likes", map.likes != null ? map.likes.toLocaleString("en") : ""),
      line("File", `${size(map.size)} .${map.format}`),
      line("Author", map.author ? `${map.author}${map.authorId ? " (" + map.authorId + ")" : ""}` : map.authorId),
      line("Created", date(info.created)),
      line("Published", date(info.publishedAt)),
      line("Original page", original),
      line("Archived in", sources.childNodes.length ? sources : null),
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
        button.textContent = `.${version.format} · ${size(version.bytes)}${version.savedAt ? " · saved " + date(version.savedAt) : ""}${index ? "" : " · used for Play"}`;
        button.addEventListener("click", () => download(map, button, index));
        item.append(button);
        files.append(item);
      });
      box.append(files);
    }
  } catch (error) {
    box.textContent = "Details are not available right now";
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
  frame.setAttribute("aria-label", "Open details");
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
  const save = iconButton("save", `Download .${map.format}`, DOWNLOAD_ICON);
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

function deepLink() {
  const q = (new URLSearchParams(location.search).get("q") || "").trim();
  if (!q) return;
  const exact = maps.filter(map => map.id === q);
  if (exact.length === 1) openSheet(exact[0], null);
}

async function start() {
  readState();
  showFavorites();
  try {
    latest = await (await fetch(DATA + "latest.json", { cache: "no-cache" })).json();
    base = `${DATA}builds/${latest.build}/`;
    images = latest.images ? new URL(latest.images.path, base).href : null;
    maps = load(await (await fetch(base + latest.index.path)).json());
    filter();
    deepLink();
  } catch (error) {
    summary.textContent = "Maps are not available right now";
    console.error(error);
  }
}

start();
