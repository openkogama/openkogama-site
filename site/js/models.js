import { buildMesh, buildParts, createRenderer, fetchRange, loadBlob, loadModel } from "./cube-renderer.js";
import { tint } from "./tint.js";
import { createViewer } from "./viewer.js";
import { inspect } from "./inspect.js";
import { liked, likedList, toggle } from "./likes.js";

const SOURCES = { map: 1, build: 2, class: 4, world: 8, placed: 16 };
const KINDS = {
  models: {
    data: "https://cdn.openkogama.org/models/v2/",
    extension: ".kgmodel",
    noun: "models",
    matches: (row, value) => row.scale === Number(value),
    word: value => "zzscale" + value.replace(".", ""),
    detail: row => `scale ${row.scale}`,
    summary: latest => `${latest.models.toLocaleString("en")} models from ${latest.maps.toLocaleString("en")} maps`,
    missing: "Models are not available right now",
  },
  avatars: {
    data: "https://cdn.openkogama.org/avatars/v1/",
    extension: ".kgavatar",
    noun: "avatars",
    matches: (row, value) => Boolean(row.sources & SOURCES[value]),
    word: value => "zzsource" + value,
    detail: row => row.sources & 4 ? "class" : row.sources & 8 ? "avatar world" : row.sources & 16 ? "placed" : row.sources & 2 ? "build mode" : "avatar",
    summary: latest => `${latest.avatars.toLocaleString("en")} avatars from ${latest.maps.toLocaleString("en")} maps`,
    missing: "Avatars are not available right now",
  },
};
const KIND = KINDS[document.body.dataset.kind] || KINDS.models;
const DATA = new URL(new URLSearchParams(location.search).get("data") || KIND.data, location.href).href;
const PAGE = 48;
const PARALLEL = 4;
const GAP = 64;
const PREFIX_LENGTH = 3;
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const BONES = ["Head", "Torso", "LArm", "RArm", "LUpLeg", "LLowLeg", "RUpLeg", "RLowLeg"];
const VENDOR = new URL("./vendor/sql.js-httpvfs/", import.meta.url);
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
const RUN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4" r="2.3" fill="currentColor"/><path d="M13.5 7.5 11 13M13 8.6l-3.6 1.6M13 8.6l3.4 3M11 13l3 3-.6 4.6M11 13l-2.6 3.4H4.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';

const grid = document.getElementById("grid");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const search = document.getElementById("search");
const filter = document.getElementById("filter");
const favoritesButton = document.getElementById("favorites");
const colorSelect = document.getElementById("color");
const typeSelect = document.getElementById("type");
const adultButton = document.getElementById("adult");
const ADULT = "openkogama-adult";
let adult = (() => { try { return localStorage.getItem(ADULT) === "1"; } catch { return false; } })();
let colors = null, meta = null, listPage = null;
const favoritesCount = favoritesButton.querySelector(".count");
const sentinel = document.createElement("div");
sentinel.className = "sentinel";
grid.after(sentinel);

let latest, base, titles, previews, viewer;
let lastId = 0, loading = false, finished = false, generation = 0, active = 0;
let favorites = location.hash === "#liked", favoritePage = null;
const near = new Set();
const databases = new Map();
const resolved = new Map();

const visible = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) near.add(entry.target);
    else near.delete(entry.target);
  }
  drain();
}, { rootMargin: "1200px 0px" });

const more = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) loadMore();
}, { rootMargin: "2500px 0px" });

function packUrl(pack) {
  return `${base}packs/${pack.toString(16).padStart(3, "0")}.bin`;
}

function openDatabase(source = latest.search || latest.database) {
  if (!databases.has(source.path)) {
    databases.set(source.path, createDbWorker(
      [{ from: "inline", config: { serverMode: "full", url: base + source.path, requestChunkSize: source.pageSize } }],
      new URL("sqlite.worker.js", VENDOR).href,
      new URL("sql-wasm.wasm", VENDOR).href,
    ).then(worker => worker.db).catch(error => {
      databases.delete(source.path);
      throw error;
    }));
  }
  return databases.get(source.path);
}

function total() {
  return latest.models ?? latest.avatars;
}

