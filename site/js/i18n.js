(() => {
  const KEY = "lang";
  const root = new URL("../", document.currentScript.src);
  const query = new URLSearchParams(location.search);
  const state = { lang: "en", languages: ["en"], english: {}, strings: {} };

  function stored() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  function store(code) {
    try { localStorage.setItem(KEY, code); } catch {}
  }

  const tag = code => code.replace("_", "-");
  const same = (a, b) => tag(a).toLowerCase() === tag(b).toLowerCase();

  function pick(languages, wanted) {
    for (const code of wanted.filter(Boolean)) {
      const exact = languages.find(language => same(language, code));
      if (exact) return exact;
      const base = languages.find(language => same(language, tag(code).split("-")[0]));
      if (base) return base;
    }
    return "en";
  }

  function lookup(strings, key) {
    const value = key.split(".").reduce((node, part) => node && typeof node === "object" ? node[part] : undefined, strings);
    return typeof value === "string" ? value : undefined;
  }

  function template(key, vars) {
    if (vars && typeof vars.count === "number") {
      const own = lookup(state.strings, key + "_" + new Intl.PluralRules(tag(state.lang)).select(vars.count)) ?? lookup(state.strings, key + "_other");
      if (own !== undefined) return own;
      const english = lookup(state.english, key + "_" + new Intl.PluralRules("en").select(vars.count)) ?? lookup(state.english, key + "_other");
      if (english !== undefined) return english;
    }
    return lookup(state.strings, key) ?? lookup(state.english, key) ?? key;
  }

  function value(item) {
    return typeof item === "number" ? item.toLocaleString(tag(state.lang)) : String(item);
  }

  function parts(key, vars = {}) {
    return template(key, vars).split(/(\{\w+\})/).filter(Boolean).map(piece => {
      const name = /^\{(\w+)\}$/.exec(piece)?.[1];
      if (!name || !(name in vars)) return piece;
      return vars[name] instanceof Node ? vars[name] : value(vars[name]);
    });
  }

  function t(key, vars) {
    return parts(key, vars).map(piece => piece instanceof Node ? piece.textContent : piece).join("");
  }

  function args(element) {
    try { return JSON.parse(element.dataset.i18nArgs || "{}"); } catch { return {}; }
  }

  function pairs(text) {
    return text.split(";").map(pair => pair.split(":").map(part => part.trim())).filter(([name, key]) => name && key);
  }

  function css(text) {
    return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ") + '"';
  }

  function apply(scope = document) {
    const within = selector => [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
    for (const element of within("[data-i18n]")) {
      const slots = [...element.querySelectorAll("[data-i18n-slot]")].filter(slot => slot.parentElement.closest("[data-i18n]") === element);
      const vars = { ...args(element), ...Object.fromEntries(slots.map(slot => [slot.dataset.i18nSlot, slot])) };
      if (slots.length) element.replaceChildren(...parts(element.dataset.i18n, vars));
      else element.textContent = t(element.dataset.i18n, vars);
    }
    for (const element of within("[data-i18n-attr]"))
      for (const [name, key] of pairs(element.dataset.i18nAttr)) element.setAttribute(name, t(key, args(element)));
    for (const element of within("[data-i18n-vars]"))
      for (const [name, key] of pairs(element.dataset.i18nVars)) element.style.setProperty(name, css(t(key, args(element))));
  }

  function nativeName(code) {
    try {
      const name = new Intl.DisplayNames([tag(code)], { type: "language" }).of(tag(code));
      return name ? name[0].toLocaleUpperCase(tag(code)) + name.slice(1) : code;
    } catch {
      return code;
    }
  }

  function picker() {
    const footer = document.querySelector("body > footer");
    if (!footer || state.languages.length < 2) return;
    const select = document.createElement("select");
    select.className = "language";
    select.setAttribute("aria-label", t("common.language"));
    for (const code of state.languages) select.append(new Option(nativeName(code), code, false, code === state.lang));
    select.addEventListener("change", () => {
      store(select.value);
      const url = new URL(location.href);
      url.searchParams.delete(KEY);
      location.href = url.href;
    });
    footer.append(select);
  }

  function load(path) {
    return fetch(new URL(path, root)).then(response => response.ok ? response.json() : Promise.reject(new Error(response.status)));
  }

  const dom = new Promise(resolve => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", resolve, { once: true }) : resolve());

  const ready = (async () => {
    const english = load("locales/en.json").catch(() => ({}));
    state.languages = await load("locales.json").then(list => Array.isArray(list) && list.length ? list : ["en"]).catch(() => ["en"]);
    const asked = query.get(KEY);
    if (asked && state.languages.some(language => same(language, asked))) store(pick(state.languages, [asked]));
    state.lang = pick(state.languages, [asked, stored(), ...(navigator.languages || [navigator.language])]);
    const strings = state.lang === "en" ? null : load("locales/" + state.lang + ".json").catch(() => ({}));
    state.english = await english;
    state.strings = (await strings) || state.english;
    await dom;
    document.documentElement.lang = tag(state.lang);
    apply();
    picker();
  })();

  window.i18n = {
    t,
    parts,
    apply,
    ready,
    get lang() { return tag(state.lang); },
    get file() { return state.lang; },
  };
})();
