// ─────────────────────────────────────────────────────────────
// Orientation: any angle about Z, plus 90° steps about X and Y.
// Stored as Euler angles: R = Rz(rotation) · Ry(tilt.y) · Rx(tilt.x)
// (X applied first) — three.js Euler order 'ZYX'.
//
// `rotation` (about the vertical axis) may be any angle in [0, 360).
// The tilts stay in 90° steps, so every item is a box whose faces are
// either horizontal or vertical: seen from above it is a rectangle
// turned by `rotation`.
//
// "Frame" of an item: the horizontal frame turned by φ = rotation mod 90
// (φ ∈ [0, 90)). In its own frame an item is an axis-aligned box
// (core/obb.ts). Two items whose angles are equal modulo 90° share a
// frame: they can be snapped flush / aligned like two axis-aligned
// boxes. Items at 0 / 90 / 180 / 270 have φ = 0: their frame is the
// world, and everything behaves exactly as before free rotation.
// ─────────────────────────────────────────────────────────────
import type { Item, Rotation, Size3, Vec3 } from './types';

export type Axis3 = 'x' | 'y' | 'z';
type M3 = number[]; // row-major 3×3

const ANG: Rotation[] = [0, 90, 180, 270];
/** Angles closer than this (degrees) are considered equal. */
export const ANGLE_EPS = 0.01;

/** Angle in [0, 360), rounded to 1e-6° (so 359.9999999 → 0). */
export function normAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = ((a % 360) + 360) % 360;
  r = Math.round(r * 1e6) / 1e6;
  return r >= 360 ? 0 : r;
}

/** Signed smallest difference a − b in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normAngle(a) - normAngle(b);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Frame angle φ = rotation mod 90, in [0, 90) (values within ANGLE_EPS of 90 → 0). */
export function frameAngle(rotation: number): number {
  let f = normAngle(rotation) % 90;
  if (f > 90 - ANGLE_EPS) f = 0;
  if (f < ANGLE_EPS) f = 0;
  return f;
}

/** True when the angle is a multiple of 90° (axis-aligned item). */
export function isRightAngle(rotation: number): boolean {
  return frameAngle(rotation) === 0;
}

/** Two angles equal modulo 90° (their items share a frame: they can magnetise). */
export function sameFrame(a: number, b: number): boolean {
  const d = Math.abs(frameAngle(a) - frameAngle(b));
  return d < ANGLE_EPS || d > 90 - ANGLE_EPS;
}

/** cos / sin of an angle in degrees, exact for multiples of 90°. */
export function cosd(a: number): number {
  const r = normAngle(a);
  if (r === 0) return 1;
  if (r === 90 || r === 270) return 0;
  if (r === 180) return -1;
  return Math.cos((r * Math.PI) / 180);
}
export function sind(a: number): number {
  const r = normAngle(a);
  if (r === 0 || r === 180) return 0;
  if (r === 90) return 1;
  if (r === 270) return -1;
  return Math.sin((r * Math.PI) / 180);
}

