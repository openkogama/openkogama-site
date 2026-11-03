const API = "https://accounts.openkogama.org";
const SITE = "https://openkogama.org";
const SLUG = /^\/plugins\/([a-z0-9][a-z0-9-]*)\/?$/;

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/sitemap-plugins.xml") return sitemap();
    const match = SLUG.exec(url.pathname);
    if (!match || match[1] === "edit") return env.ASSETS.fetch(request);
    if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}/plugins/${match[1]}/${url.search}`, 301);
    return pluginPage(request, env, match[1]);
  },
};
