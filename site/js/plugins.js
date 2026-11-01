import { catalog, downloadCount, downloads, el, likeButton, page, saveLink } from "./catalog.js";

const grid = document.getElementById("cards");
const note = document.getElementById("note");

function meta(plugin, counts) {
  const parts = [];
  if (plugin.author) parts.push(plugin.author);
  const count = downloadCount(plugin, counts);
  if (count != null) parts.push(i18n.t("plugins.downloads", { count }));
  return parts.join(" · ");
}

function entry(plugin) {
  const href = page(plugin);
  const article = el("article", "card map plugin");
  const frame = el("div", "picture");
  const open = el("a", "open");
  open.href = href;
  open.setAttribute("aria-label", plugin.name);
  frame.append(open);
  const latest = plugin.versions?.[0];
  if (latest) {
    const tools = el("div", "tools");
    tools.append(saveLink(latest));
    frame.append(tools);
  }
  frame.append(likeButton(plugin));
  const title = el("p", "name");
  const link = el("a", null, plugin.name);
  link.href = href;
  title.append(link);
  title.title = plugin.name;
  article.append(frame, title, el("p", "meta", meta(plugin, null)));
  return article;
}

i18n.ready.then(async () => {
  const counting = downloads();
  const plugins = await catalog();
  if (!plugins.length) {
    note.textContent = i18n.t("plugins.empty");
    note.hidden = false;
    return;
  }
  const cards = plugins.map(entry);
  grid.append(...cards);
  const counts = await counting;
  plugins.forEach((plugin, index) => { cards[index].querySelector(".meta").textContent = meta(plugin, counts); });
});
