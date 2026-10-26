(() => {
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
  const API = LOCAL ? "http://127.0.0.1:8098" : "https://accounts.openkogama.org";
  const CAPTCHA = LOCAL ? "1x00000000000000000000AA" : "0x4AAAAAAFfc07yqRtMvq5vT";
  const CAPTCHA_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=openkogamaShareCaptcha";
  const ARCHIVE = "https://cdn.openkogama.org/maps/v1/";
  const KEY = "openkogama-account";
  const NICK = "openkogama-share-nick";
  const MAPS = [".kgmap", ".kgm"];
  const ZIP = ".zip";
  const MAX_SIZE = 50 * 1024 * 1024;
  const ZIP_END = 0x06054b50;
  const ZIP_ENTRY = 0x02014b50;
  const ZIP_TAIL = 65557;
  const STORED = 0;
  const DEFLATED = 8;
  const MAX_PROTOTYPES = 1000000;
  const MAX_OBJECTS = 10000000;
  const MAX_SCALE = 1000;
  const BAD = ["notMap", "tooBig", "failed", "noZip"];
  const SKIPPED = ["inArchive", "exists", "duplicate"];

  const open = document.getElementById("share-open");
  const dialog = document.getElementById("share-dialog");
  const close = document.getElementById("share-close");
  const form = document.getElementById("share-form");
  const captchaBox = document.getElementById("share-captcha");
  const drop = document.getElementById("share-drop");
  const input = document.getElementById("share-files");
  const list = document.getElementById("share-list");
  const nick = document.getElementById("share-nick");
  const note = document.getElementById("share-note");
  const send = document.getElementById("share-send");
  if (!open || !dialog || !form) return;

  const entries = [];
  const buckets = {};
  let archive = null;
  let busy = false;
  let work = Promise.resolve();
  let widget;
  let captchaLoading = false;
  let ticket = "";

  function stored(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function signedName() {
    try {
      const session = JSON.parse(stored(KEY));
      return session && session.name ? session.name : "";
    } catch {
      return "";
    }
  }

  function size(bytes) {
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  async function zipEntries(file) {
    const tailSize = Math.min(file.size, ZIP_TAIL);
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--)
      if (tail.getUint32(at, true) === ZIP_END) {
        end = at;
        break;
      }
    if (end < 0) return null;
    const count = tail.getUint16(end + 10, true);
    const offset = tail.getUint32(end + 16, true);
    const directory = new DataView(await file.slice(offset, offset + tail.getUint32(end + 12, true)).arrayBuffer());
    const found = [];
    const names = new TextDecoder();
    for (let index = 0, at = 0; index < count && at + 46 <= directory.byteLength; index++) {
      if (directory.getUint32(at, true) !== ZIP_ENTRY) break;
      const length = directory.getUint16(at + 28, true);
      found.push({
        method: directory.getUint16(at + 10, true),
        compressed: directory.getUint32(at + 20, true),
        size: directory.getUint32(at + 24, true),
        local: directory.getUint32(at + 42, true),
        name: names.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, length)),
      });
      at += 46 + length + directory.getUint16(at + 30, true) + directory.getUint16(at + 32, true);
    }
    return found;
  }

  async function unzip(file, entry) {
    const header = new DataView(await file.slice(entry.local, entry.local + 30).arrayBuffer());
    const start = entry.local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = file.slice(start, start + entry.compressed);
    if (entry.method === STORED) return data;
    if (entry.method !== DEFLATED || typeof DecompressionStream === "undefined") return null;
    return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  }

  function isMap(name) {
    const lower = name.toLowerCase();
    return MAPS.some(extension => lower.endsWith(extension));
  }

  function looksLikePlanet(head) {
    if (head.byteLength < 8) return false;
    const prototypes = head.getInt32(0);
    if (prototypes < 0 || prototypes > MAX_PROTOTYPES) return false;
    if (prototypes === 0) return head.getInt32(4) >= 0 && head.getInt32(4) <= MAX_OBJECTS;
    if (head.byteLength < 20) return false;
    const scale = head.getFloat32(8);
    return Number.isFinite(scale) && scale > 0 && scale <= MAX_SCALE && head.getInt32(16) >= 0;
  }

  async function looksLikeMap(blob) {
    const head = new DataView(await blob.slice(0, 20).arrayBuffer());
    const bytes = new Uint8Array(head.buffer);
    const packed = bytes[0] === 0x1f && bytes[1] === 0x8b || String.fromCharCode(...bytes.slice(0, 4)) === "KGMP";
    return packed || looksLikePlanet(head);
  }

  async function sha256(blob) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function archived(sha) {
    try {
      archive ??= fetch(ARCHIVE + "latest.json").then(response => response.json());
      const latest = await archive;
      const build = new URL("builds/" + latest.build + "/", ARCHIVE);
      const prefix = sha.slice(0, latest.hashes.prefix || 2);
      buckets[prefix] ??= fetch(new URL(latest.hashes.path + prefix + ".json", build))
        .then(response => response.ok ? response.json() : {})
        .catch(() => ({}));
      return sha in await buckets[prefix];
    } catch {
      return false;
    }
  }

  function row(entry) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = entry.name;
    name.title = entry.name;
    const bytes = document.createElement("span");
    bytes.className = "size";
    bytes.textContent = size(entry.size);
    entry.label = document.createElement("span");
    entry.label.className = "state";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", i18n.t("maps.share.remove"));
    remove.addEventListener("click", () => {
      if (busy) return;
      entries.splice(entries.indexOf(entry), 1);
      item.remove();
      summary();
    });
    item.append(name, bytes, entry.label, remove);
    entry.item = item;
    return item;
  }

  function mark(entry, state) {
    entry.state = state;
    entry.label.textContent = i18n.t("maps.share.states." + state);
    entry.item.className = state === "sent" ? "done" : BAD.includes(state) ? "bad" : SKIPPED.includes(state) ? "skip" : "";
  }

  function count(states) {
    return entries.filter(entry => states.includes(entry.state)).length;
  }

  function summary() {
    const ready = count(["ready"]);
    send.disabled = busy || ready === 0;
    if (busy) return;
    note.textContent = entries.length ? i18n.t("maps.share.ready", { count: ready }) : "";
  }

  async function prepare(entry) {
    mark(entry, "checking");
    if (entry.size > MAX_SIZE) return mark(entry, "tooBig");
    const blob = await entry.load();
    if (!blob) return mark(entry, "noZip");
    if (blob.size > MAX_SIZE) return mark(entry, "tooBig");
    if (!await looksLikeMap(blob)) return mark(entry, "notMap");
    entry.sha = await sha256(blob);
    if (entries.some(other => other !== entry && other.sha === entry.sha)) return mark(entry, "duplicate");
    mark(entry, await archived(entry.sha) ? "inArchive" : "ready");
  }

  function later(task) {
    work = work.then(task).catch(() => {});
  }

  async function add(chosen) {
    const added = [];
    for (const file of chosen) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(ZIP)) {
        const inside = await zipEntries(file).catch(() => null);
        if (!inside) {
          added.push({ name: file.name, size: file.size, load: async () => null });
          continue;
        }
        for (const entry of inside)
          if (isMap(entry.name))
            added.push({ name: entry.name.split("/").pop(), size: entry.size, load: () => unzip(file, entry) });
      } else {
        added.push({ name: file.name, size: file.size, load: async () => isMap(file.name) ? file : null, plain: true });
      }
    }
    list.append(...added.map(row));
    entries.push(...added);
    busy = true;
    summary();
    for (const entry of added) {
      if (entry.plain && !isMap(entry.name)) {
        mark(entry, "notMap");
        continue;
      }
      await prepare(entry).catch(() => mark(entry, "failed"));
    }
    busy = false;
    summary();
  }

  function loadCaptcha() {
    if (captchaLoading || !CAPTCHA) return;
    captchaLoading = true;
    window.openkogamaShareCaptcha = () => {
      widget = turnstile.render(captchaBox, { sitekey: CAPTCHA, theme: "auto", size: "flexible" });
    };
    const script = document.createElement("script");
    script.src = CAPTCHA_SCRIPT;
    script.async = true;
    document.head.append(script);
  }

  function resetCaptcha() {
    ticket = "";
    if (window.turnstile && widget !== undefined) turnstile.reset(widget);
  }

  async function pass() {
    if (ticket) return ticket;
    const token = window.turnstile && widget !== undefined ? turnstile.getResponse(widget) : "";
    if (!token) return "";
    try {
      const response = await fetch(API + "/maps/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: token }),
      });
      const data = await response.json().catch(() => ({}));
      ticket = response.ok && data.ticket ? data.ticket : "";
    } catch {
      ticket = "";
    }
    if (!ticket) resetCaptcha();
    return ticket;
  }

  async function upload(entry) {
    const blob = await entry.load();
    const query = new URLSearchParams({ name: entry.name, ticket });
    if (nick.value.trim()) query.set("nick", nick.value.trim());
    try {
      const response = await fetch(API + "/maps/upload?" + query, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      return { 200: "sent", 400: "notMap", 401: "again", 409: "exists", 413: "tooBig", 507: "full" }[response.status] || "failed";
    } catch {
      return "failed";
    }
  }

  function keys(event) {
    if (event.key === "Escape") hide();
  }

  function show() {
    dialog.hidden = false;
    document.documentElement.classList.add("inspecting");
    document.addEventListener("keydown", keys);
    loadCaptcha();
    close.focus();
  }

  function hide() {
    dialog.hidden = true;
    document.documentElement.classList.remove("inspecting");
    document.removeEventListener("keydown", keys);
    open.focus();
  }

  open.addEventListener("click", show);
  close.addEventListener("click", hide);
  dialog.addEventListener("click", event => { if (event.target === dialog) hide(); });

  input.addEventListener("change", () => {
    const chosen = [...input.files];
    input.value = "";
    later(() => add(chosen));
  });

  drop.addEventListener("dragover", event => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", event => {
    event.preventDefault();
    drop.classList.remove("over");
    const chosen = [...event.dataTransfer.files];
    later(() => add(chosen));
  });

  nick.value = stored(NICK) || signedName();
  nick.addEventListener("change", () => remember(NICK, nick.value.trim()));

  async function sendAll() {
    busy = true;
    send.disabled = true;
    const queue = entries.filter(entry => entry.state === "ready");
    let message = "";
    if (!await pass()) message = i18n.t("maps.share.captcha");
    for (const [done, entry] of queue.entries()) {
      if (message) break;
      note.textContent = i18n.t("maps.share.progress", { done, total: queue.length });
      mark(entry, "sending");
      const state = await upload(entry);
      if (state === "full" || state === "again") {
        mark(entry, "ready");
        if (state === "again") resetCaptcha();
        message = i18n.t(state === "full" ? "maps.share.full" : "maps.share.captcha");
        break;
      }
      mark(entry, state);
    }
    busy = false;
    summary();
    const sent = count(["sent"]);
    if (message || sent) note.textContent = message || i18n.t("maps.share.thanks", { count: sent });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!busy) later(sendAll);
  });
})();