function matchQuery() {
  const words = search.value.trim().split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word))
    .map(word => `"${word.replace(/"/g, '""')}"${word.length >= PREFIX_LENGTH ? "*" : ""}`);
  if (filter.value) words.push(KIND.word(filter.value));
  return words.join(" ");
}

async function nextIds() {
  const match = matchQuery();
  if (!match) {
    const ids = [];
    for (let id = lastId + 1; id <= Math.min(lastId + PAGE, total()); id++) ids.push(id);
    return ids;
  }
  const db = await openDatabase();
  const table = latest.search?.table || "model_search";
  const rows = await db.query(`SELECT rowid AS id FROM ${table} WHERE ${table} MATCH ? AND rowid > ? ORDER BY rowid LIMIT ?`, [match, lastId, PAGE]);
  return rows.map(row => row.id);
}

function hexAt(view, at) {
  let sha256 = "";
  for (let i = 0; i < 32; i++) sha256 += HEX[view.getUint8(at + i)];
  return sha256;
}

function record(view, at, id) {
  const row = { id, sha256: hexAt(view, at), maps: view.getUint32(at + 32, true), cubes: view.getUint32(at + 36, true) };
  if (latest.kind === "avatars") {
    return {
      ...row,
      sources: view.getUint8(at + 40),
      image: view.getUint8(at + 41),
      pack: view.getUint16(at + 42, true),
      offset: view.getUint32(at + 44, true),
      length: view.getUint32(at + 48, true),
      map: view.getUint16(at + 52, true),
    };
  }
  return {
    ...row,
    scale: Math.round(view.getFloat32(at + 40, true) * 10000) / 10000,
    image: view.getUint8(at + 44),
    pack: view.getUint16(at + 45, true),
    offset: view.getUint32(at + 47, true),
    length: view.getUint32(at + 51, true),
    map: view.getUint16(at + 55, true),
  };
}

function cardFile(id) {
  const { perFile } = latest.cards;
  return perFile ? Math.floor((id - 1) / perFile) : 0;
}

function cardPlace(id) {
  const { path, record, perFile } = latest.cards;
  if (!perFile) return { url: base + path, offset: (id - 1) * record };
  return { url: `${base}${path}${cardFile(id).toString(16).padStart(3, "0")}.bin`, offset: ((id - 1) % perFile) * record };
}

async function rowsFor(ids) {
  const size = latest.cards.record;
  const ranges = [];
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && id - last.end <= GAP && cardFile(id) === cardFile(last.start)) last.end = id;
    else ranges.push({ start: id, end: id });
  }
  const views = await Promise.all(ranges.map(range => {
    const { url, offset } = cardPlace(range.start);
    return fetchRange(url, offset, (range.end - range.start + 1) * size).then(buffer => new DataView(buffer));
  }));
  const rows = new Map();
  ranges.forEach((range, i) => {
    for (let id = range.start; id <= range.end; id++) rows.set(id, record(views[i], (id - range.start) * size, id));
  });
  return ids.map(id => rows.get(id));
}

async function lookupIds(shas) {
  const db = await openDatabase(latest.database);
  const ids = new Map();
  for (let i = 0; i < shas.length; i += 500) {
    const part = shas.slice(i, i + 500);
    const rows = await db.query(`SELECT id, sha256 FROM models WHERE sha256 IN (${part.map(() => "?").join(",")})`, part);
    for (const row of rows) ids.set(row.sha256, row.id);
  }
  return ids;
}

async function scanIds(shas) {
  const wanted = new Set(shas);
  const ids = new Map();
  const { record: size, perFile } = latest.cards;
  for (let first = 1; first <= total() && ids.size < wanted.size; first += perFile) {
    const { url } = cardPlace(first);
    const view = new DataView(await fetchRange(url, 0, Math.min(perFile, total() - first + 1) * size));
    for (let at = 0; at + size <= view.byteLength; at += size) {
      const sha = hexAt(view, at);
      if (wanted.has(sha)) ids.set(sha, first + at / size);
    }
  }
  return ids;
}

