const cache = new Map();

function key(kind) {
  return `openkogama-liked-${kind}`;
}

function read(kind) {
  if (cache.has(kind)) return cache.get(kind);
  let set;
  try {
    set = new Set(JSON.parse(localStorage.getItem(key(kind)) || "[]"));
  } catch {
    set = new Set();
  }
  cache.set(kind, set);
  return set;
}

export function mapKey(map) {
  return map.id ? `${map.site}:${map.id}` : `name:${map.name}`;
}

export function liked(kind, sha) {
  return read(kind).has(sha);
}

export function likedList(kind) {
  return [...read(kind)].reverse();
}

export function toggle(kind, sha) {
  const set = read(kind);
  if (set.has(sha)) set.delete(sha);
  else set.add(sha);
  try {
    localStorage.setItem(key(kind), JSON.stringify([...set]));
  } catch (error) {
    console.warn(error);
  }
  document.dispatchEvent(new CustomEvent("liked", { detail: { kind, sha, liked: set.has(sha) } }));
  return set.has(sha);
}
