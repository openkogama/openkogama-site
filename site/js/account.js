(() => {
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
  const API = LOCAL ? "http://127.0.0.1:8098" : "https://accounts.openkogama.org";
  const CAPTCHA = LOCAL ? "1x00000000000000000000AA" : "0x4AAAAAAFfc07yqRtMvq5vT";
  const GUARDED = ["signin", "create", "forgot"];
  const widgets = {};
  const KEY = "openkogama-account";
  const VIEWS = ["signin", "create", "confirm", "forgot", "reset", "email", "emailcode", "account"];
  const requested = new URLSearchParams(location.search).get("launcher") || "";
  const launcher = /^[A-Za-z0-9_-]{43}$/.test(requested) ? requested : null;
  let pending = "";
  let handedOff = false;

  function saved() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      return null;
    }
  }

  function keep(session) {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch {}
    window.dispatchEvent(new Event("openkogama-account"));
  }

  async function call(path, body) {
    try {
      const response = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, ok: response.ok, data };
    } catch {
      return { status: 0, ok: false, data: {} };
    }
  }

  function message(reply) {
    if (reply.status === 0) return i18n.t("account.errors.offline");
    const text = reply.data.error;
    if (!text) return i18n.t("account.errors.status", { status: String(reply.status) });
    return text[0].toUpperCase() + text.slice(1) + ".";
  }

  window.openkogamaCaptcha = () => {
    if (!CAPTCHA) return;
    for (const id of GUARDED)
      widgets[id] = turnstile.render(document.querySelector("#" + id + " .captcha"), {
        sitekey: CAPTCHA,
        theme: "auto",
        size: "flexible",
      });
  };

  async function human(id) {
    if (!CAPTCHA) return undefined;
    for (let tries = 0; tries < 150; tries++) {
      const token = window.turnstile && widgets[id] !== undefined ? turnstile.getResponse(widgets[id]) : "";
      if (token) return token;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return "";
  }

  function renew(id) {
    if (window.turnstile && widgets[id] !== undefined) turnstile.reset(widgets[id]);
  }

  function fail(panel, text) {
    panel.querySelector(".error").textContent = text;
    panel.classList.toggle("invalid", text !== "");
  }

  function show(id) {
    for (const view of VIEWS) document.getElementById(view).hidden = view !== id;
    const panel = document.getElementById(id);
    fail(panel, "");
    if (id === "confirm" || id === "emailcode") panel.querySelector(".sent").textContent = i18n.t("account.codeSent", { email: pending });
    if (id === "reset") panel.querySelector(".sent").textContent = i18n.t("account.resetSent", { email: pending });
    const first = panel.querySelector("input");
    if (first) first.focus();
    return panel;
  }

  async function signedIn(reply, panel) {
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    keep({ token: reply.data.token, name: reply.data.name });
    await showAccount();
  }

  async function showAccount() {
    const session = saved();
    if (!session) {
      show("signin");
      return;
    }
    const me = await call("/me", { token: session.token });
    if (me.status === 401) {
      keep(null);
      show("signin");
      return;
    }
    const panel = show("account");
    panel.querySelector(".name").textContent = me.ok ? me.data.name : session.name;
    const email = me.ok ? me.data.email || "" : "";
    panel.querySelector(".email").textContent = email || (me.ok ? i18n.t("account.noEmail") : "");
    panel.querySelector(".mail a").textContent = i18n.t(email ? "account.changeEmail" : "account.addEmail");
    if (!me.ok) fail(panel, message(me));
    else if (launcher && !handedOff) {
      handedOff = true;
      await handOff(panel);
    }
  }

  async function handOff(panel) {
    const session = saved();
    if (!session) return;
    const reply = await call("/launcher/code", { token: session.token, challenge: launcher });
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    panel.querySelectorAll(".launcher").forEach(element => { element.hidden = false; });
    location.href = "openkogama://signed-in?code=" + encodeURIComponent(reply.data.code);
  }

  function form(id, submit) {
    const panel = document.getElementById(id);
    panel.addEventListener("submit", async event => {
      event.preventDefault();
      const button = panel.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await submit(panel.elements, panel);
      } finally {
        button.disabled = false;
      }
    });
  }

  form("signin", async (fields, panel) => {
    const reply = await call("/login", { login: fields.login.value.trim(), password: fields.password.value, captcha: await human("signin") });
    renew("signin");
    if (reply.status === 403 && reply.data.unverified) {
      pending = reply.data.email;
      await call("/resend", { email: pending });
      show("confirm");
      return;
    }
    await signedIn(reply, panel);
  });

  form("create", async (fields, panel) => {
    const email = fields.email.value.trim();
    const reply = await call("/register", { name: fields.name.value.trim(), email, password: fields.password.value, captcha: await human("create") });
    renew("create");
    if (reply.ok && reply.data.token) {
      await signedIn(reply, panel);
      return;
    }
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    pending = email;
    show("confirm");
  });

  form("email", async (fields, panel) => {
    const session = saved();
    const email = fields.email.value.trim();
    const reply = await call("/email", { token: session && session.token, email });
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    pending = email;
    show("emailcode");
  });

  form("emailcode", async (fields, panel) => {
    const session = saved();
    const reply = await call("/email/confirm", { token: session && session.token, email: pending, code: fields.code.value.trim() });
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    await showAccount();
  });

  form("confirm", async (fields, panel) => {
    await signedIn(await call("/verify", { email: pending, code: fields.code.value.trim() }), panel);
  });

  form("forgot", async (fields, panel) => {
    const email = fields.email.value.trim();
    const reply = await call("/reset", { email, captcha: await human("forgot") });
    renew("forgot");
    if (!reply.ok) {
      fail(panel, message(reply));
      return;
    }
    pending = email;
    show("reset");
  });

  form("reset", async (fields, panel) => {
    await signedIn(await call("/reset/confirm", { email: pending, code: fields.code.value.trim(), password: fields.password.value }), panel);
  });

  document.querySelectorAll('a.link[href^="#"]').forEach(link => link.addEventListener("click", async event => {
    event.preventDefault();
    const target = link.getAttribute("href").slice(1);
    if (target === "account") {
      await showAccount();
      return;
    }
    if (target !== "resend" && target !== "resend-email") {
      show(target);
      return;
    }
    const again = target === "resend-email";
    const panel = document.getElementById(again ? "emailcode" : "confirm");
    const session = saved();
    const reply = again ? await call("/email", { token: session && session.token, email: pending }) : await call("/resend", { email: pending });
    fail(panel, reply.ok ? "" : message(reply));
    if (reply.ok) panel.querySelector(".sent").textContent = i18n.t("account.newCodeSent", { email: pending });
  }));

  document.querySelectorAll(".secret button").forEach(button => button.addEventListener("click", () => {
    const input = button.previousElementSibling;
    const shown = input.type === "password";
    input.type = shown ? "text" : "password";
    button.setAttribute("aria-pressed", String(shown));
    button.setAttribute("aria-label", i18n.t(shown ? "account.hidePassword" : "account.showPassword"));
    input.focus();
  }));

  document.querySelector("#account a.open").addEventListener("click", event => {
    event.preventDefault();
    handOff(document.getElementById("account"));
  });

  document.getElementById("signout").addEventListener("click", async () => {
    const session = saved();
    keep(null);
    if (session) await call("/logout", { token: session.token });
    show("signin");
  });

  i18n.ready.then(showAccount);
})();
