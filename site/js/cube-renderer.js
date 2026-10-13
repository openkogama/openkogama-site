const IDENTITY = [20, 120, 124, 24, 4, 104, 100, 0];
const FACES = [
  [[0, 1, 2, 3], [0, 1, 0], 1, 2],
  [[4, 5, 6, 7], [0, -1, 0], 2, 1],
  [[7, 6, 1, 0], [0, 0, -1], 4, 8],
  [[5, 4, 3, 2], [0, 0, 1], 8, 4],
  [[4, 7, 0, 3], [-1, 0, 0], 16, 32],
  [[6, 5, 2, 1], [1, 0, 0], 32, 16],
];
const FACE_UV = [[0, 1, 2, 0.5], [0, -1, 2, -0.5], [0, 1, 1, 0.5], [0, -1, 1, -0.5], [2, -1, 1, -0.5], [2, 1, 1, 0.5]];
const SIDES = [[1, [0, 1, 2, 3]], [2, [4, 5, 6, 7]], [8, [2, 3, 4, 5]], [4, [0, 1, 6, 7]], [16, [0, 3, 4, 7]], [32, [1, 2, 5, 6]]];
const FIELD_OF_VIEW = 35;
const CAMERA_OFFSET = [4.57, 2.0, 0.15];
export const PREVIEW_SIZE = 2;
export const TURN = -45;
const LIGHT_EULER = [50, -30];
const LIGHT_COLOR = [1.0, 0.988, 0.753];
const AMBIENT = 0.45;
const OCCLUSION = 0.5;
const MAX_TRIANGLES = 300000;
export const AVATAR_TURN = 180;
const MODEL_TURN = 180 - TURN;

const corner = value => [-0.5 + Math.floor(value / 25) * 0.25, -0.5 + Math.floor(value / 5) % 5 * 0.25, -0.5 + value % 5 * 0.25];
const IDENTITY_CORNERS = IDENTITY.map(corner);
const key = (x, y, z) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);

function quaternionMatrix(x, y, z, w) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export function parseModel(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === "OKA1") {
    const parts = [];
    let pos = 5;
    for (let i = 0; i < bytes[4]; i++) {
      if (!bytes[pos++]) continue;
      const values = Array.from({ length: 8 }, (_, k) => view.getFloat32(pos + k * 4));
      const size = view.getUint32(pos + 32);
      pos += 36;
      parts.push({ index: i, scale: values[7], cubes: readCubes(view, bytes, pos), rotation: quaternionMatrix(...values.slice(3, 7)), offset: values.slice(0, 3) });
      pos += size;
    }
    return { parts, turn: AVATAR_TURN };
  }
  const start = magic === "OKM1" ? 8 : 0;
  return { scale: start ? view.getFloat32(4) : 1, cubes: readCubes(view, bytes, start), turn: MODEL_TURN };
}

function readCubes(view, bytes, start) {
  let pos = start;
  const count = view.getInt32(pos);
  pos += 4;
  const cubes = new Map();
  for (let i = 0; i < count; i++) {
    const x = view.getInt16(pos), y = view.getInt16(pos + 2), z = view.getInt16(pos + 4), flags = bytes[pos + 6];
    pos += 7;
    let corners = IDENTITY;
    if (!(flags & 1)) {
      corners = Array.from(bytes.subarray(pos, pos + 8));
      pos += 8;
    }
    let materials;
    if (flags & 2) {
      materials = new Array(6).fill(bytes[pos]);
      pos += 1;
    } else {
      materials = Array.from(bytes.subarray(pos, pos + 6));
      pos += 6;
    }
    for (let step = 0; step < Math.max(flags >> 2, 1); step++) {
      cubes.set(key(x + step, y, z), { position: [x + step, y, z], corners, materials });
    }
  }
  return cubes;
}

function unindented(corners) {
  const moved = corners.map((value, i) => value !== IDENTITY[i]);
  const count = moved.filter(Boolean).length;
  if (count === 0) return 63;
  if (count > 4) return 0;
  let sides = 0;
  for (const [flag, indices] of SIDES) {
    if (!indices.some(i => moved[i])) sides |= flag;
  }
  return sides;
}