function colorTable() {
  colors ??= fetch("colors.json").then(response => response.ok ? response.json() : null).catch(() => null);
  return colors.then(table => table && latest && table.build === latest.build ? table : null);
}

function metaTable() {
  if (latest?.kind !== "avatars") return Promise.resolve(null);
  meta ??= fetch("meta.json").then(response => response.ok ? response.json() : null).catch(() => null);
  return meta.then(table => table && latest && table.build === latest.build ? table : null);
}

function searchWords() {
  return search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function listMode() {
  return Boolean(colorSelect?.value || typeSelect?.value || (latest?.kind === "avatars" && searchWords().length));
}

async function searchIds(words) {
  const table = await metaTable();
  if (!table) return [];
  return Object.keys(table.rows).filter(id => {
    const [title, type, desc, , , tags] = table.rows[id];
    const text = `${title} ${type} ${desc} ${tags}`.toLowerCase();
    return words.every(word => text.includes(word));
  }).map(Number).sort((a, b) => a - b);
}

async function filteredIds(withSearch) {
  const parts = [];
  if (colorSelect?.value) {
    const table = await colorTable();
    parts.push(table ? table.colors[colorSelect.value] || [] : []);
  }
  if (typeSelect?.value) {
    const table = await metaTable();
    parts.push(table ? Object.keys(table.rows).filter(id => table.rows[id][1] === typeSelect.value).map(Number) : []);
  }
  const words = searchWords();
  const ranked = withSearch && words.length ? await searchIds(words) : null;
  if (!parts.length && !ranked) return null;
  let ids = ranked ?? [...parts.shift()].sort((a, b) => a - b);
  for (const part of parts) {
    const keep = new Set(part);
    ids = ids.filter(id => keep.has(id));
  }
  return [...new Set(ids)];
}

async function likedRows() {
  const allowedIds = await filteredIds(false);
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const shas = likedList(kindName());
  const missing = shas.filter(sha => !resolved.has(sha));
  if (missing.length) {
    const ids = await (latest.database ? lookupIds(missing) : scanIds(missing));
    const rows = ids.size ? await rowsFor([...ids.values()]) : [];
    for (const row of rows) resolved.set(row.sha256, row);
    for (const sha of missing) if (!resolved.has(sha)) resolved.set(sha, null);
  }
  const names = await titles;
  const table = await metaTable();
  const words = searchWords();
  return shas.map(sha => resolved.get(sha)).filter(row => row
    && (!allowed || allowed.has(row.id))
    && (!filter.value || KIND.matches(row, filter.value))
    && words.every(word => {
      const info = table?.rows[row.id];
      return latest.kind === "avatars"
        ? Boolean(info) && `${info[0]} ${info[1]} ${info[2]} ${info[5]}`.toLowerCase().includes(word)
        : (names[row.map] || "").toLowerCase().includes(word);
    }));
}

function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function connect(worker) {
  const pending = new Map();
  let next = 0;
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data);
  });
  worker.addEventListener("error", event => {
    for (const request of pending.values()) request.reject(new Error(event.message || "preview worker failed"));
    pending.clear();
  });
  return (type, message = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, type, id });
  });
}

