import { render } from "./markdown.js";
import { card, date, el, fileUrl, message, page, post, scanLine, session, size, stateOf, upload } from "./catalog.js";

const MAX_IMAGES = 6;
const MAX_VIDEOS = 2;
const TABS = ["about", "images", "versions"];
const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const $ = id => document.getElementById(id);
const details = $("details");
const body = $("editor-body");
const dropzone = $("dropzone");
const fields = ["name", "summary", "description"].map($);
let slug = new URLSearchParams(location.search).get("id") || "";
let plugin = null;
let icon = null;
let images = [];
let picked = null;
let saved = "";

function say(id, text) {
  $(id).textContent = text || "";
}

function snapshot() {
  return JSON.stringify([...fields.map(field => field.value.trim()), icon, images]);
}

function dirty() {
  return slug ? snapshot() !== saved : Boolean(picked || fields.some(field => field.value.trim()) || icon || images.length);
}

function changed() {
  if (slug) {
    $("save").disabled = !dirty();
    $("save-bar").classList.toggle("floating", dirty());
    if (dirty()) say("details-done");
  }
  counters();
  preview();
}

function counters() {
  for (const counter of document.querySelectorAll(".counter[data-for]")) {
    const field = $(counter.dataset.for);
    const max = Number(field.maxLength);
    counter.textContent = `${field.value.length}/${max}`;
    counter.classList.toggle("near", field.value.length > max * 0.9);
  }
  const shots = images.filter(name => !name.startsWith("yt:")).length;
  $("gallery-count").textContent = `${shots}/${MAX_IMAGES} · ${images.length - shots}/${MAX_VIDEOS}`;
}

function preview() {
  const latest = plugin?.versions?.find(version => !version.pending) || plugin?.versions?.[0];
  const shown = card({
    slug: slug || "preview",
    name: $("name").value.trim() || i18n.t("plugins.editor.name"),
    author: plugin?.author || session()?.name || "",
    icon,
    cover: images.find(name => !name.startsWith("yt:")) || null,
    downloads: plugin?.downloads || 0,
    version: picked?.version || latest?.version || null,
    state: plugin?.state,
  });
  shown.inert = true;
  $("preview").replaceChildren(shown);
}

function iconButton(className, label, path, disabled, action) {
  const button = el("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  button.disabled = disabled;
  button.addEventListener("click", action);
  return button;
}

function tile(name, index) {
  const video = name.startsWith("yt:");
  const item = el("div", video ? "tile clip" : "tile");
  const shot = el("div", "shot");
  const image = el("img");
  image.src = video ? `https://i.ytimg.com/vi/${encodeURIComponent(name.slice(3))}/mqdefault.jpg` : fileUrl(name);
  image.alt = "";
  shot.append(image);
  if (index === 0) shot.append(el("span", "badge", i18n.t("plugins.editor.cover")));
  const tools = el("div", "tile-tools");
  tools.append(
    iconButton("move", i18n.t("plugins.editor.moveLeft"), "M14.5 6 8.5 12l6 6", index === 0, () => move(index, -1)),
    iconButton("move", i18n.t("plugins.editor.moveRight"), "M9.5 6l6 6-6 6", index === images.length - 1, () => move(index, 1)),
    iconButton("remove", i18n.t("plugins.editor.remove"), "M6.5 6.5l11 11m0-11-11 11", false, () => {
      images = images.filter(other => other !== name);
      thumbs();
    }),
  );
  item.append(shot, tools);
  return item;
}

function adder() {
  const item = el("label", "tile add");
  const input = el("input");
  input.type = "file";
  input.accept = IMAGE_TYPES;
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    addImages(files);
  });
  const plus = el("span", "plus");
  plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  item.append(input, plus, el("span", null, i18n.t("plugins.editor.addScreenshots")));
  return item;
}

function move(index, step) {
  const target = index + step;
  if (target < 0 || target >= images.length) return;
  [images[index], images[target]] = [images[target], images[index]];
  thumbs();
  const moved = $("gallery").querySelectorAll(".tile")[target];
  const buttons = moved ? [...moved.querySelectorAll(".move")] : [];
  (buttons[step < 0 ? 0 : 1]?.disabled ? buttons[step < 0 ? 1 : 0] : buttons[step < 0 ? 0 : 1])?.focus();
}

