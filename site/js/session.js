(() => {
  const KEY = "openkogama-account";
  const page = new URL("../account/", document.currentScript.src);
  const nav = document.querySelector(".top .sections");
  if (!nav) return;

  const link = document.createElement("a");
  link.className = "button nav session";
  link.href = page.pathname === location.pathname ? "./" : page.href;
  if (page.pathname === location.pathname) link.setAttribute("aria-current", "page");
  nav.appendChild(link);

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
    link.textContent = signed || "Sign in";
    link.classList.toggle("signin", !signed);
    link.title = signed ? "Your account" : "";
  }

  render();
  window.addEventListener("storage", event => { if (event.key === KEY) render(); });
  window.addEventListener("openkogama-account", render);
})();
