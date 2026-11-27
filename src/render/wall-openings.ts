// Openings (doors / windows) cut through walls.
//
// A wall is a zero-thickness plane: local XZ plane at y = 0, size w × h,
// oriented by the item's rotation (any angle about Z) / tilt. Any visible
// item whose shape cuts walls (core/objects.ts → cutsWalls), whose angle
// equals the wall's modulo 90° (same frame, core/obb.ts — a window turned
// with its wall) and whose oriented box straddles or touches the wall plane
// (±TOL, a window is often placed flush against the wall face) is projected
// onto the wall's local (x, z): that rectangle, clipped to the wall, becomes
// a hole. Overlapping holes are merged (bounding rectangle).
import type { BlockItem, Item } from '../core/types';
import { localSize } from '../core/kallax';
import { itemMatrix, sameFrame } from '../core/orient';
import { cutsWalls } from '../core/objects';
import { frameAxes, itemOBB } from '../core/obb';
import type { WallHole } from './item-geometry';

const TOL = 0.5;      // cm: plane-contact tolerance
const MIN_SIDE = 0.1; // cm: ignore slivers
const r2 = (v: number) => Math.round(v * 100) / 100;

export function isOpening(it: Item): it is BlockItem {
  return it.kind === 'block' && cutsWalls(it.shape);
}

/** Holes of `wall` from the candidate `openings` (already filtered with isOpening). */
export function wallHoles(wall: BlockItem, openings: BlockItem[]): WallHole[] {
  if (!openings.length) return [];
  const m = itemMatrix(wall); // row-major, local → world
  const ls = localSize(wall);
  const wo = itemOBB(wall);
  const c = [wo.c.x, wo.c.y, wo.c.z];
  const half = [ls.w / 2, ls.d / 2, ls.h / 2];
  // wall normal (local +Y = column 1) and plane
  const n = [m[1], m[4], m[7]];
  const plane = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
  const holes: WallHole[] = [];
  for (const o of openings) {
    if (o.id === wall.id || !sameFrame(o.rotation, wall.rotation)) continue;
    const ob = itemOBB(o);
    const { ex, ey } = frameAxes(ob.a);
    // the 8 corners of the opening's oriented box
    const corners: number[][] = [];
    for (let k = 0; k < 8; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1;
      corners.push([
        ob.c.x + ex.x * ob.h.x * sx + ey.x * ob.h.y * sy,
        ob.c.y + ex.y * ob.h.x * sx + ey.y * ob.h.y * sy,
        ob.c.z + ob.h.z * sz,
      ]);
    }
    // straddles / touches the wall plane?
    const ds = corners.map(p => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - plane);
    if (Math.min(...ds) - TOL > 0 || Math.max(...ds) + TOL < 0) continue;
    // world → local: l = Rᵀ (w − c) + half
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of corners) {
      const wx = p[0] - c[0], wy = p[1] - c[1], wz = p[2] - c[2];
      const lx = m[0] * wx + m[3] * wy + m[6] * wz + half[0];
      const lz = m[2] * wx + m[5] * wy + m[8] * wz + half[2];
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx);
      z0 = Math.min(z0, lz); z1 = Math.max(z1, lz);
    }
    x0 = Math.max(0, x0); z0 = Math.max(0, z0);
    x1 = Math.min(ls.w, x1); z1 = Math.min(ls.h, z1);
    if (x1 - x0 < MIN_SIDE || z1 - z0 < MIN_SIDE) continue;
    holes.push([r2(x0), r2(z0), r2(x1), r2(z1)]);
  }
  // merge overlapping holes (bounding rectangle) until stable
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i], b = holes[j];
        if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) {
          holes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          holes.splice(j, 1);
          again = true;
          break outer;
        }
      }
    }
  }
  return holes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Holes for every wall among `items` (visible items), keyed by wall id. */
export function computeWallHoles(items: Item[]): Map<string, WallHole[]> {
  const out = new Map<string, WallHole[]>();
  const openings = items.filter(isOpening);
  if (!openings.length) return out;
  for (const it of items) {
    if (it.kind !== 'block' || it.shape !== 'wall') continue;
    const h = wallHoles(it, openings);
    if (h.length) out.set(it.id, h);
  }
  return out;
}