function rx(a: number): M3 { const c = cosd(a), s = sind(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function ry(a: number): M3 { const c = cosd(a), s = sind(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rz(a: number): M3 { const c = cosd(a), s = sind(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mul(a: M3, b: M3): M3 {
  const o: M3 = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
const eq = (a: M3, b: M3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
function rotAbout(axis: Axis3, a: number): M3 { return axis === 'x' ? rx(a) : axis === 'y' ? ry(a) : rz(a); }
function apply(m: M3, v: Vec3): Vec3 {
  return { x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z };
}

export function eulerMatrix(x: number, y: number, z: number): M3 { return mul(rz(z), mul(ry(y), rx(x))); }

export function itemEuler(it: Item): { x: Rotation; y: Rotation; z: number } {
  return { x: it.tilt?.x ?? 0, y: it.tilt?.y ?? 0, z: normAngle(it.rotation) };
}
/** Local → world orientation matrix (row-major). */
export function itemMatrix(it: Item): M3 {
  const e = itemEuler(it);
  return eulerMatrix(e.x, e.y, e.z);
}
/**
 * Orientation of the item inside its own frame (core/obb.ts): the item matrix
 * without the frame angle φ — an integer matrix (entries −1, 0, 1).
 */
export function frameMatrix(it: Item): M3 {
  const e = itemEuler(it);
  return eulerMatrix(e.x, e.y, e.z - frameAngle(e.z));
}
export function isUpright(it: Item): boolean {
  return !(it.tilt?.x || it.tilt?.y);
}

/** Canonical Euler steps for an integer orientation matrix (prefers no tilt, then fewest steps). */
function eulerFrom(m: M3): { x: Rotation; y: Rotation; z: Rotation } {
  let best: { x: Rotation; y: Rotation; z: Rotation } | null = null, bestCost = Infinity;
  for (const x of ANG) for (const y of ANG) for (const z of ANG) {
    if (!eq(eulerMatrix(x, y, z), m)) continue;
    const cost = (x ? 10 : 0) + (y ? 10 : 0) + (x + y) / 90;
    if (cost < bestCost) { bestCost = cost; best = { x, y, z }; }
  }
  return best ?? { x: 0, y: 0, z: 0 };
}

/**
 * Orientation after rotating by `delta` about an axis.
 * - Z: any angle.
 * - X / Y (±90°): about the X / Y axes of the item's frame (the world axes
 *   turned by φ = rotation mod 90), so a turned item tilts "in place".
 */
export function rotatedOrientation(it: Item, axis: Axis3, delta: number): { rotation: number; tilt?: { x: Rotation; y: Rotation } } {
  if (axis === 'z') {
    return { rotation: normAngle(it.rotation + delta), tilt: it.tilt && (it.tilt.x || it.tilt.y) ? { ...it.tilt } : undefined };
  }
  const phi = frameAngle(it.rotation);
  const e = eulerFrom(mul(rotAbout(axis, delta), frameMatrix(it)));
  return { rotation: normAngle(e.z + phi), tilt: e.x || e.y ? { x: e.x, y: e.y } : undefined };
}

/**
 * Rotate a point (relative to a centre) by `delta` degrees about the Z axis,
 * or about the X / Y axis of the frame turned by `phi` about Z.
 */
export function rotateVec(v: Vec3, axis: Axis3, delta: number, phi = 0): Vec3 {
  if (axis === 'z') return apply(rz(delta), v);
  if (!phi) return apply(rotAbout(axis, delta), v);
  return apply(mul(rz(phi), mul(rotAbout(axis, delta), rz(-phi))), v);
}

function absSize(m: M3, local: Size3): Size3 {
  const v = [local.w, local.d, local.h];
  const r = [0, 1, 2].map(i => Math.abs(m[i * 3]) * v[0] + Math.abs(m[i * 3 + 1]) * v[1] + Math.abs(m[i * 3 + 2]) * v[2]);
  return { w: r[0], d: r[1], h: r[2] };
}

/** World AABB size of a local size under an orientation. */
export function orientSize(local: Size3, it: Pick<Item, 'rotation' | 'tilt'>): Size3 {
  return absSize(itemMatrix(it as Item), local);
}
/** Size of the item in its own frame (its oriented box: w along the frame X, d along the frame Y). */
export function orientFrameSize(local: Size3, it: Pick<Item, 'rotation' | 'tilt'>): Size3 {
  return absSize(frameMatrix(it as Item), local);
}

/** Rotate a local direction into world space. */
export function orientDir(it: Item, v: Vec3): Vec3 {
  return apply(itemMatrix(it), v);
}

/** "34,5°" / "90°" (current decimal separator supplied by the caller). */
export function fmtAngle(a: number, decimal = ','): string {
  const r = Math.round(normAngle(a) * 10) / 10;
  const v = r >= 360 ? 0 : r;
  return `${(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)).replace('.', decimal)}°`;
}

export function orientLabel(it: Item): string {
  const e = itemEuler(it);
  const parts = [];
  if (e.x) parts.push(`X ${e.x}°`);
  if (e.y) parts.push(`Y ${e.y}°`);
  parts.push(`Z ${fmtAngle(e.z)}`);
  return parts.join(' · ');
}
