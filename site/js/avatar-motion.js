export const CLIPS = ["Idle", "Walk", "Jump", "Swim", "Dead"];

const FADE = 0.3;
const HOLD = 0.6;
const LOOP = 2;
const PARTS = [
  { bone: "root/head", offset: [0, -7.7, -1.5], look: [[1, 0, 0], [0, 1, 0]] },
  { bone: "root", offset: [0, -2.8, -1.5], look: [[-1, 0, 0], [0, 1, 0]] },
  { bone: "root/L_arm", offset: [0.5, -7.5, 2], look: [[0, -1, 0], [1, 0, 0]] },
  { bone: "root/R_arm", offset: [0.5, -7.5, 2], look: [[0, -1, 0], [-1, 0, 0]] },
  { bone: "root/L_hip", offset: [-1, -1.5, 0], look: [[0, 0, 1], [0, 1, 0]] },
  { bone: "root/L_hip/L_knee", offset: [-1, -1.5, 0], look: [[1, 0, 0], [0, 1, 0]] },
  { bone: "root/R_hip", offset: [-1, -1.5, 0], look: [[0, 0, 1], [0, 1, 0]] },
  { bone: "root/R_hip/R_knee", offset: [-1, -1.5, 0], look: [[1, 0, 0], [0, 1, 0]] },
];
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const apply = (m, v) => [0, 1, 2].map(r => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
const multiply = (a, b) => [0, 1, 2].map(r => [0, 1, 2].map(c => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(x => x / length);
};

function lookRotation(forward, up) {
  const r = unit(cross(up, forward));
  const u = cross(forward, r);
  return [0, 1, 2].map(i => [r[i], u[i], forward[i]]);
}

function quaternion(x, y, z, w) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

const ATTACH = PARTS.map(part => lookRotation(...part.look));

function sample(keys, time) {
  if (!keys || !keys.length) return null;
  const n = (keys[0].length - 1) / 3;
  const first = keys[0], last = keys[keys.length - 1];
  if (time <= first[0]) return first.slice(1, 1 + n);
  if (time >= last[0]) return last.slice(1, 1 + n);
  let i = 1;
  while (keys[i][0] < time) i++;
  const a = keys[i - 1], b = keys[i];
  const dt = b[0] - a[0];
  const s = (time - a[0]) / dt, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = 3 * s2 - 2 * s3, h11 = s3 - s2;
  const value = [];
  for (let k = 0; k < n; k++) value.push(h00 * a[1 + k] + h10 * a[1 + 2 * n + k] * dt + h01 * b[1 + k] + h11 * b[1 + n + k] * dt);
  return n === 4 ? unit(value) : value;
}

function clipTime(clip, elapsed) {
  if (clip.wrap === LOOP) return { time: elapsed % clip.length, restarted: null };
  const cycle = clip.length + HOLD;
  const round = Math.floor(elapsed / cycle);
  const since = elapsed - round * cycle;
  return { time: Math.min(since, clip.length), restarted: round > 0 ? since : null };
}

function locals(clip, time) {
  const result = new Map();
  for (const [path, curves] of Object.entries(clip.bones)) {
    result.set(path, { position: sample(curves.position, time) || [0, 0, 0], rotation: sample(curves.rotation, time) || [0, 0, 0, 1] });
  }
  return result;
}

function blend(from, to, weight) {
  const result = new Map(to);
  for (const [path, a] of from) {
    const b = to.get(path);
    if (!b) continue;
    const sign = a.rotation.reduce((sum, v, k) => sum + v * b.rotation[k], 0) < 0 ? -1 : 1;
    result.set(path, {
      position: a.position.map((v, k) => v + (b.position[k] - v) * weight),
      rotation: unit(a.rotation.map((v, k) => v + (b.rotation[k] * sign - v) * weight)),
    });
  }
  return result;
}

let loading = null;

export function loadClips(url) {
  loading ??= fetch(url).then(response => response.json());
  return loading;
}

export function start(state, now) {
  state.clip = 0;
  state.started = now;
  state.from = null;
}

export function advance(clips, state, now) {
  const clip = clips[CLIPS[state.clip]];
  state.from = { clip: CLIPS[state.clip], time: clipTime(clip, (now - state.started) / 1000).time };
  state.clip = (state.clip + 1) % CLIPS.length;
  state.started = now;
}

export function poses(clips, state, now, parts) {
  const clip = clips[CLIPS[state.clip]];
  const elapsed = Math.max(0, (now - state.started) / 1000);
  const { time, restarted } = clipTime(clip, elapsed);
  let pose = locals(clip, time);
  if (state.from && elapsed < FADE) pose = blend(locals(clips[state.from.clip], state.from.time), pose, elapsed / FADE);
  else if (restarted !== null && restarted < FADE) pose = blend(locals(clip, clip.length), pose, restarted / FADE);
  const bones = new Map();
  const world = path => {
    if (bones.has(path)) return bones.get(path);
    const split = path.lastIndexOf("/");
    const parent = split < 0 ? { position: [0, 0, 0], rotation: IDENTITY } : world(path.slice(0, split));
    const local = pose.get(path) || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const result = { position: add(parent.position, apply(parent.rotation, local.position)), rotation: multiply(parent.rotation, quaternion(...local.rotation)) };
    bones.set(path, result);
    return result;
  };
  return parts.map(({ index, scale }) => {
    const part = PARTS[index];
    const bone = world(part.bone);
    const rotation = multiply(bone.rotation, ATTACH[index]);
    const offset = add(bone.position, apply(bone.rotation, apply(ATTACH[index], part.offset.map(v => v * scale))));
    return {
      rotation: new Float32Array([rotation[0][0], rotation[1][0], rotation[2][0], rotation[0][1], rotation[1][1], rotation[2][1], rotation[0][2], rotation[1][2], rotation[2][2]]),
      offset: new Float32Array(offset),
    };
  });
}

export function frame(parts, placed, size) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  parts.forEach((part, i) => {
    const { rotation: m, offset } = placed[i];
    const positions = part.positions;
    for (let v = 0; v < positions.length; v += 3) {
      const x = positions[v], y = positions[v + 1], z = positions[v + 2];
      const point = [m[0] * x + m[3] * y + m[6] * z + offset[0], m[1] * x + m[4] * y + m[7] * z + offset[1], m[2] * x + m[5] * y + m[8] * z + offset[2]];
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], point[k]);
        high[k] = Math.max(high[k], point[k]);
      }
    }
  });
  return { center: low.map((v, k) => (v + high[k]) / 2), fit: size / Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]) };
}
