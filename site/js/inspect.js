import { AVATAR_TURN, createRenderer, PREVIEW_SIZE, TURN } from "./cube-renderer.js";
import { advance, frame as framing, loadClips, poses, start } from "./avatar-motion.js";

const SIZE = 1024;
const SPIN = 0.4;
const TILT = 0.3;
const TILT_LIMIT = 85;
const TAP_SLOP = 8;
const ZOOM = [0.6, 4];
const CLIP_DATA = new URL("./avatar-animations.json", import.meta.url).href;

let starting = null;
let open = null;

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

function setup(atlas, materials) {
  starting ??= createRenderer(atlas, materials, SIZE).catch(error => {
    console.warn(error);
    return null;
  });
  return starting;
}

export function closeInspector() {
  if (!open) return;
  const state = open;
  open = null;
  cancelAnimationFrame(state.frame);
  state.element.remove();
  document.documentElement.classList.remove("inspecting");
  document.removeEventListener("keydown", state.keys);
  state.opener?.focus();
}

function sheet({ title, meta, description, tint, edge, actions }) {
  const element = document.createElement("div");
  element.className = "inspector";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", title);
  const panel = document.createElement("div");
  panel.className = "sheet";
  if (tint) panel.style.setProperty("--card", tint);
  if (edge) panel.style.setProperty("--card-edge", edge);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  const stage = document.createElement("div");
  stage.className = "stage";
  stage.dataset.state = "loading";
  const about = document.createElement("div");
  about.className = "about";
  const heading = document.createElement("h2");
  heading.className = "title";
  heading.textContent = title;
  const details = document.createElement("p");
  details.className = "details";
  details.textContent = meta;
  const row = document.createElement("div");
  row.className = "actions";
  row.append(...actions);
  const hint = document.createElement("p");
  hint.className = "hint";
  if (description) {
    const text = document.createElement("p");
    text.className = "description";
    text.textContent = description;
    about.append(heading, text, details, row, hint);
  } else {
    about.append(heading, details, row, hint);
  }
  panel.append(close, stage, about);
  element.append(panel);
  return { element, close, stage, hint };
}

export async function inspect({ row, title, meta, description, tint, edge, actions, atlas, materials, geometry, animated, opener }) {
  closeInspector();
  const view = sheet({ title, meta, description, tint, edge, actions });
  const touch = matchMedia("(pointer: coarse)").matches;
  view.hint.textContent = (touch ? "Drag to rotate, pinch to zoom" : "Drag to rotate, scroll to zoom")
    + (animated ? (touch ? ", tap to change the animation" : ", click to change the animation") : "");
  document.body.append(view.element);
  document.documentElement.classList.add("inspecting");
  const state = { element: view.element, frame: 0, turn: TURN, tilt: 0, zoom: 1, parts: null, opener, keys: null };
  open = state;
  state.keys = event => {
    if (event.key === "Escape") closeInspector();
  };
  document.addEventListener("keydown", state.keys);
  view.element.addEventListener("click", event => {
    if (event.target === view.element) closeInspector();
  });
  view.close.addEventListener("click", closeInspector);
  view.close.focus();

  const [renderer, data, clips] = await Promise.all([setup(atlas, materials), geometry(row), animated ? loadClips(CLIP_DATA).catch(() => null) : null]);
  if (open !== state) return;
  if (!renderer || !data || data.status !== "ok" || (data.avatar && !clips)) {
    view.stage.dataset.state = data && data.status === "too-big" ? "big" : "failed";
    return;
  }
  if (data.avatar) {
    state.parts = data.avatar.parts.map(({ index, scale }) => ({ index, scale }));
    start(state, performance.now());
    const { center, fit } = framing(data.avatar.parts, poses(clips, state, state.started, state.parts), PREVIEW_SIZE);
    renderer.loadParts({ parts: data.avatar.parts, center, fit });
    state.turn = TURN + AVATAR_TURN;
  } else {
    renderer.load(data.mesh);
  }
  delete view.stage.dataset.state;
  view.stage.append(renderer.canvas);

  const draw = now => {
    state.frame = 0;
    if (open !== state) return;
    renderer.render(state.turn, state.tilt, state.parts ? poses(clips, state, now, state.parts) : null, state.zoom);
    if (state.parts) state.frame = requestAnimationFrame(draw);
  };
  const schedule = () => {
    if (!state.frame) state.frame = requestAnimationFrame(draw);
  };
  draw(performance.now());

  const pointers = new Map();
  let travelled = 0, multi = false, pinch = null;
  const spread = () => {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const pinchStart = () => {
    pinch = pointers.size === 2 ? { spread: spread(), zoom: state.zoom } : null;
  };
  const release = event => {
    if (!pointers.delete(event.pointerId)) return false;
    pinchStart();
    if (!pointers.size) view.stage.classList.remove("dragging");
    return true;
  };
  view.stage.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    if (!pointers.size) {
      travelled = 0;
      multi = false;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) multi = true;
    pinchStart();
    if (event.isTrusted) view.stage.setPointerCapture(event.pointerId);
    view.stage.classList.add("dragging");
  });
  view.stage.addEventListener("pointermove", event => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const dx = event.clientX - point.x, dy = event.clientY - point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (pinch) {
      if (pinch.spread > 0) state.zoom = clamp(pinch.zoom * spread() / pinch.spread, ZOOM);
    } else if (pointers.size === 1) {
      state.turn -= dx * SPIN;
      state.tilt = clamp(state.tilt - dy * TILT, [-TILT_LIMIT, TILT_LIMIT]);
    }
    schedule();
  });
  view.stage.addEventListener("pointerup", event => {
    if (release(event) && !pointers.size && !multi && travelled <= TAP_SLOP && state.parts) {
      advance(clips, state, performance.now());
      schedule();
    }
  });
  view.stage.addEventListener("pointercancel", release);
  view.stage.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
  view.stage.addEventListener("gesturestart", event => event.preventDefault());
  view.stage.addEventListener("wheel", event => {
    event.preventDefault();
    state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.0015), ZOOM);
    schedule();
  }, { passive: false });
}
