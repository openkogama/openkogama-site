import { liked, mapKey, toggle } from "./likes.js";

const view = document.getElementById("map");
const IMAGES = "https://cdn.openkogama.org/maps/v1/images/";
const HOSTS = { www: "www.kogama.com", br: "kogama.com.br", friends: "friends.kogama.com" };
const REGIONS = { www: "maps.regions.www", br: "maps.regions.br", friends: "maps.regions.friends" };
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>';
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3 4.4 12.9a4.8 4.8 0 0 1 6.8-6.8l.8.8.8-.8a4.8 4.8 0 0 1 6.8 6.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12 18 5.5M6 12l12 6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.8" fill="currentColor"/><circle cx="18" cy="5.5" r="2.8" fill="currentColor"/><circle cx="18" cy="18.5" r="2.8" fill="currentColor"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.2V12l3.2 2.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function section(className, heading, ...content) {
  const block = el("section", className);
  block.append(el("h2", null, heading), ...content);
  return block;
}

function line(label, value) {
  if (!value) return null;
  const row = el("div");
  const data = el("dd");
  data.append(value);
  row.append(el("dt", null, label), data);
  return row;
}

function title(map) {
  return map.name || i18n.t("common.untitledMap");
}

function date(value) {
  return value ? new Date(value).toLocaleDateString(i18n.lang, { dateStyle: "medium", timeZone: "UTC" }) : "";
}

function size(bytes) {
  const mega = bytes >= 1e6;
  return new Intl.NumberFormat(i18n.lang, { style: "unit", unit: mega ? "megabyte" : "kilobyte", unitDisplay: "short", minimumFractionDigits: mega ? 1 : 0, maximumFractionDigits: mega ? 1 : 0 })
    .format(mega ? bytes / 1e6 : Math.max(1, Math.round(bytes / 1e3))).replace(/ /g, " ");
}

function count(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(value);
}

function fileName(map) {
  const name = Array.from(title(map).normalize("NFC").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 60).join("").replace(/[. ]+$/, "");
  return `${name || "map"}${map.id ? " " + map.id : ""}.${map.format}`;
}

function playLink(map) {
  const link = el("a", "button accent big");
  link.href = "../play/?" + new URLSearchParams({ import: map.url, name: title(map) });
  link.innerHTML = PLAY_ICON;
  link.append(el("span", null, i18n.t("common.play")));
  return link;
}

function shareButton() {
  const button = el("button", "button secondary share-link");
  button.type = "button";
  button.innerHTML = SHARE_ICON;
  const text = el("span", null, i18n.t("plugins.shareLink"));
  text.setAttribute("aria-live", "polite");
  button.append(text);
  let timer;
  button.addEventListener("click", async () => {
    const url = location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    text.textContent = i18n.t("plugins.copied");
    clearTimeout(timer);
    timer = setTimeout(() => { text.textContent = i18n.t("plugins.shareLink"); }, 2000);
  });
  return button;
}

