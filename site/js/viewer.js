import { AVATAR_TURN, createRenderer, PREVIEW_SIZE, TURN } from "./cube-renderer.js";
import { advance, frame as framing, loadClips, poses, start } from "./avatar-motion.js";

const SIZE = 512;
const SPIN = 0.6;
const TILT = 0.4;
const TILT_LIMIT = 85;
const KEEP = 12;
const HOVER_DELAY = 150;
const TAP_SLOP = 8;
const CLIP_DATA = new URL("./avatar-animations.json", import.meta.url).href;

export function createViewer(grid, { animated, atlas, materials, geometry, row, open }) {
  const meshes = new Map();
  let renderer = null, starting = null, current = null, hovered = null, drag = null, frame = 0, waiting = 0, clips = null;
  let lastType = "mouse", travelled = 0;

  function setup() {
    starting ??= createRenderer(atlas, materials, SIZE)
      .then(created => {
        renderer = created;
        if (renderer) renderer.canvas.className = "viewer";
        return renderer;
      })
      .catch(error => {
        console.warn(error);
        return null;
      });
    return starting;
  }

  function mesh(item) {
    let entry = meshes.get(item.sha256);
    if (entry) {
      meshes.delete(item.sha256);
    } else {
      entry = geometry(item).catch(error => {
        console.warn(error);
        return null;
      });
    }
    meshes.set(item.sha256, entry);
    if (meshes.size > KEEP) meshes.delete(meshes.keys().next().value);
    return entry;
  }

  function draw(now = performance.now()) {
    frame = 0;
    if (!current || !current.ready) return;
    if (current.parts) {
      renderer.render(current.turn, current.tilt, poses(clips, current, now, current.parts));
      frame = requestAnimationFrame(draw);
    } else {
      renderer.render(current.turn, current.tilt);
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  async function activate(picture, item, touch) {
    if (current && current.picture === picture) return;
    deactivate();
    const state = current = { picture, turn: TURN, tilt: 0, ready: false, parts: null };
    if (touch) picture.classList.add("touch");
    const [created, data, loaded] = await Promise.all([setup(), mesh(item), animated ? loadClips(CLIP_DATA).catch(() => null) : null]);
    if (loaded) clips = loaded;
    if (current !== state || !created || !data || data.status !== "ok" || (data.avatar && !clips)) return;
    if (data.avatar) {
      state.parts = data.avatar.parts.map(({ index, scale }) => ({ index, scale }));
      start(state, performance.now());
      const { center, fit } = framing(data.avatar.parts, poses(clips, state, state.started, state.parts), PREVIEW_SIZE);
      created.loadParts({ parts: data.avatar.parts, center, fit });
      state.turn = TURN + AVATAR_TURN;
    } else {
      created.load(data.mesh);
    }
    picture.append(created.canvas);
    picture.classList.add("live");
    state.ready = true;
    draw();
  }

  function next() {
    advance(clips, current, performance.now());
    schedule();
  }

  function deactivate() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (!current) return;
    current.picture.classList.remove("live", "touch", "dragging");
    if (renderer) renderer.canvas.remove();
    current = null;
  }

  function usable(picture) {
    const item = picture && row(picture);
    return item && !picture.closest(".too-big") ? item : null;
  }

  function release(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag.picture.classList.remove("dragging");
    drag = null;
  }

  document.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" && current && !current.picture.contains(event.target)) deactivate();
  });

  grid.addEventListener("pointerover", event => {
    if (event.pointerType !== "mouse") return;
    const picture = event.target.closest(".picture");
    if (!picture || picture.contains(event.relatedTarget)) return;
    hovered = picture;
    clearTimeout(waiting);
    waiting = setTimeout(() => {
      const item = usable(picture);
      if (hovered !== picture || !item) return;
      setup();
      if (animated) activate(picture, item, false);
      else mesh(item);
    }, HOVER_DELAY);
  });

  grid.addEventListener("pointerout", event => {
    if (event.pointerType !== "mouse") return;
    const picture = event.target.closest(".picture");
    if (!picture || picture.contains(event.relatedTarget)) return;
    if (hovered === picture) hovered = null;
    if (!drag && current && current.picture === picture) deactivate();
  });

  grid.addEventListener("pointerdown", event => {
    lastType = event.pointerType;
    travelled = 0;
    const picture = event.target.closest(".picture");
    if (!picture || event.button !== 0 || event.target.closest(".icon")) return;
    const item = usable(picture);
    if (!item) return;
    const mouse = event.pointerType === "mouse";
    if (!mouse && !(current && current.picture === picture)) return;
    if (mouse) event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, picture };
    if (event.isTrusted) picture.setPointerCapture(event.pointerId);
    picture.classList.add("dragging");
    if (mouse) activate(picture, item, false);
  });

  grid.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (!current || current.picture !== drag.picture) return;
    current.turn -= dx * SPIN;
    current.tilt = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, current.tilt - dy * TILT));
    if (current.ready) schedule();
  });

  grid.addEventListener("touchmove", event => {
    if (drag) event.preventDefault();
  }, { passive: false });

  grid.addEventListener("pointerup", release);
  grid.addEventListener("pointercancel", release);

  grid.addEventListener("click", event => {
    if (travelled > TAP_SLOP) return;
    const picture = event.target.closest(".picture");
    if (!picture || event.target.closest(".icon") || !row(picture)) return;
    open(picture);
  });

  return {
    cycle(picture) {
      const item = usable(picture);
      if (!item) return;
      if (current && current.picture === picture && current.parts) next();
      else activate(picture, item, lastType !== "mouse");
    },
    reset() {
      drag = null;
      hovered = null;
      deactivate();
    },
  };
}
