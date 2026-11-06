const SCHEME = "openkogama://import";

export const LAUNCHER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

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
