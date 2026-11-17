// Openings (doors / windows) cut through walls.
//
// A wall is a zero-thickness plane: local XZ plane at y = 0, size w × h,
// oriented by the item's rotation / tilt. Its world normal is therefore one of
// the world axes, and its plane sits at the wall's position along that axis.
// Any visible item whose shape cuts walls (core/objects.ts → cutsWalls) and
// whose world AABB straddles or touches that plane (±TOL, a window is often
// placed flush against the wall face) is projected onto the wall's local
// (x, z): that rectangle, clipped to the wall, becomes a hole. Overlapping
// holes are merged (bounding rectangle).
import type { BlockItem, Item } from '../core/types';
import { itemBox, localSize, worldSize } from '../core/kallax';
import { itemMatrix } from '../core/orient';
import { cutsWalls } from '../core/objects';
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
  const ls = localSize(wall), ws = worldSize(wall), p = wall.position;
  const c = [p.x + ws.w / 2, p.y + ws.d / 2, p.z + ws.h / 2];
  const half = [ls.w / 2, ls.d / 2, ls.h / 2];
  // world axis of the wall normal (local +Y = column 1)
  const k = Math.abs(m[1]) ? 0 : Math.abs(m[4]) ? 1 : 2;
  const plane = c[k];
  const wb = itemBox(wall);
  const wmin = [wb.min.x, wb.min.y, wb.min.z], wmax = [wb.max.x, wb.max.y, wb.max.z];
  const holes: WallHole[] = [];
  for (const o of openings) {
    if (o.id === wall.id) continue;
    const b = itemBox(o);
    const bmin = [b.min.x, b.min.y, b.min.z], bmax = [b.max.x, b.max.y, b.max.z];
    if (bmin[k] - TOL > plane || bmax[k] + TOL < plane) continue;
    // quick reject in the wall plane
    let apart = false;
    for (let i = 0; i < 3; i++) if (i !== k && (bmin[i] >= wmax[i] || bmax[i] <= wmin[i])) apart = true;
    if (apart) continue;
    // world → local: l = Rᵀ (w − c) + half
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let n = 0; n < 8; n++) {
      const wx = (n & 1 ? bmax[0] : bmin[0]) - c[0];
      const wy = (n & 2 ? bmax[1] : bmin[1]) - c[1];
      const wz = (n & 4 ? bmax[2] : bmin[2]) - c[2];
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
