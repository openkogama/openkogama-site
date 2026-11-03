import { inline, render as markdown } from "./markdown.js";
import { date, DOWNLOAD_ICON, downloadUrl, editor, el, fileUrl, get, likeButton, message, PENCIL_ICON, post, save, scanLine, session, SHIELD_ICON, SHIELD_X_ICON, size } from "./catalog.js";

const view = document.getElementById("plugin");
const slug = /^\/plugins\/([^/]+)\/?$/.exec(location.pathname)?.[1] || new URLSearchParams(location.search).get("id") || "";
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12 18 5.5M6 12l12 6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.8" fill="currentColor"/><circle cx="18" cy="5.5" r="2.8" fill="currentColor"/><circle cx="18" cy="18.5" r="2.8" fill="currentColor"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7.2V12l3.2 2.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const UNITS = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];

function section(className, heading, ...content) {
  const block = el("section", className);
  block.append(el("h2", null, heading), ...content);
  return block;
}

function line(label, value, className) {
  const row = el("div");
  row.append(el("dt", null, label), el("dd", className, value));
  return row;
}

function prose(text) {
  const box = el("div", "prose");
  box.append(markdown(text));
  return box;
}

function label(version) {
  return /^\d/.test(version) ? `v${version}` : version;
}

function ago(seconds) {
  const format = new Intl.RelativeTimeFormat(i18n.lang, { numeric: "auto" });
  const diff = seconds - Date.now() / 1000;
  for (const [unit, length] of UNITS) {
    if (Math.abs(diff) >= length) return format.format(Math.round(diff / length), unit);
  }
  return format.format(0, "second");
}

function moment(seconds) {
  const time = el("time", null, ago(seconds));
  time.dateTime = new Date(seconds * 1000).toISOString();
  time.title = date(seconds);
  return time;
}

function image(name, className) {
  const shot = el("img", className);
  shot.src = fileUrl(name);
  shot.alt = "";
  return shot;
}

function fetcher(plugin, version, className) {
  if ((plugin.state === "public" || !plugin.state) && !version.pending) {
    const link = el("a", className);
    link.href = downloadUrl(plugin.slug, version.version);
    return link;
  }
  const button = el("button", className);
  button.type = "button";
  button.addEventListener("click", () => save(plugin.slug, version));
  return button;
}

