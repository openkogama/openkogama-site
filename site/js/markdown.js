const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"]+)/g;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
}

function link(href, text) {
  const anchor = node("a", text);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "nofollow noopener ugc";
  return anchor;
}

export function inline(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [whole, code, bold, bold2, strike, italic, italic2, label, href, bare] = match;
    let piece = whole;
    if (code) parts.push(node("code", code.slice(1, -1)));
    else if (bold || bold2) {
      const strong = node("strong");
      strong.append(...inline((bold || bold2).slice(2, -2)));
      parts.push(strong);
    } else if (strike) {
      const s = node("s");
      s.append(...inline(strike.slice(2, -2)));
      parts.push(s);
    } else if (italic || italic2) {
      const em = node("em");
      em.append(...inline((italic || italic2).slice(1, -1)));
      parts.push(em);
    } else if (label) parts.push(link(href, label));
    else if (bare) {
      const url = bare.replace(/[.,!?:;)\]]+$/, "");
      piece = url;
      parts.push(link(url, url));
    }
    last = match.index + piece.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function paragraph(lines) {
  const p = node("p");
  lines.forEach((line, index) => {
    if (index) p.append(node("br"));
    p.append(...inline(line));
  });
  return p;
}

export function render(text) {
  const out = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let plain = [];
  const flush = () => {
    if (plain.length) out.append(paragraph(plain));
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    if (/^```/.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = node("pre");
      pre.append(node("code", code.join("\n")));
      out.append(pre);
    } else if ((match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line))) {
      flush();
      const heading = node(["h2", "h3", "h4"][match[1].length - 1]);
      heading.append(...inline(match[2]));
      out.append(heading);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.append(node("hr"));
    } else if (/^>\s?/.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) quoted.push(lines[i].replace(/^>\s?/, ""));
      i--;
      const quote = node("blockquote");
      quote.append(render(quoted.join("\n")));
      out.append(quote);
    } else if ((match = /^\s*([-*+]|\d+[.)])\s+/.exec(line))) {
      flush();
      const ordered = /\d/.test(match[1]);
      const list = node(ordered ? "ol" : "ul");
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      for (; i < lines.length && pattern.test(lines[i]); i++) {
        const item = node("li");
        item.append(...inline(pattern.exec(lines[i])[1]));
        list.append(item);
      }
      i--;
      out.append(list);
    } else if (line.trim() === "") flush();
    else plain.push(line);
  }
  flush();
  return out;
}
