// Placement algorithm shared by library drop and in-viewport move.
//  1. surface under the pointer (ground / top face / side face of an item)
//  2. grid snap of the free axes
//  3. magnetic snap to other items' faces (flush or aligned) — wins over grid
//  4. validity: no AABB overlap with other visible items, z ≥ 0 — items whose
//     "Collisions" switch is off neither block nor are blocked (core/kallax collides)
import type { Item, Vec3 } from '../core/types';
import { boxesOverlap, collides, itemBox, unionBox, worldSize, type Box3 } from '../core/kallax';
import { baseZOf, standsOnFloor } from '../ui/object-labels';
import { store } from '../core/store';
import { ui } from './context';
import { fmtCm } from '../core/kallax';
import { t } from '../core/i18n';
import { variantOf } from '../core/objects';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];
const SIZE_KEY = { x: 'w', y: 'd', z: 'h' } as const;

export interface SnapGuide {
  axis: Axis;
  kind: 'flush' | 'align' | 'grid' | 'top' | 'face';
  targetId?: string;
  /** World coordinate of the snapped plane. */
  value: number;
}

export interface PlaceResult {
  position: Vec3;
  valid: boolean;
  surface: 'ground' | 'top' | 'side' | 'wall' | 'air';
  guides: SnapGuide[];
  /** Short description for the status bar (current UI language). */
  label: string | null;
}

export interface PlaceOpts {
  item: Item;
  clientX: number;
  clientY: number;
  /** Items excluded from hit-testing, snapping and collision (the moved items themselves). */
  ignoreIds: string[];
  /** Grabbed point relative to the item's min corner (cm). Default: centre of footprint, at the bottom. */
  grab?: Vec3;
  /** Moving an existing item: its current base height. Over the floor it keeps that height (wall-hung items stay up). */
  keepHeight?: number;
}

/** Snap threshold in cm ≈ 12 screen px at the given world point, clamped 2–20 cm. */
export function snapThreshold(at: Vec3): number {
  const vp = ui.viewport;
  const a = vp.worldToScreen(at);
  const bx = vp.worldToScreen({ x: at.x + 10, y: at.y, z: at.z });
  const by = vp.worldToScreen({ x: at.x, y: at.y + 10, z: at.z });
  const bz = vp.worldToScreen({ x: at.x, y: at.y, z: at.z + 10 });
  const d = Math.max(
    Math.hypot(bx.x - a.x, bx.y - a.y),
    Math.hypot(by.x - a.x, by.y - a.y),
    Math.hypot(bz.x - a.x, bz.y - a.y),
  ) / 10;
  if (!Number.isFinite(d) || d <= 0) return 6;
  return Math.min(20, Math.max(2, 12 / d));
}

function itemName(id: string | undefined): string {
  if (!id) return '';
  return store.getItem(id)?.name ?? '';
}

const AXIS_LABEL: Record<Axis, string> = { x: 'X', y: 'Y', z: 'Z' };

export function describeGuides(guides: SnapGuide[], surface: PlaceResult['surface'], hitId: string | null): string | null {
  const parts: string[] = [];
  if (surface === 'top' && hitId) parts.push(t('snap.onTop', { name: itemName(hitId) }));
  if (surface === 'wall' && hitId) parts.push(t('snap.onWall', { name: itemName(hitId) }));
  if (surface === 'air') parts.push(t('snap.keepHeight'));
  for (const g of guides) {
    if (g.kind === 'face' && g.targetId) parts.push(t('snap.face', { name: itemName(g.targetId), axis: AXIS_LABEL[g.axis] }));
    else if (g.kind === 'flush' && g.targetId) parts.push(t('snap.flush', { name: itemName(g.targetId), axis: AXIS_LABEL[g.axis] }));
    else if (g.kind === 'align' && g.targetId) parts.push(t('snap.align', { name: itemName(g.targetId), axis: AXIS_LABEL[g.axis] }));
  }
  if (!parts.length && guides.some(g => g.kind === 'grid')) parts.push(t('snap.grid', { cm: fmtCm(store.settings.gridCell) }));
  return parts.length ? parts.join('  ·  ') : null;
}

