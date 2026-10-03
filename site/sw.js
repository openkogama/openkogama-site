const SITE = "openkogama-site";
const BUNDLES = /\/bundles-([^/]+)\/(.+)$/;
const HASHED = /\/_framework\/.+\.[a-z0-9]{10}\.[a-z]+$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => { if (event.data === "claim") event.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  const bundle = url.pathname.match(BUNDLES);
  if (bundle) {
    event.respondWith(fromBundles(bundle[1], decodeURIComponent(bundle[2]), request));
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/play/build/")) {
    event.respondWith(caches.match(withoutSearch(request)).then(cached => cached || new Response("not installed", { status: 404 })));
    return;
  }
  event.respondWith(url.pathname.includes("/Release/") || HASHED.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});

async function fromBundles(set, path, request) {
  const cached = await caches.match(bundleKey(set, path));
  return cached || fetch(request);
}

async function cacheFirst(request) {
  const cached = await caches.match(withoutSearch(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(SITE)).put(withoutSearch(request), response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SITE);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) cache.put(withoutSearch(request), response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(withoutSearch(request));
    if (cached) return cached;
    throw error;
  }
}

function withoutSearch(request) {
  const url = new URL(request.url);
  url.search = "";
  return url.href;
}

function bundleKey(set, path) {
  return new URL(`/__bundles/${set}/${path}`, location.origin).href;
}
