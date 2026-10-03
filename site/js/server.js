const OpenKogamaServer = (() => {
  const HTTP = "http://127.0.0.1:8080";
  const SOCKET = "ws://127.0.0.1:5055";
  const BASE = new URL("../server/", document.currentScript.src).href;
  const DATABASE = { name: "openkogama", store: "files", key: "server.db" };
  const sockets = new Map();
  let exports = null;
  let starting = null;
  let connecting = null;
  let saving = Promise.resolve();

  function database() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DATABASE.name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(DATABASE.store);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async function loadDatabase() {
    try {
      const db = await database();
      return await new Promise(resolve => {
        const get = db.transaction(DATABASE.store).objectStore(DATABASE.store).get(DATABASE.key);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function saveDatabase(data) {
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE.store, "readwrite");
        transaction.objectStore(DATABASE.store).put(data, DATABASE.key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.log("openkogama: save failed", error);
    }
  }

  async function save() {
    if (!exports) return;
    exports.Save();
    await saving;
  }

  function start() {
    starting ??= (async () => {
      const { dotnet } = await import(BASE + "_framework/dotnet.js");
      const { setModuleImports, getAssemblyExports, getConfig, runMain } = await dotnet.create();
      setModuleImports("openkogama", {
        send: (id, data) => (sockets.get(id) ?? connecting)?.deliver(data),
        close: id => sockets.get(id)?.closedByServer(),
        loadDatabase,
        saveDatabase: data => { saving = saveDatabase(data); },
      });
      exports = (await getAssemblyExports(getConfig().mainAssemblyName)).OpenKogama.Browser.BrowserHost;
      await runMain();
    })();
    return starting;
  }

  class LocalSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.protocol = "GpBinaryV16";
      this.extensions = "";
      this.binaryType = "blob";
      this.bufferedAmount = 0;
      this.readyState = 0;
      start().then(() => {
        if (this.readyState !== 0) return;
        connecting = this;
        this.id = exports.Connect();
        connecting = null;
        sockets.set(this.id, this);
        this.readyState = 1;
        this.emit(new Event("open"));
      }, error => {
        console.log("openkogama: server failed to start", error);
        this.closedByServer(1006);
      });
    }

    emit(event) {
      this.dispatchEvent(event);
      this["on" + event.type]?.(event);
    }

    send(data) {
      if (this.readyState !== 1) return;
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
        : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new TextEncoder().encode(String(data));
      exports.Receive(this.id, bytes);
    }

    deliver(data) {
      const buffer = Uint8Array.from(data).buffer;
      setTimeout(() => {
        if (this.readyState !== 1) return;
        this.emit(new MessageEvent("message", { data: this.binaryType === "blob" ? new Blob([buffer]) : buffer }));
      }, 0);
    }

    close() {
      if (this.readyState >= 2) return;
      if (this.id) {
        sockets.delete(this.id);
        exports.Disconnect(this.id);
      }
      this.closedByServer();
    }

    closedByServer(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      setTimeout(() => this.emit(new CloseEvent("close", { code, wasClean: code === 1000 })), 0);
    }
  }
  for (const [name, value] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
    LocalSocket[name] = value;
    LocalSocket.prototype[name] = value;
  }

  function local(url) {
    const full = new URL(url, location.href);
    return full.origin === HTTP && !full.pathname.startsWith("/bundles") ? full.href : null;
  }

  async function request(method, url, contentType, body) {
    await start();
    let bytes = new Uint8Array(0);
    if (body !== undefined && body !== null) {
      const encoded = new Response(body);
      bytes = new Uint8Array(await encoded.arrayBuffer());
      contentType ??= encoded.headers.get("content-type");
    }
    const result = JSON.parse(exports.Http(method, url, contentType ?? null, bytes));
    const binary = atob(result.body);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    return { status: result.status, contentType: result.contentType || "", data };
  }

  function install() {
    const NativeSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      return String(url).startsWith(SOCKET) ? new LocalSocket(String(url)) : new NativeSocket(url, protocols);
    };
    Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = local(input instanceof Request ? input.url : input);
      if (!url) return nativeFetch(input, init);
      const headers = new Headers(init.headers);
      const result = await request(init.method || "GET", url, headers.get("content-type"), init.body);
      return new Response(result.status === 204 ? null : result.data, { status: result.status, headers: { "content-type": result.contentType } });
    };

    const NativeXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class extends NativeXHR {
      open(method, url, ...rest) {
        this._local = local(url);
        if (!this._local) return super.open(method, url, ...rest);
        this._method = method;
        this._headers = {};
        this._state = 1;
      }

      setRequestHeader(name, value) {
        if (!this._local) return super.setRequestHeader(name, value);
        this._headers[name.toLowerCase()] = value;
      }

      send(body) {
        if (!this._local) return super.send(body);
        request(this._method, this._local, this._headers["content-type"], body).then(result => this._finish(result), error => {
          console.log("openkogama: request failed", this._local, error);
          this._finish({ status: 0, contentType: "", data: new Uint8Array(0) });
        });
      }

      _finish(result) {
        const text = () => new TextDecoder().decode(result.data);
        const response = () => {
          switch (this.responseType) {
            case "arraybuffer": return result.data.buffer;
            case "blob": return new Blob([result.data], { type: result.contentType });
            case "json": try { return JSON.parse(text()); } catch { return null; }
            default: return text();
          }
        };
        Object.defineProperties(this, {
          readyState: { get: () => 4 },
          status: { get: () => result.status },
          statusText: { get: () => (result.status === 200 ? "OK" : "") },
          responseURL: { get: () => this._local },
          response: { get: response },
          responseText: { get: text },
        });
        this.getResponseHeader = name => (name.toLowerCase() === "content-type" ? result.contentType : null);
        this.getAllResponseHeaders = () => (result.contentType ? "content-type: " + result.contentType + "\r\n" : "");
        for (const type of ["readystatechange", result.status ? "load" : "error", "loadend"]) {
          this.dispatchEvent(new ProgressEvent(type, { loaded: result.data.length, total: result.data.length, lengthComputable: true }));
        }
      }
    };
  }

  addEventListener("pagehide", () => { if (exports) exports.Save(); });

  return { start, install, save, files: BASE + "files.json" };
})();