function boxAt(item: Item, p: Vec3): Box3 {
  const s = worldSize(item);
  return { min: { ...p }, max: { x: p.x + s.w, y: p.y + s.d, z: p.z + s.h } };
}

/**
 * Hanging objects (trailing plants, see ObjectVariant.hang): height of the
 * resting plane above the item's base, and the world side of the front strip
 * that may hang below it. Null for every other item (and tilted ones).
 */
export function hangOf(item: Item): { hang: number; depth: number; axis: 'x' | 'y'; side: -1 | 1 } | null {
  if (item.kind !== 'block' || !item.shape || (item.tilt && (item.tilt.x || item.tilt.y))) return null;
  const v = variantOf(item.shape, item.variant);
  if (!v?.hang) return null;
  const depth = v.hangDepth ?? 0;
  // local front (−Y) after the rotation about Z (CCW): 0 → −Y, 90 → +X, 180 → +Y, 270 → −X
  switch (item.rotation) {
    case 90: return { hang: v.hang, depth, axis: 'x', side: 1 };
    case 180: return { hang: v.hang, depth, axis: 'y', side: 1 };
    case 270: return { hang: v.hang, depth, axis: 'x', side: -1 };
    default: return { hang: v.hang, depth, axis: 'y', side: -1 };
  }
}

/**
 * Boxes used for collisions: the item box, or for hanging objects the body
 * above the resting plane + the front strip below it (so a trailing plant can
 * sit on a shelf with its stems falling in front of the shelf).
 */
export function collisionBoxes(item: Item, p: Vec3 = item.position): Box3[] {
  const b = boxAt(item, p);
  const hg = hangOf(item);
  if (!hg) return [b];
  const zr = b.min.z + hg.hang;
  const body: Box3 = { min: { ...b.min, z: zr }, max: { ...b.max } };
  const strip: Box3 = { min: { ...b.min }, max: { ...b.max, z: zr } };
  if (hg.side < 0) strip.max[hg.axis] = b.min[hg.axis] + hg.depth;
  else strip.min[hg.axis] = b.max[hg.axis] - hg.depth;
  return [body, strip];
}

/**
 * Collision test of a set of boxes against all other visible items that
 * collide (objects whose "Collisions" switch is off never block).
 */
export function boxesFree(boxes: Box3[], ignoreIds: string[]): boolean {
  const ign = new Set(ignoreIds);
  const others = store.visibleItems().filter(i => !ign.has(i.id) && collides(i)).flatMap(i => collisionBoxes(i));
  for (const b of boxes) {
    if (b.min.z < -0.01) return false;
    for (const o of others) if (boxesOverlap(b, o)) return false;
  }
  return true;
}

/**
 * Placement validity of items at given positions. Items with collisions off
 * only have to stay above the floor; the others must not overlap any other
 * colliding visible item (`ignoreIds` = the moved items themselves).
 */
export function itemsFree(list: { item: Item; pos?: Vec3 }[], ignoreIds: string[]): boolean {
  const solid: Box3[] = [];
  for (const { item, pos } of list) {
    const bs = collisionBoxes(item, pos ?? item.position);
    if (collides(item)) solid.push(...bs);
    else if (bs.some(b => b.min.z < -0.01)) return false;
  }
  return boxesFree(solid, ignoreIds);
}

/** Max distance (cm) an item may be placed from the composition (or the origin). */
const REACH_MARGIN = 800;
const REACH_MIN = 1500;

function isReasonable(pos: Vec3, size: Record<Axis, number>, others: Item[]): boolean {
  if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return false;
  const c = { x: pos.x + size.x / 2, y: pos.y + size.y / 2 };
  let cx = 0, cy = 0, radius = 0;
  if (others.length) {
    const u = unionBox(others)!;
    cx = (u.min.x + u.max.x) / 2; cy = (u.min.y + u.max.y) / 2;
    radius = Math.hypot(u.max.x - u.min.x, u.max.y - u.min.y) / 2;
  }
  return Math.hypot(c.x - cx, c.y - cy) <= Math.max(REACH_MIN, radius + REACH_MARGIN);
}