function occlusion(cubes, position, normal, canonical) {
  const axis = normal.findIndex(value => value !== 0);
  const base = position.map((value, i) => value + normal[i]);
  const steps = [0, 1, 2].filter(i => i !== axis).map(i => {
    const step = [0, 0, 0];
    step[i] = canonical[i] > 0 ? 1 : -1;
    return step;
  });
  const cells = [base, base.map((v, i) => v + steps[0][i]), base.map((v, i) => v + steps[1][i]), base.map((v, i) => v + steps[0][i] + steps[1][i])];
  return cells.filter(cell => !cubes.has(key(...cell))).length * 0.25;
}

function yaw(degrees) {
  const t = degrees * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function pitch(degrees) {
  const t = degrees * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

const apply = (m, v) => [0, 1, 2].map(r => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

function multiply(a, b) {
  return [0, 1, 2].map(r => [0, 1, 2].map(c => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
}

function around(axis, degrees) {
  const t = degrees * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  const [x, y, z] = axis;
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

function cameraRight() {
  return normalize(cross([0, 1, 0], normalize(CAMERA_OFFSET.map(v => -v))));
}

function orientation(turn, tilt) {
  const m = multiply(around(cameraRight(), tilt), yaw(turn));
  return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
}

function lightDirection() {
  const forward = apply(yaw(LIGHT_EULER[1]), apply(pitch(LIGHT_EULER[0]), [0, 0, 1]));
  return normalize(forward.map(x => -x));
}

function partTriangles({ scale, cubes }, materials, place, direction) {
  const count = materials.count;
  const triangles = [];
  const flags = new Map();
  for (const [k, cube] of cubes) flags.set(k, unindented(cube.corners));
  for (const [k, cube] of cubes) {
    const verts = cube.corners.map(c => corner(c).map((v, i) => v + cube.position[i]));
    FACES.forEach(([indices, normal, own, opposite], face) => {
      const neighbor = key(cube.position[0] + normal[0], cube.position[1] + normal[1], cube.position[2] + normal[2]);
      if (cubes.has(neighbor) && flags.get(k) & own && flags.get(neighbor) & opposite) return;
      const quad = indices.map(i => verts[i]);
      const [axisU, signU, axisV, offsetU] = FACE_UV[face];
      const quadUv = quad.map(p => [(signU * p[axisU] + offsetU) * scale * 0.5, (p[axisV] + 0.5) * scale * 0.5]);
      const quadLight = indices.map(i => occlusion(cubes, cube.position, normal, IDENTITY_CORNERS[i]));
      const material = cube.materials[face] < count ? cube.materials[face] : materials.fallback;
      const placed = quad.map(place);
      const facing = direction(normal);
      for (const [a, b, c] of [[0, 3, 2], [2, 1, 0]]) {
        triangles.push({ points: [placed[a], placed[b], placed[c]], uvs: [quadUv[a], quadUv[b], quadUv[c]], lights: [quadLight[a], quadLight[b], quadLight[c]], material, normal: facing });
      }
    });
    if (triangles.length > MAX_TRIANGLES) return null;
  }
  return triangles;
}

function arrays(triangles, center, fit) {
  const positions = [], normals = [], uvs = [], lights = [], tiles = [];
  for (const t of triangles) {
    const points = t.points.map(p => p.map((v, i) => (v - center[i]) * fit));
    let normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    const length = Math.hypot(...normal);
    if (length < 1e-12) continue;
    normal = normal.map(v => v / length);
    if (dot(normal, t.normal) < 0) normal = normal.map(v => -v);
    for (let v = 0; v < 3; v++) {
      positions.push(...points[v]);
      normals.push(...normal);
      uvs.push(...t.uvs[v]);
      lights.push(t.lights[v]);
      tiles.push(t.material);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    lights: new Float32Array(lights),
    tiles: new Float32Array(tiles),
    vertices: positions.length / 3,
  };
}

function bounds(points) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    low[i] = Math.min(low[i], p[i]);
    high[i] = Math.max(high[i], p[i]);
  }
  return { center: low.map((v, i) => (v + high[i]) / 2), fit: PREVIEW_SIZE / Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]) };
}

const placer = ({ scale, rotation, offset }, spin) => point => {
  let placed = point.map(v => v * scale);
  if (rotation) placed = apply(rotation, placed);
  placed = placed.map((v, i) => v + offset[i]);
  return spin ? apply(spin, placed) : placed;
};

export function buildMesh(model, materials) {
  const parts = model.parts || [{ scale: model.scale, cubes: model.cubes, rotation: null, offset: [0, 0, 0] }];
  const spin = model.turn ? yaw(model.turn) : null;
  const triangles = [];
  for (const part of parts) {
    const direction = normal => {
      const turned = part.rotation ? apply(part.rotation, normal) : normal;
      return spin ? apply(spin, turned) : turned;
    };
    const built = partTriangles(part, materials, placer(part, spin), direction);
    if (!built) return null;
    triangles.push(...built);
    if (triangles.length > MAX_TRIANGLES) return null;
  }
  if (triangles.length === 0) return null;
  const { center, fit } = bounds(triangles.flatMap(t => t.points));
  return arrays(triangles, center, fit);
}

export function buildParts(model, materials) {
  if (!model.parts) return null;
  const built = [];
  const placed = [];
  let total = 0;
  for (const part of model.parts) {
    const triangles = partTriangles(part, materials, point => point.map(v => v * part.scale), normal => normal);
    if (!triangles) return null;
    total += triangles.length;
    if (total > MAX_TRIANGLES) return null;
    const place = placer(part, null);
    for (const t of triangles) for (const p of t.points) placed.push(place(p.map(v => v / part.scale)));
    built.push({ index: part.index, scale: part.scale, triangles });
  }
  if (!placed.length) return null;
  const { center, fit } = bounds(placed);
  return {
    center,
    fit,
    parts: built.map(({ index, scale, triangles }) => ({ index, scale, ...arrays(triangles, [0, 0, 0], 1) })),
  };
}

const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
in float light;
in float tile;
uniform mat4 viewProjection;
uniform mat3 model;
uniform mat3 part;
uniform vec3 partOffset;
uniform vec3 center;
uniform float fit;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUv;
out float vLight;
flat out int vTile;
void main() {
  vec3 world = model * ((part * position + partOffset - center) * fit);
  vPosition = world;
  vNormal = model * (part * normal);
  vUv = uv;
  vLight = light;
  vTile = int(tile + 0.5);
  gl_Position = viewProjection * vec4(world, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUv;
in float vLight;
flat in int vTile;
uniform sampler2D atlas;
uniform vec2 atlasSize;
uniform float tileSize;
uniform float margin;
uniform int columns;
uniform vec3 eye;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform float ambient;
uniform float occlusion;
uniform float emission[69];
out vec4 color;
void main() {
  vec3 normal = normalize(vNormal);
  if (dot(normal, eye - vPosition) <= 0.0) discard;
  float cell = tileSize + 2.0 * margin;
  vec2 origin = vec2(float(vTile % columns), float(vTile / columns)) * cell + margin;
  vec2 inner = fract(vUv);
  vec2 pixel = origin + vec2(inner.x, 1.0 - inner.y) * tileSize;
  vec3 texel = textureLod(atlas, pixel / atlasSize, 0.0).rgb;
  float diffuse = max(dot(normal, lightDirection), 0.0);
  vec3 shade = (ambient + diffuse * lightColor) * (occlusion + (1.0 - occlusion) * vLight) + emission[vTile];
  color = vec4(min(texel * shade, vec3(1.0)), 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function viewProjection(size) {
  const eye = CAMERA_OFFSET;
  const forward = normalize(eye.map(v => -v));
  const right = normalize(cross([0, 1, 0], forward));
  const up = cross(forward, right);
  const view = [
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ];
  const near = 0.05, far = 100, f = 1 / Math.tan(FIELD_OF_VIEW * Math.PI / 360);
  const projection = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const result = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += projection[k * 4 + r] * view[c * 4 + k];
    result[c * 4 + r] = sum;
  }
  return result;
}

export async function createRenderer(atlasUrl, materials, size = 512) {
  const canvas = typeof document === "undefined" ? new OffscreenCanvas(size, size) : document.createElement("canvas");
  canvas.width = canvas.height = size;
  const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: true, alpha: true });
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const atlas = await createImageBitmap(await (await fetch(atlasUrl)).blob());
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  atlas.close();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const emission = new Float32Array(69);
  for (const [material, strength] of Object.entries(materials.emission || {})) emission[Number(material)] = strength;
  const uniform = name => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform("atlas"), 0);
  gl.uniform2f(uniform("atlasSize"), materials.size[0], materials.size[1]);
  gl.uniform1f(uniform("tileSize"), materials.tile);
  gl.uniform1f(uniform("margin"), materials.margin);
  gl.uniform1i(uniform("columns"), materials.columns);
  gl.uniform3fv(uniform("lightDirection"), lightDirection());
  gl.uniform3fv(uniform("lightColor"), LIGHT_COLOR);
  gl.uniform1f(uniform("ambient"), AMBIENT);
  gl.uniform1f(uniform("occlusion"), OCCLUSION);
  gl.uniform1fv(uniform("emission[0]"), emission);
  gl.uniformMatrix4fv(uniform("viewProjection"), false, viewProjection(size));
  gl.uniform3fv(uniform("eye"), CAMERA_OFFSET);
  const model = uniform("model");
  gl.enable(gl.DEPTH_TEST);

  const part = uniform("part");
  const partOffset = uniform("partOffset");
  const center = uniform("center");
  const fit = uniform("fit");
  const attributes = ["position", "normal", "uv", "light", "tile"].map(name => [name, gl.getAttribLocation(program, name)]);
  const sizes = { position: 3, normal: 3, uv: 2, light: 1, tile: 1 };
  const sources = { position: "positions", normal: "normals", uv: "uvs", light: "lights", tile: "tiles" };
  const still = { rotation: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), offset: new Float32Array(3) };

  let pieces = [];
  let frame = { center: [0, 0, 0], fit: 1 };

  function upload(mesh) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffers = attributes.map(([name, location]) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh[sources[name]], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, sizes[name], gl.FLOAT, false, 0, 0);
      return buffer;
    });
    gl.bindVertexArray(null);
    return { vao, buffers, count: mesh.vertices };
  }

  function clear() {
    for (const piece of pieces) {
      gl.deleteVertexArray(piece.vao);
      piece.buffers.forEach(buffer => gl.deleteBuffer(buffer));
    }
    pieces = [];
  }

  function load(mesh) {
    clear();
    pieces = [upload(mesh)];
    frame = { center: [0, 0, 0], fit: 1 };
  }

  function loadParts(built) {
    clear();
    pieces = built.parts.map(upload);
    frame = { center: built.center, fit: built.fit };
  }

  function render(turn = TURN, tilt = 0, poses = null, zoom = 1) {
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix3fv(model, false, orientation(turn, tilt));
    gl.uniform3fv(center, frame.center);
    gl.uniform1f(fit, frame.fit * zoom);
    pieces.forEach((piece, i) => {
      const pose = poses ? poses[i] : still;
      gl.uniformMatrix3fv(part, false, pose.rotation);
      gl.uniform3fv(partOffset, pose.offset);
      gl.bindVertexArray(piece.vao);
      gl.drawArrays(gl.TRIANGLES, 0, piece.count);
    });
    gl.bindVertexArray(null);
  }

  return {
    canvas,
    materials,
    load,
    loadParts,
    render,
    draw(mesh, target) {
      load(mesh);
      render();
      const context = target.getContext("2d");
      context.clearRect(0, 0, target.width, target.height);
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, 0, 0, target.width, target.height);
    },
  };
}

export async function fetchRange(url, offset, length, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (!response.ok) throw new Error(`model request failed with ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

export async function loadBlob(url, offset, length) {
  const packed = await fetchRange(url, offset, length);
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).arrayBuffer();
}

export async function loadModel(url, offset, length) {
  return parseModel(await loadBlob(url, offset, length));
}
