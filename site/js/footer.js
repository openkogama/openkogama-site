(() => {
  const root = new URL("../", document.currentScript.src);
  const footer = document.querySelector("body > footer");
  if (!footer) return;
  const ICONS = {
    github: '<svg viewBox="0 0 98 96" aria-hidden="true"><path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/></svg>',
    discord: '<svg viewBox="0 0 126.644 96" aria-hidden="true"><path d="M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z"/></svg>',
    reddit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg>',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, text, key) {
    const node = el("a", null, text);
    if (key) node.dataset.i18n = key;
    if (href.startsWith("http")) {
      node.href = href;
      node.target = "_blank";
      node.rel = "noopener";
    } else {
      node.href = new URL(href, root).href;
      if (node.pathname === location.pathname) node.setAttribute("aria-current", "page");
    }
    return node;
  }

  function column(title, key, links) {
    const box = el("div", "column");
    const heading = el("h2", null, title);
    heading.dataset.i18n = key;
    const list = el("ul");
    for (const item of links) {
      const row = el("li");
      row.append(item);
      list.append(row);
    }
    box.append(heading, list);
    return box;
  }

  const about = el("div", "about");
  const brand = el("a", "brand");
  brand.href = root.href;
  const logo = el("img");
  logo.src = new URL("img/icon-192.png", root).href;
  logo.alt = "";
  brand.append(logo, "OPENKOGAMA");
  const tagline = el("p", null, "Classic KoGaMa, brought back by fans.");
  tagline.dataset.i18n = "footer.tagline";
  const social = el("div", "social");
  for (const [name, href, label] of [["github", "https://github.com/openkogama", "GitHub"], ["discord", "https://discord.gg/u6tKuP3k4M", "Discord"], ["reddit", "https://www.reddit.com/r/OpenKogama/", "Reddit"]]) {
    const icon = link(href, "");
    icon.className = name;
    icon.setAttribute("aria-label", label);
    icon.innerHTML = ICONS[name];
    social.append(icon);
  }
  about.append(brand, tagline, social);

  const columns = el("div", "columns");
  columns.append(
    about,
    column("Archive", "common.nav.archive", [
      link("maps/", "Maps", "common.nav.maps"),
      link("models/", "Models", "common.nav.models"),
      link("avatars/", "Avatars", "common.nav.avatars"),
    ]),
    column("Plugins", "common.nav.plugins", [
      link("plugins/", "Browse plugins", "footer.browse"),
      link("plugins/edit/", "Share a plugin", "footer.share"),
    ]),
    column("Community", "footer.community", [
      link("https://github.com/openkogama", "GitHub"),
      link("https://discord.gg/u6tKuP3k4M", "Discord"),
      link("https://www.reddit.com/r/OpenKogama/", "Reddit"),
      link("https://ko-fi.com/nightus", "Donate", "home.donate"),
    ]),
    column("Legal", "footer.legal", [
      link("terms/", "Terms of Use", "footer.terms"),
      link("privacy/", "Privacy Policy", "footer.privacy"),
    ]),
  );

  const bottom = el("div", "bottom");
  const note = el("p", null, "Not affiliated with Multiverse ApS.");
  note.dataset.i18n = "common.notAffiliated";
  bottom.append(note, el("div", "language-slot"));
  footer.replaceChildren(columns, bottom);
})();
