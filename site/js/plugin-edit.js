import { date, el, fileUrl, message, page, post, session, size, upload } from "./catalog.js";

const MAX_IMAGES = 6;
const MAX_VIDEOS = 2;
const $ = id => document.getElementById(id);
const details = $("details");
const body = $("editor-body");
const dropzone = $("dropzone");
let slug = new URLSearchParams(location.search).get("id") || "";
let icon = null;
let images = [];
let picked = null;

function say(id, text) {
  $(id).textContent = text || "";
}

function thumb(name, remove) {
  const item = el("div", "thumb");
  const image = el("img");
  image.src = fileUrl(name);
  image.alt = "";
  const button = el("button", "remove", "\u00d7");
  button.type = "button";
  button.title = i18n.t("plugins.editor.remove");
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", remove);
  item.append(image, button);
  return item;
}

function control(className, text, title, disabled, action) {
  const button = el("button", className, text);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.addEventListener("click", action);
  return button;
}

function tile(name, index) {
  const video = name.startsWith("yt:");
  const item = el("div", video ? "tile clip" : "tile");
  const image = el("img");
  image.src = video ? `https://i.ytimg.com/vi/${encodeURIComponent(name.slice(3))}/mqdefault.jpg` : fileUrl(name);
  image.alt = "";
  item.append(image,
    control("left", "\u2039", i18n.t("plugins.editor.moveLeft"), index === 0, () => move(index, -1)),
    control("right", "\u203a", i18n.t("plugins.editor.moveRight"), index === images.length - 1, () => move(index, 1)),
    control("remove", "\u00d7", i18n.t("plugins.editor.remove"), false, () => {
      images = images.filter(other => other !== name);
      thumbs();
    }));
  return item;
}

function move(index, step) {
  const target = index + step;
  if (target < 0 || target >= images.length) return;
  [images[index], images[target]] = [images[target], images[index]];
  thumbs();
}

function thumbs() {
  $("icon").replaceChildren(...(icon ? [thumb(icon, () => { icon = null; thumbs(); })] : []));
  $("images").replaceChildren(...images.map(tile));
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
}

async function publish() {
  const reply = await post("version", { slug, file: picked.file, version: $("version").value, changes: $("changes").value });
  if (!reply.ok) return reply;
  picked = null;
  dropzone.classList.remove("ready");
  $("version").value = "";
  $("changes").value = "";
  say("version-picked");
  return reply;
}

function banner(plugin) {
  const key = plugin.flagged ? "plugins.banner.flagged"
    : plugin.state === "hidden" ? "plugins.banner.hidden"
    : plugin.state === "pending" ? (plugin.versions.length ? "plugins.banner.pending" : "plugins.banner.noVersion")
    : null;
  $("banner").hidden = !key;
  if (key) $("banner").textContent = i18n.t(key);
}

function versions(plugin) {
  $("version-list").replaceChildren(...plugin.versions.map(version => {
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
    const facts = [date(version.created), `${i18n.t("plugins.facts.api")} ${version.api}+`, size(version.size), i18n.t("plugins.downloads", { count: version.downloads })];
    const text = el("div", "release-text");
    const name = el("p", "release-name", version.version);
    if (version.pending) name.append(" ", el("span", "current pending", i18n.t("plugins.states.pending")));
    text.append(name, el("p", "release-facts", facts.join(" · ")));
    row.append(text, remove);
    item.append(row);
    return item;
  }));
}

function fill(plugin) {
  $("heading").textContent = i18n.t("plugins.editor.editHeading");
  document.title = `${plugin.name} - OpenKogama`;
  $("file-heading").textContent = i18n.t("plugins.editor.newVersion");
  $("nav-file").textContent = i18n.t("plugins.editor.newVersion");
  $("nav-danger").hidden = false;
  $("danger").hidden = false;
  $("crumb-link").textContent = plugin.name;
  $("crumb-link").href = page(plugin.slug);
  $("crumb-plugin").hidden = false;
  $("changes-field").hidden = false;
  $("publish").hidden = false;
  $("save").textContent = i18n.t("plugins.editor.saveChanges");
  $("name").value = plugin.name;
  $("summary").value = plugin.summary;
  $("description").value = plugin.description;
  icon = plugin.icon;
  images = [...plugin.images];
  thumbs();
  $("open").href = page(plugin.slug);
  $("open").hidden = false;
  body.hidden = false;
}

async function refresh(everything) {
  const reply = await post("view", { slug });
  if (!reply.ok) {
    body.hidden = true;
    $("missing").hidden = false;
    return;
  }
  if (everything) fill(reply.data);
  banner(reply.data);
  versions(reply.data);
}

details.addEventListener("submit", async event => {
  event.preventDefault();
  say("details-error");
  say("details-done");
  say("version-error");
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
    $("save").disabled = false;
    await refresh(false);
    return say("details-done", i18n.t("plugins.editor.saved"));
  }
  slug = reply.data.slug;
  const released = await publish();
  if (!released.ok) {
    $("save").disabled = false;
    history.replaceState(null, "", `?id=${encodeURIComponent(slug)}`);
    await refresh(true);
    return say("version-error", message(released));
  }
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

for (const type of ["dragenter", "dragover"]) dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.add("over");
});
for (const type of ["dragleave", "drop"]) dropzone.addEventListener(type, () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", event => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) pick(file);
});

$("delete").addEventListener("click", async () => {
  if (!confirm(i18n.t("plugins.editor.confirmDelete", { name: $("name").value }))) return;
  const reply = await post("delete", { slug });
  if (reply.ok) location.href = new URL("../", location.href).href;
  else alert(message(reply));
});

$("icon-file").addEventListener("change", event => {
  const files = [...event.target.files].slice(0, 1);
  event.target.value = "";
  send(files, name => { icon = name; });
});

$("add-video").addEventListener("click", () => {
  say("media-error");
  const id = videoId($("video").value);
  if (!id) return say("media-error", i18n.t("plugins.editor.badVideo"));
  if (images.filter(name => name.startsWith("yt:")).length >= MAX_VIDEOS) return say("media-error", i18n.t("plugins.editor.tooManyVideos"));
  if (!images.includes("yt:" + id)) images.push("yt:" + id);
  $("video").value = "";
  thumbs();
});

$("images-file").addEventListener("change", event => {
  const files = [...event.target.files].slice(0, Math.max(0, MAX_IMAGES - images.filter(name => !name.startsWith("yt:")).length));
  event.target.value = "";
  send(files, name => {
    if (!images.includes(name)) images.push(name);
  });
});

i18n.ready.then(() => {
  if (!session()) {
    $("heading").hidden = true;
    $("signin").hidden = false;
    return;
  }
  if (slug) refresh(true);
  else body.hidden = false;
});

function spy() {
  const links = [...document.querySelectorAll(".editor-nav a:not([hidden])")];
  let current = links[0];
  for (const link of links) {
    const target = document.querySelector(link.getAttribute("href"));
    if (target && target.getBoundingClientRect().top <= 120) current = link;
  }
  for (const link of links) link.classList.toggle("current", link === current);
}

window.addEventListener("scroll", spy, { passive: true });
window.addEventListener("load", spy);
