import { likedList } from "./likes.js";
import { card, el, get, message, page, post, session } from "./catalog.js";

const grid = document.getElementById("cards");
const note = document.getElementById("note");
const more = document.getElementById("more");
const search = document.getElementById("search");
const sort = document.getElementById("sort");
const favorites = document.getElementById("favorites");
let onlyLiked = location.hash === "#liked";
let next = 0;
let asked = 0;
let typing;

async function load(fresh) {
  const ticket = ++asked;
  if (fresh) next = 0;
  more.hidden = true;
  if (onlyLiked) {
    const slugs = likedList("plugins");
    const replies = await Promise.all(slugs.map(slug => get("/" + encodeURIComponent(slug))));
    if (ticket !== asked) return;
    const words = search.value.trim().toLowerCase();
    const found = replies.filter(reply => reply.ok).map(reply => reply.data).filter(plugin => !words || `${plugin.name} ${plugin.summary} ${plugin.author}`.toLowerCase().includes(words));
    grid.replaceChildren(...found.map(card));
    note.textContent = i18n.t(slugs.length ? (words ? "plugins.noResults" : "plugins.noLikedGone") : "plugins.noLikedYet");
    note.hidden = found.length > 0;
    return;
  }
  const params = new URLSearchParams({ page: String(next), sort: sort.value });
  const words = search.value.trim();
  if (words) params.set("q", words);
  const reply = await get("?" + params);
  if (ticket !== asked) return;
  if (fresh) grid.replaceChildren();
  if (!reply.ok) {
    note.textContent = message(reply);
    note.hidden = false;
    return;
  }
  grid.append(...reply.data.plugins.map(card));
  note.textContent = i18n.t(words ? "plugins.noResults" : "plugins.empty");
  note.hidden = grid.children.length > 0;
  more.hidden = !reply.data.more;
  next++;
}

function shelf(id, plugins) {
  const box = document.getElementById(id);
  box.replaceChildren(...plugins.map(plugin => card(plugin, true)));
  box.closest(".shelf").hidden = plugins.length === 0;
}

function report(entry) {
  const item = el("li");
  const text = el("div", "report-text");
  const head = el("p", "who");
  const link = el("a", null, entry.name);
  link.href = page(entry.slug);
  head.append(link, ` · ${entry.reporter}`);
  text.append(head, el("p", "reason", entry.reason));
  const dismiss = el("button", "button secondary dismiss", i18n.t("plugins.dismiss"));
  dismiss.type = "button";
  dismiss.addEventListener("click", async () => {
    dismiss.disabled = true;
    if ((await post("reports/clear", { slug: entry.slug })).ok) item.remove();
    else dismiss.disabled = false;
  });
  item.append(text, dismiss);
  return item;
}

async function personal() {
  if (!session()) return;
  const reply = await post("mine");
  if (!reply.ok) return;
  shelf("mine-cards", reply.data.plugins);
  if (!reply.data.admin) return;
  shelf("waiting-cards", reply.data.waiting);
  const reports = document.getElementById("reports");
  reports.replaceChildren(...reply.data.reports.map(report));
  reports.closest(".shelf").hidden = reply.data.reports.length === 0;
}

i18n.ready.then(() => {
  const asked = new URLSearchParams(location.search).get("q");
  if (asked) search.value = asked;
  document.getElementById("tools").addEventListener("submit", event => event.preventDefault());
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => load(true), 300);
  });
  sort.addEventListener("change", () => load(true));
  function paintLiked() {
    favorites.setAttribute("aria-pressed", String(onlyLiked));
    favorites.querySelector(".count").textContent = likedList("plugins").length || "";
  }
  favorites.addEventListener("click", () => {
    onlyLiked = !onlyLiked;
    history.replaceState(null, "", onlyLiked ? "#liked" : location.pathname + location.search);
    paintLiked();
    load(true);
  });
  document.addEventListener("liked", ({ detail }) => {
    if (detail.kind !== "plugins") return;
    paintLiked();
    if (onlyLiked && !detail.liked) load(true);
  });
  paintLiked();
  more.addEventListener("click", () => load(false));
  load(true);
  personal();
});
