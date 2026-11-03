(() => {
  const KEY = "openkogama-account";
  const root = new URL("../", document.currentScript.src);
  const page = new URL("account/", root);
  const nav = document.querySelector(".top .sections");
  if (!nav) return;

  const archive = nav.querySelector('a[data-i18n="common.nav.archive"]');
  if (archive) {
    const menu = document.createElement("div");
    menu.className = "menu";
    archive.replaceWith(menu);
    archive.setAttribute("aria-haspopup", "true");
    archive.setAttribute("aria-expanded", "false");
    const list = document.createElement("ul");
    for (const [path, key, text] of [["archive/", "common.nav.archive", "Archive"], ["maps/", "common.nav.maps", "Maps"], ["models/", "common.nav.models", "Models"], ["avatars/", "common.nav.avatars", "Avatars"]]) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = new URL(path, root).href;
      link.textContent = text;
      link.dataset.i18n = key;
      if (link.pathname === location.pathname) link.setAttribute("aria-current", "page");
      item.append(link);
      list.append(item);
    }
    menu.append(archive, list);
    function open(state) {
      menu.classList.toggle("open", state);
      archive.setAttribute("aria-expanded", String(state));
    }
    archive.addEventListener("click", event => {
      event.preventDefault();
      open(!menu.classList.contains("open"));
    });
    document.addEventListener("click", event => { if (!menu.contains(event.target)) open(false); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") open(false); });
  }

  const here = page.pathname === location.pathname;
  const back = new URL(page);
  back.searchParams.set("next", location.pathname + location.search + location.hash);
  const link = document.createElement("a");
  link.className = "button nav session";
  if (here) link.setAttribute("aria-current", "page");
  const register = document.createElement("a");
  register.className = "button nav register";
  register.href = new URL("#create", here ? page : back).href;

  function name() {
    try {
      const session = JSON.parse(localStorage.getItem(KEY));
      return session && session.token && session.name ? session.name : "";
    } catch {
      return "";
    }
  }

  function render() {
    const signed = name();
    link.href = here ? "./" : signed ? page.href : back.href;
    link.textContent = signed || i18n.t("common.signIn");
    link.classList.toggle("signin", !signed);
    link.title = signed ? i18n.t("common.yourAccount") : "";
    register.textContent = i18n.t("common.register");
    register.hidden = Boolean(signed);
  }

  const account = document.createElement("div");
  account.className = "account";

  i18n.ready.then(() => {
    account.append(link, register);
    nav.after(account);
    render();
  });
  window.addEventListener("storage", event => { if (event.key === KEY) render(); });
  window.addEventListener("openkogama-account", render);
})();