function thumbs() {
  const frame = el("div", icon ? "icon-frame" : "icon-frame blank");
  if (icon) {
    const image = el("img");
    image.src = fileUrl(icon);
    image.alt = "";
    frame.append(image);
  }
  $("icon").replaceChildren(frame);
  $("icon-remove").hidden = !icon;
  const tiles = images.map(tile);
  if (images.filter(name => !name.startsWith("yt:")).length < MAX_IMAGES) tiles.push(adder());
  $("gallery").replaceChildren(...tiles);
  changed();
}

function videoId(text) {
  const trimmed = text.trim();
  const match = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(trimmed);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? trimmed : null;
}

async function send(files, apply) {
  say("media-error");
  for (const file of files) {
    say("media-done", i18n.t("plugins.editor.uploading"));
    const reply = await upload(file);
    say("media-done");
    if (!reply.ok) return say("media-error", message(reply));
    if (reply.data.kind !== "image") return say("media-error", i18n.t("plugins.editor.notImage"));
    apply(reply.data.file);
    thumbs();
  }
}

function addImages(files) {
  const room = Math.max(0, MAX_IMAGES - images.filter(name => !name.startsWith("yt:")).length);
  send(files.filter(file => file.type.startsWith("image/")).slice(0, room), name => {
    if (!images.includes(name)) images.push(name);
  });
}

async function pick(file) {
  picked = null;
  dropzone.classList.remove("ready");
  $("publish").disabled = true;
  say("version-error");
  say("version-done");
  say("version-picked", i18n.t("plugins.editor.uploading"));
  const reply = await upload(file);
  if (!reply.ok || reply.data.kind !== "plugin") {
    say("version-picked");
    return say("version-error", reply.ok ? i18n.t("plugins.editor.notPlugin") : message(reply));
  }
  picked = reply.data;
  dropzone.classList.add("ready");
  say("version-picked", i18n.t("plugins.editor.picked", { name: picked.name, api: picked.api, size: size(picked.size) }));
  if (!$("version").value) $("version").value = picked.version;
  $("publish").disabled = false;
  preview();
}

async function publish() {
  const reply = await post("version", { slug, file: picked.file, version: $("version").value, changes: $("changes").value });
  if (!reply.ok) return reply;
  picked = null;
  dropzone.classList.remove("ready");
  $("version").value = "";
  $("changes").value = "";
  say("version-picked");
  counters();
  return reply;
}

function banner(data) {
  const key = data.flagged ? "plugins.banner.flagged"
    : data.state === "hidden" ? "plugins.banner.hidden"
    : data.state === "pending" ? (data.versions.length ? "plugins.banner.pending" : "plugins.banner.noVersion")
    : null;
  $("banner").hidden = !key;
  if (key) $("banner").textContent = i18n.t(key);
}

function versions(data) {
  $("version-count").textContent = data.versions.length ? String(data.versions.length) : "";
  $("block-versions").hidden = !data.versions.length;
  const live = data.versions.findIndex(entry => !entry.pending);
  $("version-list").replaceChildren(...data.versions.map((version, index) => {
    const item = el("li");
    const row = el("div", "release-row");
    const remove = el("button", "link delete", i18n.t("plugins.editor.deleteVersion"));
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(i18n.t("plugins.editor.confirmDeleteVersion", { version: version.version }))) return;
      const reply = await post("version/delete", { slug, version: version.version });
      if (reply.ok) refresh(false);
      else alert(message(reply));
    });
    const facts = [date(version.created), `${i18n.t("plugins.facts.api")}\u00a0${version.api}+`, size(version.size), i18n.t("plugins.downloads", { count: version.downloads })];
    const text = el("div", "release-text");
    const name = el("p", "release-name", version.version);
    if (version.pending) name.append(" ", el("span", "current pending", i18n.t("plugins.states.pending")));
    else if (index === live) name.append(" ", el("span", "current", i18n.t("plugins.current")));
    text.append(name, el("p", "release-facts", facts.join(" · ")));
    const scan = scanLine(version);
    if (scan) text.append(scan);
    row.append(text, remove);
    item.append(row);
    return item;
  }));
}

