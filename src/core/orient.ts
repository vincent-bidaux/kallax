// ─────────────────────────────────────────────────────────────
// Orientation in 90° steps about X, Y and Z (world axes).
// Stored as Euler steps: R = Rz(rotation) · Ry(tilt.y) · Rx(tilt.x)
// (X applied first) — three.js Euler order 'ZYX'. Keeping 90° steps
// means every item stays an axis-aligned box: snapping, collisions and
// dimensions keep working.
// ─────────────────────────────────────────────────────────────
import type { Item, Rotation, Size3, Vec3 } from './types';

export type Axis3 = 'x' | 'y' | 'z';
type M3 = number[]; // row-major 3×3, integer entries (−1, 0, 1)

const ANG: Rotation[] = [0, 90, 180, 270];
const c = (a: number) => Math.round(Math.cos((a * Math.PI) / 180));
const s = (a: number) => Math.round(Math.sin((a * Math.PI) / 180));

function rx(a: number): M3 { return [1, 0, 0, 0, c(a), -s(a), 0, s(a), c(a)]; }
function ry(a: number): M3 { return [c(a), 0, s(a), 0, 1, 0, -s(a), 0, c(a)]; }
function rz(a: number): M3 { return [c(a), -s(a), 0, s(a), c(a), 0, 0, 0, 1]; }
function mul(a: M3, b: M3): M3 {
  const o: M3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
const eq = (a: M3, b: M3) => a.every((v, i) => v === b[i]);
function rotAbout(axis: Axis3, a: number): M3 { return axis === 'x' ? rx(a) : axis === 'y' ? ry(a) : rz(a); }

export function eulerMatrix(x: number, y: number, z: number): M3 { return mul(rz(z), mul(ry(y), rx(x))); }

export function itemEuler(it: Item): { x: Rotation; y: Rotation; z: Rotation } {
  return { x: it.tilt?.x ?? 0, y: it.tilt?.y ?? 0, z: it.rotation };
}
export function itemMatrix(it: Item): M3 {
  const e = itemEuler(it);
  return eulerMatrix(e.x, e.y, e.z);
}
export function isUpright(it: Item): boolean {
  return !(it.tilt?.x || it.tilt?.y);
}

/** Canonical Euler steps for an orientation matrix (prefers no tilt, then fewest steps). */
function eulerFrom(m: M3): { x: Rotation; y: Rotation; z: Rotation } {
  let best: { x: Rotation; y: Rotation; z: Rotation } | null = null, bestCost = Infinity;
  for (const x of ANG) for (const y of ANG) for (const z of ANG) {
    if (!eq(eulerMatrix(x, y, z), m)) continue;
    const cost = (x ? 10 : 0) + (y ? 10 : 0) + (x + y) / 90;
    if (cost < bestCost) { bestCost = cost; best = { x, y, z }; }
  }
  return best ?? { x: 0, y: 0, z: 0 };
}

/** Orientation after rotating by `delta` about a WORLD axis. */
export function rotatedOrientation(it: Item, axis: Axis3, delta: 90 | -90): { rotation: Rotation; tilt?: { x: Rotation; y: Rotation } } {
  const e = eulerFrom(mul(rotAbout(axis, delta), itemMatrix(it)));
  return { rotation: e.z, tilt: e.x || e.y ? { x: e.x, y: e.y } : undefined };
}

/** Rotate a point (relative to a centre) about a world axis by ±90°. */
export function rotateVec(v: Vec3, axis: Axis3, delta: 90 | -90): Vec3 {
  const m = rotAbout(axis, delta);
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
}

/** World AABB size of a local size under an orientation. */
export function orientSize(local: Size3, it: Item): Size3 {
  const m = itemMatrix(it);
  const v = [local.w, local.d, local.h];
  const r = [0, 1, 2].map(i => Math.abs(m[i * 3]) * v[0] + Math.abs(m[i * 3 + 1]) * v[1] + Math.abs(m[i * 3 + 2]) * v[2]);
  return { w: r[0], d: r[1], h: r[2] };
}

/** Rotate a local direction into world space. */
export function orientDir(it: Item, v: Vec3): Vec3 {
  const m = itemMatrix(it);
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
}

export function orientLabel(it: Item): string {
  const e = itemEuler(it);
  const parts = [];
  if (e.x) parts.push(`X ${e.x}°`);
  if (e.y) parts.push(`Y ${e.y}°`);
  parts.push(`Z ${e.z}°`);
  return parts.join(' · ');
}