/** Default grab point: centre of the footprint — for hanging objects, of the body (the pot), not of the hanging strip. */
function defaultGrab(item: Item, s: { w: number; d: number }): Vec3 {
  const g = { x: s.w / 2, y: s.d / 2, z: 0 };
  const hg = hangOf(item);
  if (hg) {
    const len = hg.axis === 'x' ? s.w : s.d;
    g[hg.axis] = hg.side < 0 ? (len + hg.depth) / 2 : (len - hg.depth) / 2;
  }
  return g;
}

export function computePlacement(o: PlaceOpts): PlaceResult | null {
  const vp = ui.viewport;
  const { item, clientX: cx, clientY: cy } = o;
  const s = worldSize(item);
  const size: Record<Axis, number> = { x: s.w, y: s.d, z: s.h };
  const grab = o.grab ?? defaultGrab(item, s);
  const ignore = new Set(o.ignoreIds);
  const others = store.visibleItems().filter(i => !ignore.has(i.id));
  const settings = store.settings;

  const hit = vp.raycastSurface(cx, cy, o.ignoreIds);
  const hitItem = hit?.itemId ? store.getItem(hit.itemId) ?? null : null;

  const pos: Vec3 = { x: 0, y: 0, z: 0 };
  const locked: Record<Axis, boolean> = { x: false, y: false, z: true };
  const guides: SnapGuide[] = [];
  let surface: PlaceResult['surface'] = 'ground';

  const floating = (o.keepHeight ?? 0) > 0.01;
  if (!hit || !hitItem || hit.normal.z < -0.5) {
    // over the floor: new items land on it; floating items keep their height
    const baseZ = floating ? o.keepHeight! : 0;
    const p = vp.rayToPlane(cx, cy, { x: 0, y: 0, z: 1 }, baseZ + grab.z) ?? hit?.point;
    if (!p) return null;
    pos.x = p.x - grab.x; pos.y = p.y - grab.y; pos.z = baseZ;
    if (floating) surface = 'air';
  } else {
    const hb = itemBox(hitItem);
    if (hit.normal.z > 0.5) {
      surface = 'top';
      // hanging objects rest their pot base on the surface, the stems fall below it
      pos.z = hb.max.z - (hangOf(item)?.hang ?? 0);
      const p = vp.rayToPlane(cx, cy, { x: 0, y: 0, z: 1 }, hb.max.z + grab.z) ?? hit.point;
      pos.x = p.x - grab.x; pos.y = p.y - grab.y;
      guides.push({ axis: 'z', kind: 'top', targetId: hitItem.id, value: hb.max.z });
    } else {
      surface = 'side';
      pos.z = hb.min.z;
      locked.z = false;
      // against a wall: hang the item where the pointer is (height follows the cursor)
      if (hitItem.kind === 'block' && hitItem.shape === 'wall' && item.kind === 'block' && standsOnFloor(item.shape)) {
        // doors, skirtings, beds… stand on the floor at the foot of the wall (not "hung")
        pos.z = hb.min.z;
        locked.z = true;
      } else if (hitItem.kind === 'block' && hitItem.shape === 'wall') {
        surface = 'wall';
        const gz = o.grab ? grab.z : s.h / 2;
        let z = hit.point.z - gz;
        if (settings.snapGrid && settings.gridCell > 0) z = Math.round(z / settings.gridCell) * settings.gridCell;
        pos.z = Math.max(0, Math.min(z, hb.max.z - s.h > 0 ? hb.max.z - s.h : z));
      }
      pos.x = hit.point.x - grab.x; pos.y = hit.point.y - grab.y;
      if (Math.abs(hit.normal.x) > 0.5) {
        pos.x = hit.normal.x > 0 ? hb.max.x : hb.min.x - s.w;
        locked.x = true;
        guides.push({ axis: 'x', kind: 'face', targetId: hitItem.id, value: hit.normal.x > 0 ? hb.max.x : hb.min.x });
      } else {
        pos.y = hit.normal.y > 0 ? hb.max.y : hb.min.y - s.d;
        locked.y = true;
        guides.push({ axis: 'y', kind: 'face', targetId: hitItem.id, value: hit.normal.y > 0 ? hb.max.y : hb.min.y });
      }
    }
  }

  // catalogue base height on the floor: window sill ("allège") 90, radiator 15…
  // default base height (window sill, radiator) only for NEW items; moved items keep theirs
  if (item.kind === 'block' && surface === 'ground' && o.keepHeight === undefined) pos.z += baseZOf(item.shape);

  // ── reach guard: near the horizon (perspective / grazing views) the pointer ray
  // meets the floor hundreds of metres away. Refuse such positions instead of
  // flinging the item out of sight — the gesture keeps its last valid spot.
  if (!isReasonable(pos, size, others)) return null;

  const raw: Vec3 = { ...pos };

  // ── grid snap (free horizontal axes) ──
  if (settings.snapGrid && settings.gridCell > 0) {
    const g = settings.gridCell;
    for (const a of ['x', 'y'] as Axis[]) {
      if (locked[a]) continue;
      pos[a] = Math.round(raw[a] / g) * g;
    }
    guides.push({ axis: 'x', kind: 'grid', value: g });
  }

  // ── magnetic snap (wins over grid) ──
  if (settings.snapItems && others.length) {
    const thr = snapThreshold({ x: raw.x + grab.x, y: raw.y + grab.y, z: raw.z + grab.z });
    const boxes = others.map(it => ({ id: it.id, b: itemBox(it) }));
    const hg = hangOf(item);
    for (const a of AXES) {
      if (locked[a]) continue;
      const gMin = raw[a], gMax = raw[a] + size[a];
      let best: { d: number; kind: 'flush' | 'align'; id: string; value: number } | null = null;
      for (const { id, b } of boxes) {
        // Only consider neighbours: ranges on the two other axes must overlap (within threshold).
        let near = true;
        for (const k of AXES) {
          if (k === a) continue;
          const lo = (k === a ? raw[k] : pos[k]), hi = lo + size[k];
          if (hi < b.min[k] - thr || lo > b.max[k] + thr) { near = false; break; }
        }
        if (!near) continue;
        const cands: [number, 'flush' | 'align', number][] = [
          [b.max[a] - gMin, 'flush', b.max[a]],
          [b.min[a] - gMax, 'flush', b.min[a]],
          [b.min[a] - gMin, 'align', b.min[a]],
          [b.max[a] - gMax, 'align', b.max[a]],
        ];
        // hanging objects: the pot front (strip boundary) aligns with the shelf edge, instead
        // of the box front (which would put the hanging stems inside the shelf)
        if (hg && hg.axis === a) cands[hg.side < 0 ? 2 : 3] = hg.side < 0
          ? [b.min[a] - (gMin + hg.depth), 'align', b.min[a]]
          : [b.max[a] - (gMax - hg.depth), 'align', b.max[a]];
        for (const [d, kind, value] of cands) {
          if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d) - 1e-6)) best = { d, kind, id, value };
        }
      }
      if (best) {
        pos[a] = raw[a] + best.d;
        guides.push({ axis: a, kind: best.kind, targetId: best.id, value: best.value });
      }
    }
  }

  // tidy floating point
  for (const a of AXES) pos[a] = Math.round(pos[a] * 1000) / 1000;
  if (pos.z < 0 && pos.z > -0.01) pos.z = 0;

  const valid = itemsFree([{ item, pos }], o.ignoreIds);
  return {
    position: pos, valid, surface, guides,
    label: describeGuides(guides, surface, hitItem?.id ?? null),
  };
}

/** A free spot to drop an item when clicking a library tile: right of the composition, on the floor. */
export function freeSpot(item: Item): Vec3 {
  const vis = store.visibleItems();
  const u = unionBox(vis);
  if (!u) return { x: 0, y: 0, z: 0 };
  let p: Vec3 = { x: u.max.x, y: u.min.y, z: 0 };
  for (let i = 0; i < 40 && !itemsFree([{ item, pos: p }], []); i++) p = { ...p, x: p.x + 5 };
  return p;
}

export { boxAt };