function saveButton(map) {
  const button = el("button", "icon save button secondary");
  button.type = "button";
  button.innerHTML = DOWNLOAD_ICON;
  button.title = i18n.t("common.downloadFile", { extension: "." + map.format });
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch(map.url);
      if (!response.ok) throw new Error(response.status);
      const link = el("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = fileName(map);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    } catch (error) {
      console.warn(map.slug, error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function likeButton(map) {
  const key = mapKey({ id: map.id, site: map.site || "", name: map.name || "Untitled map" });
  const button = el("button", "icon like button secondary");
  button.type = "button";
  button.innerHTML = HEART_ICON;
  function paint() {
    const on = liked("maps", key);
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.title = i18n.t(on ? "common.unlike" : "common.like");
    button.setAttribute("aria-label", button.title);
  }
  button.addEventListener("click", () => {
    toggle("maps", key);
    paint();
  });
  paint();
  return button;
}

function shareRow(map) {
  const row = el("div", "share-row");
  row.append(shareButton(), saveButton(map), likeButton(map));
  return row;
}

function creator(map) {
  if (!map.author) return null;
  const box = el("div", "panel creator");
  const who = el("div", "who");
  const link = el("a", null, map.author);
  link.href = "../maps/?" + new URLSearchParams({ author: map.authorId ? `${map.site || ""}:${map.authorId}` : `name:${map.author}` });
  link.title = i18n.t("maps.showByAuthor");
  who.append(el("small", null, i18n.t("maps.kogamaAuthor")), link);
  box.append(who);
  return box;
}

function media(map) {
  if (!map.image) return el("div", "media blank");
  const box = el("div", "media");
  const image = el("img");
  image.src = `${IMAGES}${map.image}.jpg`;
  image.alt = title(map);
  box.append(image);
  return box;
}

function figure(icon, value, caption) {
  const item = el("div", "number");
  item.innerHTML = icon;
  item.append(el("strong", null, value), el("span", null, caption));
  return item;
}

function numbers(map) {
  const row = el("div", "numbers");
  if (map.plays != null) row.append(figure(PLAY_ICON, map.plays.toLocaleString(i18n.lang), i18n.t("maps.facts.plays")));
  if (map.likes != null) row.append(figure(HEART_ICON, map.likes.toLocaleString(i18n.lang), i18n.t("maps.facts.likes")));
  if (map.published) row.append(figure(CLOCK_ICON, date(map.published), i18n.t("maps.facts.published")));
  return row.children.length ? row : null;
}

function about(map) {
  if (!map.description) return null;
  const text = el("div", "prose");
  text.append(el("p", "description", map.description));
  return section("panel writeup", i18n.t("plugins.about"), text);
}

function anchor(href, text) {
  const link = el("a", null, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function specs(map) {
  const host = HOSTS[map.site];
  const facts = el("dl");
  facts.append(...[
    line(i18n.t("maps.facts.id"), map.id),
    line(i18n.t("maps.facts.region"), i18n.t(REGIONS[map.site] || "maps.regions.unknown")),
    line(i18n.t("maps.facts.file"), map.size ? `${size(map.size)} .${map.format}` : ""),
    line(i18n.t("maps.facts.created"), date(map.created)),
    line(i18n.t("maps.facts.published"), date(map.published)),
    line(i18n.t("maps.facts.originalPage"), map.id && host ? anchor(`https://web.archive.org/web/2024/https://${host}/games/play/${map.id}/`, `${host}/games/play/${map.id}`) : null),
  ].filter(Boolean));
  return section("panel specs", i18n.t("maps.details"), facts);
}

function card([slug, name, image, plays]) {
  const href = `../maps/${slug}/`;
  const article = el("article", "card map");
  const frame = el("a", image ? "picture" : "picture blank");
  frame.href = href;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  if (image) {
    const picture = el("img");
    picture.alt = "";
    picture.loading = "lazy";
    picture.addEventListener("load", () => picture.classList.add("shown"), { once: true });
    picture.src = `${IMAGES}${image}.jpg`;
    frame.append(picture);
  }
  if (plays != null) {
    const stats = el("div", "stats");
    const item = el("span");
    item.innerHTML = PLAY_ICON;
    item.append(count(plays));
    stats.append(item);
    frame.append(stats);
  }
  const caption = el("div", "caption");
  const link = el("a", "name", name || i18n.t("common.untitledMap"));
  link.href = href;
  link.title = link.textContent;
  caption.append(link);
  article.append(frame, caption);
  return article;
}

function more(map) {
  if (!map.others?.length) return null;
  const grid = el("div", "grid maps");
  grid.append(...map.others.map(card));
  return section("more", i18n.t("maps.moreBy", { name: map.author }), grid);
}

function render(map) {
  const masthead = el("header", "masthead");
  masthead.append(el("h1", null, title(map)));
  const side = el("div", "side");
  side.append(...[playLink(map), shareRow(map), creator(map)].filter(Boolean));
  const content = el("div", "content");
  content.append(...[media(map), numbers(map), about(map), specs(map)].filter(Boolean));
  const layout = el("div", "layout");
  layout.append(side, content);
  view.replaceChildren(...[masthead, layout, more(map)].filter(Boolean));
}

function missing() {
  const id = /^\/maps\/(?:[a-z]+-)?(\d+)(?:-\d+)?\/$/.exec(location.pathname)?.[1];
  if (id) return location.replace("../maps/?q=" + id);
  const note = el("p", "note", i18n.t("maps.notFound") + " ");
  const back = el("a", null, i18n.t("maps.all"));
  back.href = "../maps/";
  note.append(back);
  view.replaceChildren(note);
}

i18n.ready.then(() => window.mapPreload ? render(window.mapPreload) : missing());