function head(data) {
  $("heading").textContent = data.name;
  document.title = `${data.name} - OpenKogama`;
  $("crumb-link").textContent = data.name;
  $("crumb-link").href = page(data.slug);
  $("crumb-plugin").hidden = false;
  const frame = $("head-icon");
  frame.hidden = !data.icon;
  if (data.icon) {
    const image = el("img");
    image.src = fileUrl(data.icon);
    image.alt = "";
    frame.replaceChildren(image);
  }
  const state = $("head-state");
  state.hidden = !data.state;
  if (data.state) {
    state.className = `state ${stateOf(data)}`;
    state.textContent = i18n.t(`plugins.states.${stateOf(data)}`);
  }
}

function fill(data) {
  head(data);
  $("file-heading").textContent = i18n.t("plugins.editor.newVersion");
  $("tabs").hidden = false;
  $("danger").hidden = false;
  $("changes-field").hidden = false;
  $("publish-row").hidden = false;
  $("save").textContent = i18n.t("plugins.editor.saveChanges");
  $("name").value = data.name;
  $("summary").value = data.summary;
  $("description").value = data.description;
  icon = data.icon;
  images = [...data.images];
  saved = snapshot();
  thumbs();
  $("open").href = page(data.slug);
  $("open").hidden = false;
  body.classList.add("tabbed");
  show(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "about");
  if (location.hash) requestAnimationFrame(() => window.scrollTo(0, 0));
  body.hidden = false;
}

function show(tab) {
  body.dataset.show = tab;
  for (const link of $("tabs").querySelectorAll("[data-target]")) {
    const on = link.dataset.target === tab;
    link.setAttribute("aria-selected", String(on));
    link.tabIndex = on ? 0 : -1;
  }
}

async function refresh(everything) {
  const reply = await post("view", { slug });
  if (!reply.ok && !everything) return say("details-error", message(reply));
  if (!reply.ok) {
    body.hidden = true;
    if (reply.status !== 404) {
      const text = $("missing").querySelector("span");
      text.removeAttribute("data-i18n");
      text.textContent = message(reply);
    }
    $("missing").hidden = false;
    return;
  }
  plugin = reply.data;
  if (everything) fill(plugin);
  else head(plugin);
  banner(plugin);
  versions(plugin);
  preview();
}

function invalid() {
  const problem = $("name").value.trim().length < 2 ? ["name", "plugins.editor.nameLength"]
    : !$("summary").value.trim() ? ["summary", "plugins.editor.summaryRequired"]
    : null;
  if (!problem) return false;
  if (body.classList.contains("tabbed")) show("about");
  const field = $(problem[0]);
  field.closest(".box").classList.add("invalid");
  field.focus();
  say("details-error", i18n.t(problem[1]));
  return true;
}

details.addEventListener("submit", async event => {
  event.preventDefault();
  say("details-error");
  say("details-done");
  say("version-error");
  if (invalid()) return;
  if (!slug && !picked) {
    say("version-error", i18n.t("plugins.editor.fileRequired"));
    dropzone.scrollIntoView({ block: "center" });
    return;
  }
  $("save").disabled = true;
  const reply = await post("save", {
    slug: slug || undefined,
    name: $("name").value,
    summary: $("summary").value,
    description: $("description").value,
    video: "",
    icon,
    images,
  });
  if (!reply.ok) {
    $("save").disabled = false;
    return say("details-error", message(reply));
  }
  if (slug) {
    saved = snapshot();
    await refresh(false);
    changed();
    return say("details-done", i18n.t("plugins.editor.saved"));
  }
  slug = reply.data.slug;
  const released = await publish();
  if (!released.ok) {
    $("save").disabled = false;
    history.replaceState(null, "", `?id=${encodeURIComponent(slug)}#versions`);
    await refresh(true);
    return say("version-error", message(released));
  }
  saved = snapshot();
  location.href = page(slug);
});