function downloadButton(plugin, version) {
  const button = fetcher(plugin, version, "button accent big");
  button.innerHTML = DOWNLOAD_ICON;
  button.append(el("span", null, i18n.t("common.download")));
  return button;
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

function shareRow(plugin) {
  const row = el("div", "share-row");
  const heart = likeButton(plugin);
  heart.classList.add("button", "secondary");
  row.append(shareButton(), heart);
  return row;
}

function creator(plugin) {
  const box = el("div", "panel creator");
  const initial = el("span", "initial", ([...(plugin.author || "").trim()][0] || "?").toLocaleUpperCase(i18n.lang));
  initial.setAttribute("aria-hidden", "true");
  const who = el("div", "who");
  const link = el("a", null, plugin.author);
  link.href = new URL(`../plugins/?q=${encodeURIComponent(plugin.author)}`, import.meta.url).href;
  who.append(el("small", null, i18n.t("plugins.author")), link);
  box.append(initial, who);
  return box;
}

function scanBadge(version) {
  const scan = version.scan;
  if (!scan) return null;
  if (scan.state !== "done") {
    const wait = el("span", "scan-badge pending");
    wait.innerHTML = SHIELD_ICON;
    wait.title = i18n.t("plugins.scan.pending");
    wait.setAttribute("aria-label", wait.title);
    return wait;
  }
  const flagged = scan.malicious + scan.suspicious;
  const link = el("a", "scan-badge " + (flagged ? "flagged" : "clean"));
  link.href = scan.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.innerHTML = flagged ? SHIELD_X_ICON : SHIELD_ICON;
  link.title = `${i18n.t(flagged ? "plugins.scan.flagged" : "plugins.scan.clean", { flagged, total: scan.total })} ${i18n.t("plugins.scan.report")}`;
  link.setAttribute("aria-label", link.title);
  return link;
}

function releases(plugin) {
  const list = el("ul", "release-list");
  const live = plugin.versions.find(version => !version.pending);
  plugin.versions.forEach(version => {
    const item = el("li");
    const row = el("div", "release-row");
    const text = el("div", "release-text");
    const name = el("p", "release-name", label(version.version));
    if (version.pending) name.append(" ", el("span", "current pending", i18n.t("plugins.states.pending")));
    else if (version === live) name.append(" ", el("span", "current", i18n.t("plugins.current")));
    const facts = [i18n.t("plugins.downloads", { count: version.downloads ?? 0 }), size(version.size), `${i18n.t("plugins.facts.api")}\u00a0${version.api}+`];
    const age = el("p", "release-age");
    age.append(moment(version.created));
    text.append(name, age);

    const get = fetcher(plugin, version, "icon release-get");
    get.innerHTML = DOWNLOAD_ICON;
    get.title = `${i18n.t("common.download")} ${label(version.version)}`;
    get.setAttribute("aria-label", get.title);
    const badge = scanBadge(version);
    let approve = null;
    if (plugin.admin && version.pending) {
      approve = el("button", "button secondary approve", i18n.t("plugins.approve"));
      approve.type = "button";
      approve.addEventListener("click", async () => {
        approve.disabled = true;
        const reply = await post("version/approve", { slug, version: version.version });
        if (reply.ok) show();
        else {
          approve.disabled = false;
          alert(message(reply));
        }
      });
    }
    row.append(...[text, approve, badge, get].filter(Boolean));
    item.append(row);
    const notes = el("details", "release-notes");
    notes.append(el("summary", null, i18n.t("plugins.versionDetails")), el("p", "release-facts", facts.join(" · ")));
    if (version.changes) notes.append(prose(version.changes));
    item.append(notes);
    list.append(item);
  });
  return section("panel releases", i18n.t("plugins.allVersions"), list);
}

function reportForm() {
  const form = el("form", "panel report");
  form.hidden = true;
  const reason = el("textarea");
  reason.maxLength = 500;
  reason.rows = 3;
  reason.required = true;
  reason.placeholder = i18n.t("plugins.reportReason");
  const field = el("div", "box");
  field.append(reason);
  const status = el("p", "hint");
  const send = el("button", "button secondary", i18n.t("plugins.reportSend"));
  send.type = "submit";
  form.append(field, send, status);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    send.disabled = true;
    const reply = await post("report", { slug, reason: reason.value });
    send.disabled = false;
    status.textContent = reply.ok ? i18n.t("plugins.reported") : message(reply);
    if (reply.ok) reason.value = "";
  });
  return form;
}

function adminButton(text, state) {
  const button = el("button", "button secondary", text);
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    const reply = await post("state", { slug, state });
    if (reply.ok) show();
    else {
      button.disabled = false;
      alert(message(reply));
    }
  });
  return button;
}

function editButton(plugin) {
  if (!plugin.owner && !plugin.admin) return null;
  const edit = el("a", "edit");
  edit.href = editor(plugin.slug);
  edit.innerHTML = PENCIL_ICON;
  edit.title = i18n.t("plugins.edit");
  edit.setAttribute("aria-label", edit.title);
  return edit;
}

function moderation(plugin) {
  if (!plugin.admin) return null;
  const box = el("div", "panel moderation");
  box.append(el("h2", null, i18n.t("plugins.moderation")), el("p", "state-line", i18n.t(`plugins.states.${plugin.state || "public"}`)));
  const row = el("div", "manage");
  if (plugin.state !== "public") row.append(adminButton(i18n.t("plugins.approve"), "public"));
  if (plugin.state !== "hidden") row.append(adminButton(i18n.t("plugins.hide"), "hidden"));
  box.append(row);
  return box;
}

function reportLink(plugin) {
  if (!session() || plugin.owner || (plugin.state && plugin.state !== "public")) return [];
  const report = reportForm();
  const open = el("button", "link report-link", i18n.t("plugins.reportThis"));
  open.type = "button";
  open.addEventListener("click", () => {
    report.hidden = !report.hidden;
    open.setAttribute("aria-expanded", String(!report.hidden));
  });
  return [open, report];
}

function banner(plugin) {
  if (plugin.flagged) return el("p", "banner", i18n.t("plugins.banner.flagged"));
  if (plugin.state === "hidden") return el("p", "banner", i18n.t("plugins.banner.hidden"));
  if (plugin.state === "pending") return el("p", "banner", i18n.t(plugin.versions.length ? "plugins.banner.pending" : "plugins.banner.noVersion"));
  return null;
}