async function workerPreviews() {
  const worker = new Worker(new URL("./preview-worker.js", import.meta.url), { type: "module" });
  try {
    const call = connect(worker);
    const { ready } = await within(call("setup", { atlas: base + "atlas.png", materials: latest.materials }), 15000, "preview worker did not start");
    if (!ready) throw new Error("WebGL 2 is not available in workers");
    return {
      async render(row, target) {
        const result = await call("render", { url: packUrl(row.pack), offset: row.offset, length: row.length });
        if (result.bitmap) {
          target.getContext("2d").drawImage(result.bitmap, 0, 0, target.width, target.height);
          result.bitmap.close();
        }
        return result;
      },
      geometry(row) {
        return call("geometry", { url: packUrl(row.pack), offset: row.offset, length: row.length });
      },
      async colors(image) {
        return (await call("colors", { url: image.src })).colors;
      },
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

async function pagePreviews() {
  const renderer = await createRenderer(base + "atlas.png", latest.materials);
  if (!renderer) throw new Error("WebGL 2 is not available");
  return {
    async render(row, target) {
      const mesh = buildMesh(await loadModel(packUrl(row.pack), row.offset, row.length), latest.materials);
      if (!mesh) return { status: "too-big" };
      renderer.draw(mesh, target);
      return { status: "ok", colors: tint(target) };
    },
    async geometry(row) {
      const parsed = await loadModel(packUrl(row.pack), row.offset, row.length);
      if (parsed.parts) {
        const avatar = buildParts(parsed, latest.materials);
        return avatar ? { status: "ok", avatar } : { status: "too-big" };
      }
      const mesh = buildMesh(parsed, latest.materials);
      return mesh ? { status: "ok", mesh } : { status: "too-big" };
    },
    async colors(image) {
      return tint(image);
    },
  };
}

function setupPreviews() {
  return workerPreviews()
    .catch(error => {
      console.warn(error);
      return pagePreviews();
    })
    .catch(error => {
      console.warn(error);
      return null;
    });
}

function canvas() {
  const element = document.createElement("canvas");
  element.width = element.height = 256;
  return element;
}

function fileName(name, sha) {
  const title = Array.from((name || "").normalize("NFC").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 60).join("").replace(/[. ]+$/, "");
  return `${title ? title + " " : ""}${sha.slice(0, 8)}${KIND.extension}`;
}

function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

function avatarFile(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const parts = [];
  let pos = 5;
  for (let i = 0; i < bytes[4]; i++) {
    if (!bytes[pos++]) continue;
    const scale = view.getFloat32(pos + 28);
    const size = view.getUint32(pos + 32);
    pos += 36;
    const cubes = bytes.subarray(pos, pos + size);
    if (size >= 4 && view.getInt32(pos) > 0) parts.push({ bone: BONES[i], scale: rounded(scale), cubes: base64(cubes) });
    pos += size;
  }
  const accessories = [];
  for (let count = bytes[pos++], i = 0; i < count; i++) {
    accessories.push({ item: view.getInt32(pos + 1), slot: bytes[pos], offset: rounded(view.getFloat32(pos + 5)), scale: rounded(view.getFloat32(pos + 9)) });
    pos += 15 + view.getUint16(pos + 13);
  }
  return JSON.stringify({ parts, accessories }, null, 2);
}

async function download(row, name, button) {
  button.disabled = true;
  button.classList.remove("error");
  try {
    const bytes = await loadBlob(packUrl(row.pack), row.offset, row.length);
    const link = document.createElement("a");
    const file = latest.kind === "avatars"
      ? new Blob([avatarFile(bytes)], { type: "application/json" })
      : new Blob([bytes], { type: "application/octet-stream" });
    link.href = URL.createObjectURL(file);
    link.download = fileName(name, row.sha256);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch (error) {
    button.classList.add("error");
    console.warn(row.sha256, error);
  } finally {
    button.disabled = false;
  }
}

function recolor(article, colors) {
  if (!colors) return;
  article.style.setProperty("--card", colors.background);
  article.style.setProperty("--card-edge", colors.edge);
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

function saveButton(row, article) {
  const button = iconButton("save", `Download ${KIND.extension}`, DOWNLOAD_ICON);
  button.addEventListener("click", () => download(row, article.mapName, button));
  return button;
}

function kindName() {
  return latest.kind || "models";
}

function showLiked(button, on) {
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Unlike" : "Like";
  button.setAttribute("aria-label", button.title);
}

function likeButton(row) {
  const button = iconButton("like", "Like", HEART_ICON);
  button.dataset.sha = row.sha256;
  showLiked(button, liked(kindName(), row.sha256));
  button.addEventListener("click", () => toggle(kindName(), row.sha256));
  return button;
}

document.addEventListener("liked", ({ detail }) => {
  for (const button of document.querySelectorAll(`.like[data-sha="${detail.sha}"]`)) showLiked(button, detail.liked);
});

function openInspector(row, article, opener) {
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button primary";
  save.textContent = `Download ${KIND.extension}`;
  save.addEventListener("click", () => download(row, article.mapName, save));
  inspect({
    row,
    title: article.avatarInfo?.[0] || article.mapName || "Untitled map",
    meta: article.avatarInfo
      ? [article.avatarInfo[2], article.mapName && `From ${article.mapName}`, article.querySelector(".meta").textContent].filter(Boolean).join(" · ")
      : article.querySelector(".meta").textContent,
    tint: article.style.getPropertyValue("--card"),
    edge: article.style.getPropertyValue("--card-edge"),
    actions: [likeButton(row), save],
    atlas: base + "atlas.png",
    materials: latest.materials,
    geometry: item => previews.then(engine => engine ? engine.geometry(item) : { status: "failed" }),
    animated: latest.kind === "avatars",
    opener,
  });
}

function animateButton(article) {
  const button = iconButton("animate", "Change animation", RUN_ICON);
  button.addEventListener("click", () => viewer.cycle(article.querySelector(".picture")));
  return button;
}

function card(row) {
  const article = document.createElement("article");
  article.className = "card";
  const picture = document.createElement("div");
  picture.className = "picture";
  if (row.image) {
    const image = new Image();
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => {
      image.classList.add("shown");
      previews.then(engine => engine && engine.colors(image)).then(colors => recolor(article, colors)).catch(error => console.warn(error));
    }, { once: true });
    image.src = `${base}images/${row.sha256}.png`;
    image.addEventListener("error", () => {
      image.replaceWith(canvas());
      visible.observe(article);
    }, { once: true });
    picture.append(image);
  } else {
    picture.append(canvas());
    visible.observe(article);
  }
  const tools = document.createElement("div");
  tools.className = "tools";
  if (latest.kind === "avatars") tools.append(animateButton(article));
  tools.append(saveButton(row, article));
  picture.tabIndex = 0;
  picture.setAttribute("role", "button");
  picture.setAttribute("aria-label", "Open full view");
  picture.addEventListener("keydown", event => {
    if (event.target === picture && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openInspector(row, article, picture);
    }
  });
  picture.append(likeButton(row), tools);
  const title = document.createElement("p");
  title.className = "name";
  title.textContent = "\u00a0";
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${row.maps.toLocaleString("en")} ${row.maps === 1 ? "map" : "maps"} · ${row.cubes.toLocaleString("en")} cubes · ${KIND.detail(row)}`;
  article.append(picture, title, meta);
  article.model = row;
  return article;
}

function drain() {
  while (active < PARALLEL && near.size) {
    const article = near.values().next().value;
    near.delete(article);
    visible.unobserve(article);
    if (!article.isConnected) continue;
    active++;
    show(article).finally(() => {
      active--;
      drain();
    });
  }
}

async function show(article) {
  const row = article.model;
  try {
    const engine = await previews;
    if (!engine) throw new Error("WebGL 2 is not available");
    const target = article.querySelector("canvas");
    const result = await engine.render(row, target);
    if (result.status === "too-big") {
      article.classList.add("too-big");
    } else {
      recolor(article, result.colors);
      target.classList.add("shown");
    }
  } catch (error) {
    article.classList.add("failed");
    console.warn(row.sha256, error);
  }
}

function name(article, text) {
  article.mapName = text || "";
  article.querySelector(".name").textContent = text || "Untitled map";
}

async function nextPage() {
  if (favorites) {
    const all = await (favoritePage ??= likedRows());
    return { rows: all.slice(lastId, lastId + PAGE), next: Math.min(lastId + PAGE, all.length), done: lastId + PAGE >= all.length };
  }
  if (listMode()) {
    const ids = await (listPage ??= filteredIds(true));
    const slice = ids.slice(lastId, lastId + PAGE);
    const rows = slice.length ? (await rowsFor(slice)).filter(row => row && (!filter.value || KIND.matches(row, filter.value))) : [];
    return { rows, next: lastId + PAGE, done: lastId + PAGE >= ids.length };
  }
  const ids = await nextIds();
  const rows = ids.length ? await rowsFor(ids) : [];
  return { rows, next: ids.length ? ids[ids.length - 1] : lastId, done: ids.length < PAGE };
}

function emptyText() {
  if (!favorites) return `No ${KIND.noun} found`;
  return likedList(kindName()).length ? `No liked ${KIND.noun} found` : `No liked ${KIND.noun} yet`;
}

async function loadMore() {
  if (loading || finished || !latest) return;
  loading = true;
  const current = generation;
  status.textContent = "Loading";
  try {
    const page = await nextPage();
    const { next, done } = page;
    const table = latest.kind === "avatars" ? await metaTable() : null;
    if (current !== generation) return;
    const rows = page.rows.filter(row => adult || !table?.rows[row.id]?.[4]);
    const cards = rows.map(card);
    grid.append(...cards);
    lastId = next;
    finished = done;
    status.textContent = finished ? (grid.children.length ? "" : emptyText()) : "";
    Promise.all([titles, metaTable()]).then(([list, table]) => cards.forEach((article, i) => {
      name(article, list[rows[i].map]);
      const info = table?.rows[rows[i].id];
      if (!info) return;
      article.avatarInfo = info;
      const title = article.querySelector(".name");
      title.textContent = info[0];
      title.title = list[rows[i].map] || "";
      if (info[4]) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "18+";
        title.prepend(badge);
      }
    }));
  } catch (error) {
    status.textContent = `Could not load ${KIND.noun}`;
    console.error(error);
  } finally {
    if (current === generation) loading = false;
  }
  if (!finished && current === generation) {
    more.unobserve(sentinel);
    more.observe(sentinel);
  }
}

function restart() {
  generation++;
  viewer?.reset();
  visible.disconnect();
  near.clear();
  grid.replaceChildren();
  lastId = 0;
  finished = false;
  loading = false;
  favoritePage = null;
  listPage = null;
  loadMore();
}

function showFavorites() {
  favoritesButton.setAttribute("aria-pressed", String(favorites));
  favoritesCount.textContent = latest ? likedList(kindName()).length || "" : "";
}

favoritesButton.addEventListener("click", () => {
  favorites = !favorites;
  history.replaceState(null, "", favorites ? "#liked" : location.pathname + location.search);
  showFavorites();
  restart();
});

document.addEventListener("liked", showFavorites);

let typing;
search.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(restart, 350);
});
filter.addEventListener("change", restart);
colorSelect?.addEventListener("change", restart);
typeSelect?.addEventListener("change", restart);
function showAdult() {
  adultButton?.setAttribute("aria-pressed", String(adult));
}
adultButton?.addEventListener("click", () => {
  if (!adult && !confirm("This shows avatars marked as mature content, archived as they were made by players. Confirm that you are 18 or older.")) return;
  adult = !adult;
  try { localStorage.setItem(ADULT, adult ? "1" : "0"); } catch {}
  showAdult();
  restart();
});
document.getElementById("filters").addEventListener("submit", event => {
  event.preventDefault();
  clearTimeout(typing);
  restart();
});

async function start() {
  try {
    latest = await (await fetch(DATA + "latest.json", { cache: "no-cache" })).json();
    base = `${DATA}builds/${latest.build}/`;
    previews = setupPreviews();
    viewer = createViewer(grid, {
      animated: latest.kind === "avatars",
      atlas: base + "atlas.png",
      materials: latest.materials,
      geometry: row => previews.then(engine => engine ? engine.geometry(row) : { status: "failed" }),
      row: picture => picture.closest(".card")?.model,
      open: picture => openInspector(picture.closest(".card").model, picture.closest(".card"), picture),
    });
    summary.textContent = KIND.summary(latest);
    showFavorites();
    if (colorSelect) colorTable().then(table => { colorSelect.hidden = !table; });
    if (typeSelect) metaTable().then(table => {
      typeSelect.hidden = !table;
      if (adultButton) adultButton.hidden = !table || !Object.values(table.rows).some(info => info[4]);
      showAdult();
    });
    titles = fetch(base + latest.titles).then(response => response.json()).catch(error => {
      console.warn(error);
      return [];
    });
    more.observe(sentinel);
    loadMore();
    setTimeout(() => openDatabase().catch(error => console.warn(error)), 2000);
  } catch (error) {
    summary.textContent = KIND.missing;
    console.error(error);
  }
}

start();
