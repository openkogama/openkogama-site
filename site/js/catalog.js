import { liked, toggle } from "./likes.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = (LOCAL ? "http://127.0.0.1:8098" : "https://accounts.openkogama.org") + "/plugins";
const KEY = "openkogama-account";
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
export const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
export const PENCIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg>';
export const SHIELD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/></svg>';
export const SHIELD_X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M10 10l4 4m0 -4l-4 4"/></svg>';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function session() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved && saved.token ? saved : null;
  } catch {
    return null;
  }
}

async function answer(request) {
  try {
    const response = await request;
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export function get(path = "") {
  return answer(fetch(API + path));
}

export function post(path, body = {}) {
  return answer(fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token: session()?.token }),
  }));
}

export function upload(file) {
  return answer(fetch(`${API}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session()?.token || ""}` },
    body: file,
  }));
}

export async function save(slug, version) {
  try {
    const response = await fetch(downloadUrl(slug, version.version), {
      method: "POST",
      headers: { Authorization: `Bearer ${session()?.token || ""}` },
    });
    if (!response.ok) return false;
    const link = el("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = version.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return true;
  } catch {
    return false;
  }
}

export function message(reply) {
  if (reply.status === 0) return i18n.t("account.errors.offline");
  const text = reply.data.error;
  if (!text) return i18n.t("account.errors.status", { status: String(reply.status) });
  return text[0].toUpperCase() + text.slice(1) + ".";
}

export function fileUrl(name) {
  return `${API}/files/${name}`;
}

export function downloadUrl(slug, version) {
  return `${API}/${encodeURIComponent(slug)}/download` + (version ? `/${encodeURIComponent(version)}` : "");
}

export function page(slug) {
  return new URL(`../plugin/?id=${encodeURIComponent(slug)}`, import.meta.url).href;
}

export function editor(slug) {
  return new URL("../plugins/edit/" + (slug ? `?id=${encodeURIComponent(slug)}` : ""), import.meta.url).href;
}

export function size(bytes) {
  const kilobytes = Math.max(1, Math.round(bytes / 1024));
  return new Intl.NumberFormat(i18n.lang, { style: "unit", unit: "kilobyte", unitDisplay: "short" }).format(kilobytes).replace(/ /g, "\u00a0");
}

export function stateOf(plugin) {
  return plugin.state === "pending" && !plugin.version && !plugin.versions?.length ? "draft" : plugin.state;
}

export function date(seconds) {
  return new Intl.DateTimeFormat(i18n.lang, { dateStyle: "medium" }).format(new Date(seconds * 1000));
}

export function picture(plugin) {
  const frame = el("div", plugin.cover ? "picture" : "picture blank");
  const name = plugin.cover || plugin.icon;
  if (!name) return frame;
  const image = el("img", plugin.cover ? null : "logo");
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("load", () => image.classList.add("shown"), { once: true });
  image.src = fileUrl(name);
  frame.append(image);
  return frame;
}

function showLiked(button, on) {
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = i18n.t(on ? "common.unlike" : "common.like");
  button.setAttribute("aria-label", button.title);
}

export function likeButton(plugin) {
  const button = el("button", "icon like");
  button.type = "button";
  button.innerHTML = HEART_ICON;
  button.dataset.sha = plugin.slug;
  showLiked(button, liked("plugins", plugin.slug));
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggle("plugins", plugin.slug);
  });
  return button;
}

function count(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(value);
}

function stats(plugin) {
  const box = el("div", "stats");
  const downloads = plugin.downloads || 0;
  const item = el("span");
  item.innerHTML = DOWNLOAD_ICON;
  item.append(count(downloads));
  item.title = i18n.t("plugins.downloads", { count: downloads });
  box.append(item);
  return box;
}

function tool(className, href, title, icon) {
  const tools = el("div", "tools");
  const link = el("a", `icon ${className}`);
  link.href = href;
  link.title = title;
  link.setAttribute("aria-label", title);
  link.innerHTML = icon;
  tools.append(link);
  return tools;
}

export function card(plugin, editable) {
  const href = page(plugin.slug);
  const article = el("article", "card map plugin");
  const frame = picture(plugin);
  const open = el("a", "open");
  open.href = href;
  open.tabIndex = -1;
  open.setAttribute("aria-hidden", "true");
  frame.append(open);
  if (plugin.state) frame.append(el("span", `state ${stateOf(plugin)}`, i18n.t(`plugins.states.${stateOf(plugin)}`)));
  if (editable === true) frame.append(tool("edit", editor(plugin.slug), i18n.t("plugins.edit"), PENCIL_ICON));
  else if (!plugin.state && plugin.version) frame.append(tool("save", downloadUrl(plugin.slug), i18n.t("common.downloadFile", { extension: ".dll" }), DOWNLOAD_ICON));
  frame.append(likeButton(plugin), stats(plugin));
  const caption = el("div", "caption");
  const title = el("p", "name");
  const link = el("a", null, plugin.name);
  link.href = href;
  title.append(link);
  title.title = plugin.name;
  caption.append(title);
  if (plugin.version) caption.append(el("span", "tag", plugin.version));
  const meta = el("p", "meta");
  const author = el("a", "author", plugin.author);
  author.href = new URL(`../plugins/?q=${encodeURIComponent(plugin.author)}`, import.meta.url).href;
  meta.append(...i18n.parts("common.by", { author }));
  article.append(frame, caption, meta);
  return article;
}

export function scanLine(version) {
  const scan = version.scan;
  if (!scan) return null;
  const box = el("span", "scan");
  if (scan.state !== "done") {
    box.classList.add("pending");
    box.innerHTML = SHIELD_ICON;
    box.append(i18n.t("plugins.scan.pending"));
    return box;
  }
  const flagged = scan.malicious + scan.suspicious;
  box.classList.add(flagged ? "flagged" : "clean");
  box.innerHTML = flagged ? SHIELD_X_ICON : SHIELD_ICON;
  box.append(i18n.t(flagged ? "plugins.scan.flagged" : "plugins.scan.clean", { flagged, total: scan.total }), " ");
  const link = el("a", null, i18n.t("plugins.scan.report"));
  link.href = scan.url;
  link.target = "_blank";
  link.rel = "noopener";
  box.append(link);
  return box;
}

document.addEventListener("liked", ({ detail }) => {
  if (detail.kind !== "plugins") return;
  for (const button of document.querySelectorAll(`.like[data-sha="${CSS.escape(detail.sha)}"]`)) showLiked(button, detail.liked);
});
