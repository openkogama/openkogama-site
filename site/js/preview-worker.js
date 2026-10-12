import { buildMesh, buildParts, createRenderer, loadBlob, parseModel } from "./cube-renderer.js";
import { tint } from "./tint.js";

const SIZE = 256;
const KEEP = 64;
const blobs = new Map();
let renderer, output;

async function model(url, offset, length) {
  const key = `${url}#${offset}`;
  let blob = blobs.get(key);
  if (blob) blobs.delete(key);
  else blob = await loadBlob(url, offset, length);
  blobs.set(key, blob);
  if (blobs.size > KEEP) blobs.delete(blobs.keys().next().value);
  return parseModel(blob);
}

async function setup({ atlas, materials }) {
  renderer = await createRenderer(atlas, materials);
  output = new OffscreenCanvas(SIZE, SIZE);
  return { ready: Boolean(renderer) };
}

async function render({ url, offset, length }) {
  const mesh = buildMesh(await model(url, offset, length), renderer.materials);
  if (!mesh) return { status: "too-big" };
  renderer.draw(mesh, output);
  const colors = tint(output);
  const bitmap = output.transferToImageBitmap();
  return { status: "ok", colors, bitmap, transfer: [bitmap] };
}

async function geometry({ url, offset, length }) {
  const parsed = await model(url, offset, length);
  if (parsed.parts) {
    const avatar = buildParts(parsed, renderer.materials);
    if (!avatar) return { status: "too-big" };
    const transfer = avatar.parts.flatMap(part => [part.positions.buffer, part.normals.buffer, part.uvs.buffer, part.lights.buffer, part.tiles.buffer]);
    return { status: "ok", avatar, transfer };
  }
  const mesh = buildMesh(parsed, renderer.materials);
  if (!mesh) return { status: "too-big" };
  return { status: "ok", mesh, transfer: [mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.lights.buffer, mesh.tiles.buffer] };
}

async function colors({ url }) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: 48, resizeHeight: 48, resizeQuality: "medium" });
  const result = tint(bitmap);
  bitmap.close();
  return { colors: result };
}

const handlers = { setup, render, geometry, colors };

self.addEventListener("message", async ({ data }) => {
  try {
    const { transfer = [], ...result } = await handlers[data.type](data);
    self.postMessage({ id: data.id, ...result }, transfer);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
});
