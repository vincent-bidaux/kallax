// ─────────────────────────────────────────────────────────────
// Oriented boxes. An item turned by any angle θ about Z is, in its own
// frame (the world turned by φ = θ mod 90 — core/orient.ts frameAngle),
// an axis-aligned box: centre `c` (world), half sizes `h` along the frame
// axes, frame angle `a` = φ in degrees.
//
//   frame axes:  ex = ( cos φ, sin φ, 0 )   ey = ( −sin φ, cos φ, 0 )   ez = Z
//
// For φ = 0 the OBB is the item's world AABB: every computation below then
// reduces to the axis-aligned one used before free rotation.
// ─────────────────────────────────────────────────────────────
import type { Item, Vec3 } from './types';
import { cosd, frameAngle, sind, ANGLE_EPS } from './orient';
import { frameSize, worldSize, type Box3 } from './kallax';

export interface OBB {
  /** Centre (world). */
  c: Vec3;
  /** Half sizes along the frame axes (x, y) and Z. */
  h: Vec3;
  /** Frame angle φ ∈ [0, 90) in degrees. */
  a: number;
}

/** World → frame coordinates (rotation by −a about the world origin). */
export function toFrame(p: Vec3, a: number): Vec3 {
  if (!a) return { ...p };
  const c = cosd(a), s = sind(a);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c, z: p.z };
}
/** Frame → world coordinates. */
export function fromFrame(p: Vec3, a: number): Vec3 {
  if (!a) return { ...p };
  const c = cosd(a), s = sind(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}
export function frameAxes(a: number): { ex: Vec3; ey: Vec3 } {
  const c = cosd(a), s = sind(a);
  return { ex: { x: c, y: s, z: 0 }, ey: { x: -s, y: c, z: 0 } };
}

const sameA = (a: number, b: number) => { const d = Math.abs(a - b); return d < ANGLE_EPS || d > 90 - ANGLE_EPS; };

/** Oriented box of an item (at `pos`, its world AABB min corner — default: its position). */
export function itemOBB(it: Item, pos: Vec3 = it.position): OBB {
  const ws = worldSize(it), fs = frameSize(it);
  return {
    c: { x: pos.x + ws.w / 2, y: pos.y + ws.d / 2, z: pos.z + ws.h / 2 },
    h: { x: fs.w / 2, y: fs.d / 2, z: fs.h / 2 },
    a: frameAngle(it.rotation),
  };
}

/** OBB of a box given in frame `a` coordinates. */
export function obbFromFrameBox(b: Box3, a: number): OBB {
  const cf = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
  return { c: fromFrame(cf, a), h: { x: (b.max.x - b.min.x) / 2, y: (b.max.y - b.min.y) / 2, z: (b.max.z - b.min.z) / 2 }, a };
}

/** The 4 footprint corners (world x, y). */
export function obbCorners2D(o: OBB): Vec3[] {
  const { ex, ey } = frameAxes(o.a);
  const out: Vec3[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    out.push({ x: o.c.x + ex.x * o.h.x * sx + ey.x * o.h.y * sy, y: o.c.y + ex.y * o.h.x * sx + ey.y * o.h.y * sy, z: o.c.z });
  }
  return out;
}

/**
 * Box of an OBB in frame `a` coordinates: exact when the OBB shares the frame,
 * else the bounding box of its turned footprint.
 */
export function obbFrameBox(o: OBB, a: number = o.a): Box3 {
  if (sameA(o.a, a)) {
    const cf = toFrame(o.c, a);
    // OBBs within ANGLE_EPS of 90° apart swap their half sizes
    const swap = Math.abs(o.a - a) > 45;
    const hx = swap ? o.h.y : o.h.x, hy = swap ? o.h.x : o.h.y;
    return { min: { x: cf.x - hx, y: cf.y - hy, z: o.c.z - o.h.z }, max: { x: cf.x + hx, y: cf.y + hy, z: o.c.z + o.h.z } };
  }
  const cs = obbCorners2D(o).map(p => toFrame(p, a));
  return {
    min: { x: Math.min(...cs.map(p => p.x)), y: Math.min(...cs.map(p => p.y)), z: o.c.z - o.h.z },
    max: { x: Math.max(...cs.map(p => p.x)), y: Math.max(...cs.map(p => p.y)), z: o.c.z + o.h.z },
  };
}

/** Half extent of an OBB along a unit direction `n` (world). */
export function obbSupport(o: OBB, n: Vec3): number {
  const { ex, ey } = frameAxes(o.a);
  return o.h.x * Math.abs(n.x * ex.x + n.y * ex.y) + o.h.y * Math.abs(n.x * ey.x + n.y * ey.y) + o.h.z * Math.abs(n.z);
}

/** Footprint overlap (separating axis test on the 4 edge normals) by more than `eps`. */
export function obbFootprintOverlap(A: OBB, B: OBB, eps = 0.01): boolean {
  const dx = B.c.x - A.c.x, dy = B.c.y - A.c.y;
  const a = frameAxes(A.a), b = frameAxes(B.a);
  for (const u of [a.ex, a.ey, b.ex, b.ey]) {
    const rA = A.h.x * Math.abs(u.x * a.ex.x + u.y * a.ex.y) + A.h.y * Math.abs(u.x * a.ey.x + u.y * a.ey.y);
    const rB = B.h.x * Math.abs(u.x * b.ex.x + u.y * b.ex.y) + B.h.y * Math.abs(u.x * b.ey.x + u.y * b.ey.y);
    if (Math.abs(dx * u.x + dy * u.y) >= rA + rB - eps) return false;
  }
  return true;
}

/** Volume overlap by more than `eps` on every axis (touching boxes do not overlap). */
export function obbOverlap(A: OBB, B: OBB, eps = 0.01): boolean {
  if (Math.abs(B.c.z - A.c.z) >= A.h.z + B.h.z - eps) return false;
  return obbFootprintOverlap(A, B, eps);
}

export interface RayHit {
  /** Entry / exit distances along the (unit) ray. */
  t0: number;
  t1: number;
  /** Outward normal of the entry face (world). */
  n0: Vec3;
  /** Outward normal of the exit face (world). */
  n1: Vec3;
}

/** Ray (origin, unit direction) against an OBB: slab test in the box frame. */
export function rayOBB(o: Vec3, d: Vec3, B: OBB): RayHit | null {
  const lo = toFrame({ x: o.x - B.c.x, y: o.y - B.c.y, z: o.z - B.c.z }, B.a);
  const ld = toFrame(d, B.a);
  const P = [lo.x, lo.y, lo.z], D = [ld.x, ld.y, ld.z], H = [B.h.x, B.h.y, B.h.z];
  let t0 = -Infinity, t1 = Infinity, a0 = -1, a1 = -1, s0 = 0, s1 = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-12) {
      if (P[k] < -H[k] || P[k] > H[k]) return null;
      continue;
    }
    let ta = (-H[k] - P[k]) / D[k], tb = (H[k] - P[k]) / D[k];
    // entering through the −H face when D > 0
    let sa = -1, sb = 1;
    if (ta > tb) { [ta, tb] = [tb, ta]; sa = 1; sb = -1; }
    if (ta > t0) { t0 = ta; a0 = k; s0 = sa; }
    if (tb < t1) { t1 = tb; a1 = k; s1 = sb; }
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  const nrm = (k: number, s: number): Vec3 => {
    if (k < 0) return { x: 0, y: 0, z: 1 };
    const l = { x: k === 0 ? s : 0, y: k === 1 ? s : 0, z: k === 2 ? s : 0 };
    return fromFrame(l, B.a);
  };
  return { t0, t1, n0: nrm(a0, s0), n1: nrm(a1, s1) };
}
