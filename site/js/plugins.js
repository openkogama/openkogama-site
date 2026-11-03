import { card, el, get, message, page, post, session } from "./catalog.js";

const grid = document.getElementById("cards");
const note = document.getElementById("note");
const more = document.getElementById("more");
const search = document.getElementById("search");
const sort = document.getElementById("sort");
let next = 0;
let asked = 0;
let typing;

async function load(fresh) {
  const ticket = ++asked;
  if (fresh) next = 0;
  more.hidden = true;
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
  more.addEventListener("click", () => load(false));
  load(true);
  personal();
});
