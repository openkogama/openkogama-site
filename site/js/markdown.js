const FILES = "https://accounts.openkogama.org/plugins/files/";
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\b_[^_\n]+_\b)|!\[([^\]\n]*)\]\(([^\s)]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\[\^([A-Za-z0-9_-]+)\]|(https?:\/\/[^\s<>"]+)/g;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FOOTNOTE = /^\[\^([A-Za-z0-9_-]+)\]:\s*(.*)$/;

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

function ownImage(source) {
  if (/^[0-9a-f]{64}\.(png|jpg|webp)$/.test(source)) return (LOCAL ? "http://127.0.0.1:8098/plugins/files/" : FILES) + source;
  if (source.startsWith(FILES) && /^[0-9a-f]{64}\.(png|jpg|webp)$/.test(source.slice(FILES.length))) return source;
  return null;
}

export function inline(text, notes) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [whole, code, bold, bold2, strike, italic, italic2, alt, source, label, href, note, bare] = match;
    let piece = whole;
    if (code) parts.push(node("code", code.slice(1, -1)));
    else if (bold || bold2) {
      const strong = node("strong");
      strong.append(...inline((bold || bold2).slice(2, -2), notes));
      parts.push(strong);
    } else if (strike) {
      const s = node("s");
      s.append(...inline(strike.slice(2, -2), notes));
      parts.push(s);
    } else if (italic || italic2) {
      const em = node("em");
      em.append(...inline((italic || italic2).slice(1, -1), notes));
      parts.push(em);
    } else if (source !== undefined) {
      const src = ownImage(source);
      if (src) {
        const image = node("img");
        image.src = src;
        image.alt = alt;
        image.loading = "lazy";
        parts.push(image);
      } else parts.push(alt || source);
    } else if (label) parts.push(link(href, label));
    else if (note !== undefined) {
      if (notes && notes.names.includes(note)) {
        const sup = node("sup", null);
        const ref = node("a", String(notes.names.indexOf(note) + 1));
        ref.href = "#note-" + note;
        sup.append(ref);
        parts.push(sup);
      } else parts.push(whole);
    } else if (bare) {
      const url = bare.replace(/[.,!?:;)\]]+$/, "");
      piece = url;
      parts.push(link(url, url));
    }
    last = match.index + piece.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function paragraph(lines, notes) {
  const p = node("p");
  lines.forEach((line, index) => {
    if (index) p.append(node("br"));
    p.append(...inline(line, notes));
  });
  return p;
}

function listItem(text, notes) {
  const item = node("li");
  const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
  if (task) {
    const box = node("input");
    box.type = "checkbox";
    box.disabled = true;
    box.checked = task[1] !== " ";
    item.append(box, " ", ...inline(task[2], notes));
    item.className = "task";
  } else item.append(...inline(text, notes));
  return item;
}

function list(lines, start, notes) {
  const first = LIST.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const box = node(ordered ? "ol" : "ul");
  let i = start;
  let item = null;
  while (i < lines.length) {
    const match = LIST.exec(lines[i]);
    if (match && match[1].length === indent && /\d/.test(match[2]) === ordered) {
      item = listItem(match[3], notes);
      box.append(item);
      i++;
    } else if (match && match[1].length > indent && item) {
      const [inner, next] = list(lines, i, notes);
      item.append(inner);
      i = next;
    } else break;
  }
  return [box, i];
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function table(lines, start, notes) {
  const header = cells(lines[start]);
  const aligns = cells(lines[start + 1]).map(cell => /^:-+:$/.test(cell) ? "center" : /-+:$/.test(cell) ? "right" : "");
  const box = node("table");
  const head = node("thead");
  const row = node("tr");
  header.forEach((cell, index) => {
    const th = node("th");
    if (aligns[index]) th.style.textAlign = aligns[index];
    th.append(...inline(cell, notes));
    row.append(th);
  });
  head.append(row);
  const body = node("tbody");
  let i = start + 2;
  for (; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) {
    const tr = node("tr");
    cells(lines[i]).forEach((cell, index) => {
      const td = node("td");
      if (aligns[index]) td.style.textAlign = aligns[index];
      td.append(...inline(cell, notes));
      tr.append(td);
    });
    body.append(tr);
  }
  box.append(head, body);
  return [box, i];
}

function blocks(lines, out, notes) {
  let plain = [];
  const flush = () => {
    if (plain.length) out.append(paragraph(plain, notes));
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
    } else if ((match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line))) {
      flush();
      const heading = node(["h2", "h3", "h4", "h4", "h4", "h4"][match[1].length - 1]);
      heading.append(...inline(match[2], notes));
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
      blocks(quoted, quote, notes);
      out.append(quote);
    } else if (LIST.test(line)) {
      flush();
      const [box, next] = list(lines, i, notes);
      out.append(box);
      i = next - 1;
    } else if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const [box, next] = table(lines, i, notes);
      out.append(box);
      i = next - 1;
    } else if (FOOTNOTE.test(line)) {
      flush();
    } else if (line.trim() === "") flush();
    else plain.push(line);
  }
  flush();
}

export function render(text) {
  const out = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const notes = { names: [], texts: {} };
  for (const line of lines) {
    const match = FOOTNOTE.exec(line);
    if (match && !notes.names.includes(match[1])) {
      notes.names.push(match[1]);
      notes.texts[match[1]] = match[2];
    }
  }
  blocks(lines, out, notes);
  if (notes.names.length) {
    const box = node("ol", null);
    box.className = "footnotes";
    for (const name of notes.names) {
      const item = node("li");
      item.id = "note-" + name;
      item.append(...inline(notes.texts[name], notes));
      box.append(item);
    }
    out.append(box);
  }
  return out;
}