function slides(plugin) {
  const items = plugin.images.length ? plugin.images : plugin.video ? ["yt:" + plugin.video] : [];
  return items.map(item => item.startsWith("yt:") ? { video: item.slice(3) } : { image: item });
}

function embed(plugin, id) {
  const iframe = el("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  iframe.title = plugin.name;
  iframe.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allowFullscreen = true;
  return iframe;
}

function frame(plugin, items, index) {
  const slide = items[index];
  if (slide.video) return embed(plugin, slide.video);
  const link = el("a");
  link.href = fileUrl(slide.image);
  link.target = "_blank";
  link.rel = "noopener";
  const shown = image(slide.image);
  shown.alt = plugin.name;
  link.append(shown);
  link.addEventListener("click", event => {
    event.preventDefault();
    lightbox(plugin, items, index);
  });
  return link;
}

function arrows(target, step) {
  for (const [className, direction, key] of [["prev", -1, "plugins.previous"], ["next", 1, "plugins.next"]]) {
    const arrow = el("button", "arrow " + className);
    arrow.type = "button";
    arrow.title = i18n.t(key);
    arrow.setAttribute("aria-label", arrow.title);
    arrow.addEventListener("click", () => step(direction));
    target.append(arrow);
  }
}

function lightbox(plugin, items, start) {
  const box = el("div", "lightbox");
  const stage = el("div", "frame");
  const count = el("p", "count");
  const close = el("button", "close", "\u00d7");
  close.type = "button";
  close.title = i18n.t("common.close");
  close.setAttribute("aria-label", close.title);
  let current = start;
  function show(index) {
    current = (index + items.length) % items.length;
    const slide = items[current];
    const shown = slide.video ? embed(plugin, slide.video) : image(slide.image);
    if (!slide.video) shown.alt = plugin.name;
    stage.replaceChildren(shown);
    count.textContent = `${current + 1} / ${items.length}`;
  }
  function end() {
    box.remove();
    document.documentElement.classList.remove("lightbox-open");
    document.removeEventListener("keydown", keys);
  }
  function keys(event) {
    if (event.key === "Escape") end();
    else if (event.key === "ArrowLeft" && items.length > 1) show(current - 1);
    else if (event.key === "ArrowRight" && items.length > 1) show(current + 1);
    else return;
    event.preventDefault();
  }
  close.addEventListener("click", end);
  box.addEventListener("click", event => { if (event.target === box) end(); });
  document.addEventListener("keydown", keys);
  document.documentElement.classList.add("lightbox-open");
  box.append(close, stage);
  if (items.length > 1) {
    arrows(box, direction => show(current + direction));
    box.append(count);
  }
  document.body.append(box);
  show(start);
  close.focus();
}

function gallery(plugin) {
  const items = slides(plugin);
  const stage = el("div", "media");
  const view = el("div", "view");
  stage.append(view);
  let current = 0;
  const thumbs = el("div", "shots");
  function go(index) {
    current = (index + items.length) % items.length;
    view.replaceChildren(frame(plugin, items, current));
    [...thumbs.children].forEach((pick, i) => pick.setAttribute("aria-current", String(i === current)));
  }
  items.forEach((slide, index) => {
    const pick = el("button", slide.video ? "clip" : null);
    pick.type = "button";
    pick.setAttribute("aria-label", slide.video ? i18n.t("plugins.video") : i18n.t("plugins.screenshot", { number: index + 1 }));
    const small = el("img");
    small.src = slide.video ? `https://i.ytimg.com/vi/${encodeURIComponent(slide.video)}/mqdefault.jpg` : fileUrl(slide.image);
    small.alt = "";
    small.loading = "lazy";
    pick.append(small);
    pick.addEventListener("click", () => go(index));
    thumbs.append(pick);
  });
  if (items.length > 1) arrows(stage, direction => go(current + direction));
  const box = el("div", "gallery-box");
  box.tabIndex = 0;
  box.addEventListener("keydown", event => {
    if (items.length < 2) return;
    if (event.key === "ArrowLeft") go(current - 1);
    else if (event.key === "ArrowRight") go(current + 1);
    else return;
    event.preventDefault();
  });
  go(0);
  box.append(stage);
  if (items.length > 1) box.append(thumbs);
  return [box];
}

function media(plugin) {
  if (slides(plugin).length) return gallery(plugin);
  const blank = el("div", "media blank");
  if (plugin.icon) blank.append(image(plugin.icon, "logo"));
  return [blank];
}

function figure(icon, value, caption) {
  const item = el("div", "number");
  item.innerHTML = icon;
  const strong = el("strong");
  strong.append(value);
  item.append(strong, el("span", null, caption));
  return item;
}

function numbers(plugin) {
  const row = el("div", "numbers");
  row.append(figure(DOWNLOAD_ICON, (plugin.downloads || 0).toLocaleString(i18n.lang), i18n.t("plugins.facts.downloads")));
  if (plugin.updated) row.append(figure(CLOCK_ICON, moment(plugin.updated), i18n.t("plugins.facts.updated")));
  return row;
}

function about(plugin) {
  const text = (plugin.description || "").trim();
  const lead = (plugin.summary || "").trim();
  const parts = [];
  if (lead && !text.startsWith(lead)) {
    const intro = el("p", "lead");
    intro.append(...inline(lead));
    parts.push(intro);
  }
  if (text) parts.push(prose(text));
  return parts.length ? section("panel writeup", i18n.t("plugins.about"), ...parts) : null;
}

function specs(plugin, latest) {
  const facts = el("dl");
  facts.append(
    line(i18n.t("plugins.facts.version"), latest.version),
    line(i18n.t("plugins.facts.api"), latest.api + "+"),
    line(i18n.t("plugins.facts.file"), `${latest.name} · ${size(latest.size)}`),
    line(i18n.t("plugins.facts.updated"), date(plugin.updated)),
    line("SHA-256", latest.sha256, "hash"),
  );
  const scan = scanLine(latest);
  if (scan) {
    const row = el("div");
    const data = el("dd");
    data.append(scan);
    row.append(el("dt", null, i18n.t("plugins.scan.heading")), data);
    facts.append(row);
  }
  const block = el("details", "panel specs");
  block.append(el("summary", null, i18n.t("plugins.detailsHeading")), facts);
  return block;
}

function render(plugin) {
  const latest = plugin.versions.find(version => !version.pending) || plugin.versions[0];
  const title = el("h1", null, plugin.name);
  if (latest) title.append(" ", el("span", "release", label(latest.version)));
  const masthead = el("header", "masthead");
  if (plugin.icon && slides(plugin).length) masthead.append(image(plugin.icon, "mark"));
  masthead.append(title);
  const edit = editButton(plugin);
  if (edit) masthead.append(edit);

  const side = el("div", "side");
  const mod = moderation(plugin);
  if (mod) side.append(mod);
  if (latest) side.append(downloadButton(plugin, latest));
  side.append(shareRow(plugin), creator(plugin));
  if (plugin.versions.length) side.append(releases(plugin));
  side.append(...reportLink(plugin));

  const content = el("div", "content");
  content.append(...media(plugin), numbers(plugin));
  const blocks = [about(plugin)];
  if (latest) blocks.push(specs(plugin, latest));
  content.append(...blocks.filter(Boolean));

  const layout = el("div", "layout");
  layout.append(side, content);
  view.replaceChildren(...[masthead, banner(plugin), layout].filter(Boolean));
}

async function find() {
  if (window.pluginPreload && window.pluginPreload.slug === slug && !session()) return { ok: true, status: 200, data: window.pluginPreload };
  if (session()) {
    const managed = await post("view", { slug });
    if (managed.ok || managed.status === 0) return managed;
  }
  return get("/" + encodeURIComponent(slug));
}

async function show() {
  if (!view.children.length) view.replaceChildren(el("p", "note", i18n.t("common.loading")));
  const reply = slug ? await find() : { ok: false, status: 404, data: {} };
  if (!reply.ok) {
    const note = el("p", "note", (reply.status === 404 ? i18n.t("plugins.notFound") : message(reply)) + " ");
    const back = el("a", null, i18n.t("plugins.all"));
    back.href = "../plugins/";
    note.append(back);
    view.replaceChildren(note);
    return;
  }
  document.title = `${reply.data.name} - OpenKogama`;
  render(reply.data);
}

i18n.ready.then(show);