$("publish").addEventListener("click", async () => {
  if (!picked) return;
  say("version-error");
  say("version-done");
  $("publish").disabled = true;
  const version = $("version").value;
  const reply = await publish();
  if (!reply.ok) {
    $("publish").disabled = false;
    return say("version-error", message(reply));
  }
  say("version-done", i18n.t("plugins.editor.published", { version: reply.data.version || version }));
  refresh(false);
});

$("version-file").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) pick(file);
});

for (const [target, drop] of [[dropzone, files => files[0] && pick(files[0])], [$("gallery"), addImages]]) {
  for (const type of ["dragenter", "dragover"]) target.addEventListener(type, event => {
    event.preventDefault();
    target.classList.add("over");
  });
  for (const type of ["dragleave", "drop"]) target.addEventListener(type, () => target.classList.remove("over"));
  target.addEventListener("drop", event => {
    event.preventDefault();
    drop([...event.dataTransfer.files]);
  });
}

$("delete").addEventListener("click", async () => {
  if (!confirm(i18n.t("plugins.editor.confirmDelete", { name: plugin?.name || $("name").value }))) return;
  const reply = await post("delete", { slug });
  if (!reply.ok) return alert(message(reply));
  saved = snapshot();
  location.href = new URL("../", location.href).href;
});

$("icon-file").addEventListener("change", event => {
  const files = [...event.target.files].slice(0, 1);
  event.target.value = "";
  send(files, name => { icon = name; });
});

$("icon-remove").addEventListener("click", () => {
  icon = null;
  thumbs();
});

function addVideo() {
  say("media-error");
  const id = videoId($("video").value);
  if (!id) return say("media-error", i18n.t("plugins.editor.badVideo"));
  if (images.filter(name => name.startsWith("yt:")).length >= MAX_VIDEOS) return say("media-error", i18n.t("plugins.editor.tooManyVideos"));
  if (!images.includes("yt:" + id)) images.push("yt:" + id);
  $("video").value = "";
  thumbs();
}

$("add-video").addEventListener("click", addVideo);
$("video").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addVideo();
});

$("summary").addEventListener("keydown", event => {
  if (event.key === "Enter") event.preventDefault();
});
$("summary").addEventListener("input", () => {
  const field = $("summary");
  if (field.value.includes("\n")) field.value = field.value.replace(/\s*\n\s*/g, " ");
});

for (const field of [...fields, $("changes")]) field.addEventListener("input", () => {
  field.closest(".box").classList.remove("invalid");
  changed();
});

$("tabs").addEventListener("click", event => {
  const link = event.target.closest("[data-target]");
  if (!link) return;
  event.preventDefault();
  show(link.dataset.target);
  history.replaceState(null, "", "#" + link.dataset.target);
});

$("tabs").addEventListener("keydown", event => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  const next = TABS[(TABS.indexOf(body.dataset.show) + step + TABS.length) % TABS.length];
  show(next);
  history.replaceState(null, "", "#" + next);
  $("tabs").querySelector(`[data-target="${next}"]`).focus();
});

window.addEventListener("hashchange", () => {
  if (body.classList.contains("tabbed") && TABS.includes(location.hash.slice(1))) show(location.hash.slice(1));
});

window.addEventListener("beforeunload", event => {
  if (!body.hidden && (dirty() || picked)) event.preventDefault();
});

for (const button of document.querySelectorAll("#description-modes button")) button.addEventListener("click", () => {
  const preview = button.dataset.mode === "preview";
  for (const other of document.querySelectorAll("#description-modes button")) other.setAttribute("aria-pressed", String(other === button));
  $("description-preview").hidden = !preview;
  $("description").closest(".box").hidden = preview;
  if (preview) $("description-preview").replaceChildren(render($("description").value));
});

i18n.ready.then(() => {
  if (!session()) {
    document.querySelector(".editor-head").hidden = true;
    const account = new URL($("signin").querySelector("a").href);
    account.searchParams.set("next", location.pathname + location.search + location.hash);
    $("signin").querySelector("a").href = account.href;
    $("signin").hidden = false;
    return;
  }
  if (slug) {
    $("heading").textContent = i18n.t("plugins.editor.editHeading");
    refresh(true);
  } else {
    thumbs();
    body.hidden = false;
  }
});
