const SCHEME = "openkogama://import";

export const LAUNCHER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 576"><!--! Font Awesome Pro 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2026 Fonticons, Inc. --><path fill="currentColor" d="M336 17l25 1 144 6 9.4 .4 18.6 18.6 0 0c8.9 8.9 15.1 15.1 18.6 18.6l.4 9.4 6 144 1 25-80.9 0c.5-7 3.4-44.7 8.7-113l-180.9 201-16.9 18.8C263.1 321 234 292 229.2 287.1L248 270.2 449 89.2 336 97.9 336 17zM96 48l168 0 0 48-144 0 0 360 360 0 0-144 48 0 0 240-504 0 0-504 72 0z"/></svg>';

export function importLink({ kind, name, urls, offset, length, scale, sha256 }) {
  const query = new URLSearchParams();
  query.set("kind", kind);
  if (name) query.set("name", name);
  for (const url of urls || []) if (url) query.append("url", url);
  if (offset != null) query.set("offset", String(offset));
  if (length != null) query.set("length", String(length));
  if (scale != null) query.set("scale", String(scale));
  if (sha256) query.set("sha256", sha256);
  return SCHEME + "?" + query.toString().replace(/\+/g, "%20");
}

export function openInLauncher(item) {
  const href = importLink(item);
  if (href.length > 12000) return false;
  location.href = href;
  return true;
}
