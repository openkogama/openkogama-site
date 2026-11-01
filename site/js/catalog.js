import { liked, toggle } from "./likes.js";

const CATALOG = new URL("../plugins.json", import.meta.url);
const RELEASES = "https://api.github.com/repos/openkogama/openkogama-site/releases?per_page=100";
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
export const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function catalog() {
  try {
    const response = await fetch(CATALOG, { cache: "no-store" });
    const plugins = await response.json();
    return Array.isArray(plugins) ? plugins : [];
  } catch {
    return [];
  }
}

export async function downloads() {
  try {
    const response = await fetch(RELEASES);
    if (!response.ok) return null;
    const counts = new Map();
    for (const release of await response.json()) {
      for (const asset of release.assets) counts.set(asset.browser_download_url, asset.download_count);
    }
    return counts;
  } catch {
    return null;
  }
}

export function downloadCount(plugin, counts) {
  if (!counts) return null;
  return (plugin.versions || []).reduce((sum, version) => sum + (counts.get(version.file) || 0), 0);
}

export function size(bytes) {
  const kilobytes = Math.max(1, Math.round(bytes / 1024));
  return new Intl.NumberFormat(i18n.lang, { style: "unit", unit: "kilobyte", unitDisplay: "short" }).format(kilobytes);
}

export function page(plugin) {
  return new URL(`../plugin/?id=${encodeURIComponent(plugin.id)}`, import.meta.url).href;
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
  button.dataset.sha = plugin.id;
  showLiked(button, liked("plugins", plugin.id));
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggle("plugins", plugin.id);
  });
  return button;
}

export function saveLink(version) {
  const link = el("a", "icon save");
  link.href = version.file;
  link.title = i18n.t("common.downloadFile", { extension: ".dll" });
  link.setAttribute("aria-label", link.title);
  link.innerHTML = DOWNLOAD_ICON;
  return link;
}

document.addEventListener("liked", ({ detail }) => {
  if (detail.kind !== "plugins") return;
  for (const button of document.querySelectorAll(`.like[data-sha="${CSS.escape(detail.sha)}"]`)) showLiked(button, detail.liked);
});
