import { catalog, downloadCount, downloads, el, likeButton, size } from "./catalog.js";

const view = document.getElementById("plugin");

function anchor(className, text, href) {
  const link = el("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function line(label, value) {
  if (!value) return null;
  const row = el("div");
  const data = el("dd");
  if (value instanceof Node) data.append(value);
  else data.textContent = value;
  row.append(el("dt", null, label), data);
  return row;
}

function section(heading, ...content) {
  const block = el("section");
  block.append(el("h2", null, heading), ...content);
  return block;
}

function render(plugin, counts) {
  const latest = plugin.versions?.[0];
  const count = downloadCount(plugin, counts);
  const cover = el("div", "map");
  cover.append(el("div", "picture"));
  const info = el("div", "info");
  info.append(el("h1", null, plugin.name));
  if (plugin.author) info.append(el("p", "by", i18n.t("common.by", { author: plugin.author })));
  if (count != null) info.append(el("p", "count", i18n.t("plugins.downloads", { count })));
  if (plugin.description) info.append(el("p", "desc", plugin.description));
  const actions = el("div", "actions");
  actions.append(likeButton(plugin));
  if (latest) {
    const download = el("a", "button primary", i18n.t("common.download"));
    download.href = latest.file;
    actions.append(download);
  }
  if (plugin.source) actions.append(anchor("button secondary", i18n.t("common.source"), plugin.source));
  info.append(actions);
  if (!latest) info.append(el("p", "hint", i18n.t("plugins.notReady")));
  const head = el("div", "head");
  head.append(cover, info);

  const steps = el("ol", "steps");
  for (const key of ["download", "folder", "reload"]) steps.append(el("li", null, i18n.t(`plugins.steps.${key}`)));
  const blocks = [head, section(i18n.t("plugins.installHeading"), steps)];

  if (latest) {
    const facts = el("dl");
    facts.append(...[
      line(i18n.t("plugins.facts.version"), latest.version),
      line(i18n.t("plugins.facts.api"), latest.api + "+"),
      line(i18n.t("plugins.facts.file"), `${size(latest.size)} .dll`),
      line(i18n.t("plugins.facts.downloads"), count != null && count.toLocaleString(i18n.lang)),
      line("SHA-256", latest.sha256),
      line(i18n.t("common.source"), plugin.source && anchor(null, plugin.source.replace(/^https:\/\//, ""), plugin.source)),
    ].filter(Boolean));
    blocks.push(section(i18n.t("plugins.detailsHeading"), facts));
  }

  if (plugin.versions?.length > 1) {
    const list = el("ul", "versions");
    for (const version of plugin.versions) {
      const item = el("li");
      const link = el("a", null, version.version);
      link.href = version.file;
      item.append(link, ` · ${i18n.t("plugins.facts.api")} ${version.api}+ · ${size(version.size)}`);
      list.append(item);
    }
    blocks.push(section(i18n.t("plugins.versionsHeading"), list));
  }
  view.replaceChildren(...blocks);
}

i18n.ready.then(async () => {
  const counting = downloads();
  const id = new URLSearchParams(location.search).get("id");
  const plugin = (await catalog()).find(item => item.id === id);
  if (!plugin) {
    view.replaceChildren(el("p", "note", i18n.t("plugins.notFound")));
    return;
  }
  document.title = `${plugin.name} - OpenKogama`;
  render(plugin, null);
  const counts = await counting;
  if (counts) render(plugin, counts);
});
