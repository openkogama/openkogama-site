const OpenKogamaOffline = (() => {
  const SITE = "openkogama-site";
  const BUNDLES = "openkogama-bundles";
  const BUILDS = "openkogama-builds";
  const EVAL = "function _JS_Eval_EvalJS(ptr){var str=Pointer_stringify(ptr);window.eval(str)}";
  const SAFE_EVAL = "function _JS_Eval_EvalJS(ptr){var str=Pointer_stringify(ptr);try{window.eval(str)}catch(e){if(!(e instanceof ReferenceError))throw e;console.log(\"openkogama: ignored\",str.slice(0,120))}}";
  const TYPES = { js: "text/javascript", json: "application/json", html: "text/html", css: "text/css", png: "image/png", wasm: "application/wasm" };
  const PARALLEL = 6;
  const ATTEMPTS = 3;
  const WORKER = new URL("../sw.js", document.currentScript.src).href;

  function reloadOnce() {
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem("openkogama-reloaded") === "1";
      sessionStorage.setItem("openkogama-reloaded", "1");
    } catch {}
    if (reloaded) return null;
    location.reload();
    return new Promise(() => {});
  }

  function register() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register(WORKER, { updateViaCache: "none" })
      .then(registration => registration.update().catch(() => {}).then(() => navigator.serviceWorker.ready))
      .then(registration => navigator.serviceWorker.controller ? registration : new Promise(resolve => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(registration), { once: true });
        registration.active?.postMessage("claim");
        setTimeout(() => resolve(navigator.serviceWorker.controller ? registration : reloadOnce()), 3000);
      }))
      .then(registration => {
        if (registration) try { sessionStorage.removeItem("openkogama-reloaded"); } catch {}
        return registration;
      })
      .catch(error => { console.log("openkogama: service worker", error); return null; });
  }

  function buildKey(id, path) {
    return new URL(`/play/build/${id}/${path}`, location.origin).href;
  }

  async function unzip(buffer) {
    const view = new DataView(buffer);
    let end = buffer.byteLength - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error("not a zip file");
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const files = [];
    for (let i = 0; i < count; i++) {
      const method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const skip = nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLength));
      offset += 46 + skip;
      if (name.endsWith("/")) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const bytes = new Uint8Array(buffer, start, compressed);
      const data = method === 0 ? bytes
        : new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      files.push({ name, data });
    }
    return files;
  }

  async function installBuild(build, response) {
    const cache = await caches.open(BUILDS);
    for (let { name, data } of await unzip(await response.arrayBuffer())) {
      if (build.patchEval && name.endsWith("Release/WebGLBuild.js")) {
        data = new TextEncoder().encode(new TextDecoder().decode(data).replace(EVAL, SAFE_EVAL));
      }
      if (name.endsWith(".gz")) {
        data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
        name = name.slice(0, -3);
      }
      const type = TYPES[name.split(".").pop()] ?? "application/octet-stream";
      await cache.put(buildKey(build.id, name), new Response(data, { headers: { "content-type": type } }));
    }
    await cache.put(buildKey(build.id, ".installed"), new Response("1"));
  }

  function bundleKey(set, path) {
    return new URL(`/__bundles/${set}/${path}`, location.origin).href;
  }

  async function fetchFirst(urls) {
    let last;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) return response;
        last = new Error(url + " " + response.status);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }

  async function sizeOf(url) {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      return Number(response.headers.get("content-length")) || 0;
    } catch {
      return 0;
    }
  }

  async function missing({ files, set, build }) {
    const site = await caches.open(SITE);
    const bundles = await caches.open(BUNDLES);
    const builds = await caches.open(BUILDS);
    const todo = [];
    if (build && !await builds.match(buildKey(build.id, ".installed"))) todo.push({ kind: "build", url: build.url, size: build.size });
    const cached = new Set((await site.keys()).map(request => request.url));
    for (const file of files) {
      const url = new URL(file, location.href);
      url.search = "";
      if (!cached.has(url.href)) todo.push({ kind: "site", url: url.href, size: await sizeOf(url.href) });
    }
    if (set) {
      const manifest = await (await fetch(new URL(`/manifests/${set}.json`, location.origin))).json();
      const have = new Set((await bundles.keys()).map(request => request.url));
      for (const [path, size] of Object.entries(manifest.files)) {
        if (!have.has(bundleKey(set, path))) todo.push({ kind: "bundle", path, size, root: manifest.root });
      }
    }
    return todo;
  }

  async function download(response, onBytes) {
    if (!response.body) {
      const blob = await response.blob();
      onBytes(blob.size);
      return new Response(blob, { headers: response.headers });
    }
    const reader = response.body.getReader();
    const chunks = [];
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      chunks.push(read.value);
      onBytes(read.value.length);
    }
    return new Response(new Blob(chunks), { headers: response.headers });
  }

  async function install({ files, set, build, server, onProgress }) {
    const todo = await missing({ files, set, build });
    const site = await caches.open(SITE);
    const bundles = await caches.open(BUNDLES);
    const total = todo.reduce((sum, item) => sum + item.size, 0);
    let received = 0, failed = 0;
    const report = bytes => { received += bytes; onProgress?.(Math.min(received, total), total); };
    const queue = [...todo];

    async function worker() {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const sources = item.kind === "bundle" ? [item.root + item.path, ...(server ? [`${server}/bundles-${set}/${item.path}`] : [])] : [item.url];
        let counted = 0, error;
        const count = bytes => { counted += bytes; report(bytes); };
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          try {
            const response = await download(await fetchFirst(sources), count);
            if (item.kind === "build") await installBuild(build, response);
            else if (item.kind === "site") await site.put(item.url, response);
            else await bundles.put(bundleKey(set, item.path), response);
            error = null;
            break;
          } catch (failure) {
            error = failure;
            report(-counted);
            counted = 0;
          }
        }
        if (error) {
          failed++;
          console.log("openkogama: offline", item.url || item.path, String(error));
        }
        if (counted < item.size) report(item.size - counted);
      }
    }

    onProgress?.(0, total);
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return { total: todo.length, failed };
  }

  return { register, missing, install, buildUrl: (id, path) => buildKey(id, path) };
})();
