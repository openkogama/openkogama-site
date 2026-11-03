const API = "https://accounts.openkogama.org";
const SITE = "https://openkogama.org";
const SLUG = /^\/plugins\/([a-z0-9][a-z0-9-]*)\/?$/;
const MAP = /^\/maps\/([a-z0-9][a-z0-9-]*)\/?$/;
const IMAGES = "https://cdn.openkogama.org/maps/v1/images/";
const HOSTS = { www: "www.kogama.com", br: "kogama.com.br", friends: "friends.kogama.com" };
const SHARDS = 256;

function escape(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function paragraphs(text) {
  return text.split(/\n{2,}/).filter(block => block.trim()).map(block => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`).join("");
}

function short(text, limit) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? line.slice(0, limit - 1).trimEnd() + "\u2026" : line;
}

async function api(path) {
  return fetch(API + path, { cf: { cacheTtl: 300, cacheEverything: true }, headers: { accept: "application/json" } });
}

export function page(template, plugin, slug) {
  const url = `${SITE}/plugins/${slug}/`;
  const title = `${plugin.name} - OpenKogama`;
  const description = short(plugin.summary || plugin.description || "", 160);
  const cover = plugin.cover || plugin.icon;
  const head = [
    `<base href="/plugin/">`,
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${url}">`,
    cover ? `<meta property="og:image" content="${API}/plugins/files/${escape(cover)}">` : "",
    `<script>window.pluginPreload = ${JSON.stringify(plugin).replace(/</g, "\\u003c")};</script>`,
  ].join("\n");
  const body = `<article class="prerender">
<h1>${escape(plugin.name)}</h1>
<p>${escape(plugin.author || "")}${plugin.version ? ` \u00b7 ${escape(plugin.version)}` : ""}</p>
<p>${escape(plugin.summary || "")}</p>
${paragraphs(plugin.description || "")}
</article>`;
  return template
    .replace(/<title[^>]*>[^<]*<\/title>/, "")
    .replace(/<meta name="description"[^>]*>\n?/, "")
    .replace(/<meta property="og:[^"]+"[^>]*>\n?/g, "")
    .replace(/<link rel="canonical"[^>]*>\n?/, "")
    .replace("<head>", "<head>\n" + head)
    .replace(/(<main[^>]*id="plugin"[^>]*>)/, "$1" + body);
}

async function pluginPage(request, env, slug) {
  const url = new URL(request.url);
  const [template, reply] = await Promise.all([
    env.ASSETS.fetch(new Request(url.origin + "/plugin/index.html")).then(response => response.text()),
    api("/plugins/" + slug),
  ]);
  if (reply.status === 404) return new Response(template.replace("<head>", `<head>\n<base href="/plugin/">`), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!reply.ok) return new Response(template.replace("<head>", `<head>\n<base href="/plugin/">`), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const plugin = await reply.json();
  return new Response(page(template, plugin, slug), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

async function sitemap() {
  const urls = [];
  for (let page = 0; page < 50; page++) {
    const reply = await api(`/plugins?sort=new&page=${page}`);
    if (!reply.ok) break;
    const data = await reply.json();
    for (const plugin of data.plugins) urls.push(`<url><loc>${SITE}/plugins/${plugin.slug}/</loc><lastmod>${new Date(plugin.updated * 1000).toISOString().slice(0, 10)}</lastmod></url>`);
    if (!data.more) break;
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

function hash(text) {
  let value = 2166136261;
  for (const byte of new TextEncoder().encode(text)) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value;
}

function count(value, word) {
  return `${value.toLocaleString("en-US")} ${word}${value === 1 ? "" : "s"}`;
}

function mapTitle(map) {
  return `${map.name || "Untitled map"} - KoGaMa map${map.author ? ` by ${map.author}` : ""} - OpenKogama`;
}

function mapSummary(map) {
  if (map.description) return short(map.description, 160);
  let text = map.author ? `A KoGaMa map by ${map.author}` : "A KoGaMa map";
  if (map.published) text += ` from ${map.published.slice(0, 4)}`;
  if (map.plays != null) text += ` with ${count(map.plays, "play")}`;
  return text + ".";
}

function original(map) {
  return map.id && HOSTS[map.site] ? `https://web.archive.org/web/2024/https://${HOSTS[map.site]}/games/play/${map.id}/` : "";
}

export function mapHtml(template, map, slug) {
  const url = `${SITE}/maps/${map.canonical || slug}/`;
  const name = map.name || "Untitled map";
  const title = mapTitle(map);
  const description = mapSummary(map);
  const picture = map.image ? `${IMAGES}${map.image}.jpg` : `${SITE}/img/icon-512.png`;
  const play = "/play/?" + new URLSearchParams({ import: map.url, name });
  const facts = [map.plays != null ? count(map.plays, "play") : "", map.likes != null ? count(map.likes, "like") : "", map.published || ""].filter(Boolean);
  const others = (map.others || []).map(([key, other]) => `<li><a href="/maps/${key}/">${escape(other || "Untitled map")}</a></li>`);
  const head = [
    `<base href="/map/">`,
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    map.index ? "" : `<meta name="robots" content="noindex">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:site_name" content="OpenKogama">`,
    `<meta property="og:image" content="${escape(picture)}">`,
    `<script>window.mapPreload = ${JSON.stringify({ ...map, slug }).replace(/</g, "\\u003c")};</script>`,
  ].filter(Boolean).join("\n");
  const body = [
    `<article class="prerender">`,
    `<h1>${escape(name)}</h1>`,
    map.author ? `<p>by ${escape(map.author)}</p>` : "",
    facts.length ? `<p>${facts.join(" \u00b7 ")}</p>` : "",
    map.image ? `<img src="${escape(picture)}" alt="${escape(name)}">` : "",
    paragraphs(map.description || ""),
    `<p><a href="${escape(play)}">Play</a>${original(map) ? ` \u00b7 <a href="${original(map)}">Original page</a>` : ""}</p>`,
    others.length ? `<h2>More by ${escape(map.author)}</h2>\n<ul>${others.join("")}</ul>` : "",
    `</article>`,
  ].filter(Boolean).join("\n");
  return template
    .replace(/<title[^>]*>[^<]*<\/title>/, "")
    .replace(/<meta name="description"[^>]*>\n?/, "")
    .replace(/<meta property="og:[^"]+"[^>]*>\n?/g, "")
    .replace("<head>", () => "<head>\n" + head)
    .replace(/<main[^>]*id="map"[^>]*>/, tag => tag + body);
}

async function mapPage(request, env, slug) {
  const url = new URL(request.url);
  const shard = (hash(slug) % SHARDS).toString(16).padStart(2, "0");
  const [template, maps] = await Promise.all([
    env.ASSETS.fetch(new Request(url.origin + "/map/index.html")).then(response => response.text()),
    env.ASSETS.fetch(new Request(`${url.origin}/maps/pages/${shard}.json`)).then(response => response.ok ? response.json() : {}),
  ]);
  if (!Object.hasOwn(maps, slug)) return new Response(template.replace("<head>", `<head>\n<base href="/map/">\n<meta name="robots" content="noindex">`), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response(mapHtml(template, maps[slug], slug), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/sitemap-plugins.xml") return sitemap();
    const map = MAP.exec(url.pathname);
    if (map) {
      if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}/maps/${map[1]}/${url.search}`, 301);
      return mapPage(request, env, map[1]);
    }
    const match = SLUG.exec(url.pathname);
    if (!match || match[1] === "edit") return env.ASSETS.fetch(request);
    if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}/plugins/${match[1]}/${url.search}`, 301);
    return pluginPage(request, env, match[1]);
  },
};
