// Placement algorithm shared by library drop and in-viewport move.
//  1. surface under the pointer (ground / top face / side face of an item)
//  2. grid snap of the free axes
//  3. magnetic snap to other items' faces (flush or aligned) — wins over grid
//  4. validity: no overlap of the oriented boxes (core/obb.ts) with other
//     visible items, z ≥ 0 — items whose "Collisions" switch is off neither
//     block nor are blocked (core/kallax collides)
import type { Item, Vec3 } from '../core/types';
import { collides, frameSize, itemBox, unionBox, worldSize, type Box3 } from '../core/kallax';
import { frameAxes, itemOBB, obbFrameBox, obbFromFrameBox, obbOverlap, obbSupport, fromFrame, toFrame, type OBB } from '../core/obb';
import { itemBaseZ, itemStandsOnFloor } from '../ui/object-labels';
import { isWallHung } from '../core/objects-params';
import { angleDiff, frameAngle, isRightAngle, isUpright, normAngle, orientDir, sameFrame } from '../core/orient';
import { store } from '../core/store';
import { ui } from './context';
import { fmtCm } from '../core/kallax';
import { t } from '../core/i18n';
import { cutsWalls, variantOf } from '../core/objects';

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
  /**
   * Wall-hung items (frames, wall TV) and openings (windows, doors) dropped on
   * a wall face are turned to face away from it: the new rotation about Z when it differs from the
   * item's, with the grab point to use from now on (callers apply both).
   */
  rotation?: number;
  grab?: Vec3;
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
 * resting plane above the item's base, and the side of the front strip that
 * may hang below it — `axis` is an axis of the item's frame (core/obb.ts;
 * the world axes for items at 0 / 90 / 180 / 270°). Null for every other
 * item (and tilted ones).
 */
export function hangOf(item: Item): { hang: number; depth: number; axis: 'x' | 'y'; side: -1 | 1 } | null {
  if (item.kind !== 'block' || !item.shape || (item.tilt && (item.tilt.x || item.tilt.y))) return null;
  const v = variantOf(item.shape, item.variant);
  if (!v?.hang) return null;
  const depth = v.hangDepth ?? 0;
  // local front (−Y) after the quarter turns within the frame (CCW): 0 → −Y, 90 → +X, 180 → +Y, 270 → −X
  const q = Math.round(normAngle(item.rotation - frameAngle(item.rotation)) / 90) % 4;
  switch (q) {
    case 1: return { hang: v.hang, depth, axis: 'x', side: 1 };
    case 2: return { hang: v.hang, depth, axis: 'y', side: 1 };
    case 3: return { hang: v.hang, depth, axis: 'x', side: -1 };
    default: return { hang: v.hang, depth, axis: 'y', side: -1 };
  }
}

/**
 * Oriented boxes used for collisions: the item box, or for hanging objects the
 * body above the resting plane + the front strip below it (so a trailing plant
 * can sit on a shelf with its stems falling in front of the shelf).
 */
export function collisionBoxes(item: Item, p: Vec3 = item.position): OBB[] {
  const o = itemOBB(item, p);
  const hg = hangOf(item);
  if (!hg) return [o];
  const b = obbFrameBox(o);
  const zr = b.min.z + hg.hang;
  const body: Box3 = { min: { ...b.min, z: zr }, max: { ...b.max } };
  const strip: Box3 = { min: { ...b.min }, max: { ...b.max, z: zr } };
  if (hg.side < 0) strip.max[hg.axis] = b.min[hg.axis] + hg.depth;
  else strip.min[hg.axis] = b.max[hg.axis] - hg.depth;
  return [obbFromFrameBox(body, o.a), obbFromFrameBox(strip, o.a)];
}

/**
 * Collision test of a set of oriented boxes against all other visible items
 * that collide (objects whose "Collisions" switch is off never block).
 */
export function boxesFree(boxes: OBB[], ignoreIds: string[]): boolean {
  const ign = new Set(ignoreIds);
  const others = store.visibleItems().filter(i => !ign.has(i.id) && collides(i)).flatMap(i => collisionBoxes(i));
  for (const b of boxes) {
    if (b.c.z - b.h.z < -0.01) return false;
    for (const o of others) if (obbOverlap(b, o)) return false;
  }
  return true;
}

/**
 * Placement validity of items at given positions. Items with collisions off
 * only have to stay above the floor; the others must not overlap any other
 * colliding visible item (`ignoreIds` = the moved items themselves).
 */
export function itemsFree(list: { item: Item; pos?: Vec3 }[], ignoreIds: string[]): boolean {
  const solid: OBB[] = [];
  for (const { item, pos } of list) {
    const bs = collisionBoxes(item, pos ?? item.position);
    if (collides(item)) solid.push(...bs);
    else if (bs.some(b => b.c.z - b.h.z < -0.01)) return false;
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
  if (hg && isRightAngle(item.rotation)) {
    const len = hg.axis === 'x' ? s.w : s.d;
    g[hg.axis] = hg.side < 0 ? (len + hg.depth) / 2 : (len - hg.depth) / 2;
  }
  return g;
}

/**
 * Rotation about Z that turns an item's front (local −Y) along a wall face's
 * outward normal, i.e. its back (local +Y) against the wall — any angle:
 * −Y → 0, +X → 90, +Y → 180, −X → 270.
 */
export function rotationFacing(n: Vec3): number {
  return normAngle((Math.atan2(n.x, -n.y) * 180) / Math.PI);
}

const dot2 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y;

/** The wall whose face a wall-hung item's back lies on (face normal `n` = the item's front), if any. */
function wallBehind(it: Item, n: Vec3, candidates: Item[]): Item | null {
  const o = itemOBB(it);
  const back = dot2(o.c, n) - obbSupport(o, n);
  const u = { x: -n.y, y: n.x, z: 0 };
  for (const w of candidates) {
    if (w.kind !== 'block' || w.shape !== 'wall') continue;
    const wn = orientDir(w, { x: 0, y: 1, z: 0 });
    if (Math.abs(dot2(wn, n)) < 0.999) continue;
    const wo = itemOBB(w);
    if (Math.abs(dot2(wo.c, n) - back) > 0.05) continue;
    if (Math.abs(dot2(wo.c, u) - dot2(o.c, u)) > obbSupport(wo, u) + obbSupport(o, u)) continue;
    if (wo.c.z + wo.h.z < o.c.z - o.h.z || wo.c.z - wo.h.z > o.c.z + o.h.z) continue;
    return w;
  }
  return null;
}

/**
 * Placement of one item under the pointer.
 *
 * Works in the item's FRAME (core/obb.ts): the world turned by φ = the item's
 * angle mod 90. There the item is an axis-aligned box, and so is every other
 * item sharing that frame (angle equal modulo 90°) — those are the only ones
 * it magnetises to (flush faces / aligned edges, exactly like axis-aligned
 * items always did). Items at other angles don't attract it; their faces
 * still stop it (oriented-box collisions) and it can rest on top of them.
 * Grid snap: the min corner of the oriented box, in the frame — the world
 * grid for items at 0 / 90 / 180 / 270°, the grid turned with the item for
 * the others (they move in grid steps along their own axes).
 */
export function computePlacement(o: PlaceOpts): PlaceResult | null {
  const vp = ui.viewport;
  const { clientX: cx, clientY: cy } = o;
  let item = o.item;
  const ignore = new Set(o.ignoreIds);
  const others = store.visibleItems().filter(i => !ignore.has(i.id));
  const settings = store.settings;

  const hit = vp.raycastSurface(cx, cy, o.ignoreIds);
  let hitItem = hit?.itemId ? store.getItem(hit.itemId) ?? null : null;
  // a wall-hung item over another one (frame over a frame): use the wall behind it
  if (hit && hitItem && isWallHung(item) && isWallHung(hitItem) && Math.abs(hit.normal.z) < 0.5) {
    const w = wallBehind(hitItem, hit.normal, others);
    if (w) {
      const wc = itemOBB(w).c, n = hit.normal;
      const d = (hit.point.x - wc.x) * n.x + (hit.point.y - wc.y) * n.y;
      hit.point = { x: hit.point.x - d * n.x, y: hit.point.y - d * n.y, z: hit.point.z };
      hitItem = w;
    }
  }

  // wall-hung items and openings (window, door) over a wall face (any angle): back to
  // the wall, i.e. turned like the wall (then they share its frame: magnets, holes)
  let turned: number | undefined;
  let grabIn = o.grab;
  const orients = isWallHung(item) || (item.kind === 'block' && cutsWalls(item.shape));
  if (hit && hitItem && hitItem.kind === 'block' && hitItem.shape === 'wall' && Math.abs(hit.normal.z) < 0.5 && orients && isUpright(item)) {
    const r = rotationFacing(hit.normal);
    if (Math.abs(angleDiff(r, item.rotation)) > 1e-6) {
      item = { ...item, rotation: r } as Item;
      turned = r;
      if (grabIn) { const s2 = worldSize(item); grabIn = { x: s2.w / 2, y: s2.d / 2, z: grabIn.z }; }
    }
  }
  const s = worldSize(item);
  const fs = frameSize(item);
  const phi = frameAngle(item.rotation);
  const grab = grabIn ?? defaultGrab(item, s);

  /** World centre of the footprint (x, y) and base height (z). */
  const C: Vec3 = { x: 0, y: 0, z: 0 };
  const locked: Record<Axis, boolean> = { x: false, y: false, z: true }; // frame axes
  /** Against a face at another angle: no grid snap (it would pull the item off the face). */
  let offFrameFace = false;
  const guides: SnapGuide[] = [];
  let surface: PlaceResult['surface'] = 'ground';

  const floating = (o.keepHeight ?? 0) > 0.01;
  if (!hit || !hitItem || hit.normal.z < -0.5) {
    // over the floor: new items land on it; floating items keep their height
    const baseZ = floating ? o.keepHeight! : 0;
    const p = vp.rayToPlane(cx, cy, { x: 0, y: 0, z: 1 }, baseZ + grab.z) ?? hit?.point;
    if (!p) return null;
    C.x = p.x - grab.x + s.w / 2; C.y = p.y - grab.y + s.d / 2; C.z = baseZ;
    if (floating) surface = 'air';
  } else {
    const hb = itemBox(hitItem);
    if (hit.normal.z > 0.5) {
      surface = 'top';
      // hanging objects rest their pot base on the surface, the stems fall below it
      C.z = hb.max.z - (hangOf(item)?.hang ?? 0);
      const p = vp.rayToPlane(cx, cy, { x: 0, y: 0, z: 1 }, hb.max.z + grab.z) ?? hit.point;
      C.x = p.x - grab.x + s.w / 2; C.y = p.y - grab.y + s.d / 2;
      guides.push({ axis: 'z', kind: 'top', targetId: hitItem.id, value: hb.max.z });
    } else {
      surface = 'side';
      C.z = hb.min.z;
      locked.z = false;
      // against a wall: hang the item where the pointer is (height follows the cursor)
      if (hitItem.kind === 'block' && hitItem.shape === 'wall' && itemStandsOnFloor(item)) {
        // doors, skirtings, beds… stand on the floor at the foot of the wall (not "hung")
        C.z = hb.min.z;
        locked.z = true;
      } else if (hitItem.kind === 'block' && hitItem.shape === 'wall') {
        surface = 'wall';
        const gz = o.grab ? grab.z : s.h / 2;
        let z = hit.point.z - gz;
        if (settings.snapGrid && settings.gridCell > 0) z = Math.round(z / settings.gridCell) * settings.gridCell;
        C.z = Math.max(0, Math.min(z, hb.max.z - s.h > 0 ? hb.max.z - s.h : z));
      }
      // flush against the face (any angle): push the item out along the face normal
      const n = { x: hit.normal.x, y: hit.normal.y, z: 0 };
      const nl = Math.hypot(n.x, n.y) || 1;
      n.x /= nl; n.y /= nl;
      C.x = hit.point.x - grab.x + s.w / 2; C.y = hit.point.y - grab.y + s.d / 2;
      const plane = dot2(hit.point, n);
      const ax = frameAxes(phi);
      const sup = fs.w / 2 * Math.abs(dot2(n, ax.ex)) + fs.d / 2 * Math.abs(dot2(n, ax.ey));
      const shift = plane + sup - dot2(C, n);
      C.x += shift * n.x; C.y += shift * n.y;
      if (sameFrame(phi, hitItem.rotation)) {
        const nf = toFrame(n, phi);
        const a: Axis = Math.abs(nf.x) > 0.5 ? 'x' : 'y';
        locked[a] = true;
        const ho = obbFrameBox(itemOBB(hitItem), phi);
        guides.push({ axis: a, kind: 'face', targetId: hitItem.id, value: (nf[a] > 0 ? ho.max : ho.min)[a] });
      } else offFrameFace = true;
    }
  }

  // catalogue base height on the floor: window sill ("allège") 90, radiator 15…
  // default base height (window sill, radiator) only for NEW items; moved items keep theirs
  if (item.kind === 'block' && surface === 'ground' && o.keepHeight === undefined) C.z += itemBaseZ(item);

  // ── reach guard: near the horizon (perspective / grazing views) the pointer ray
  // meets the floor hundreds of metres away. Refuse such positions instead of
  // flinging the item out of sight — the gesture keeps its last valid spot.
  const size: Record<Axis, number> = { x: fs.w, y: fs.d, z: fs.h };
  if (!isReasonable({ x: C.x - s.w / 2, y: C.y - s.d / 2, z: C.z }, { x: s.w, y: s.d, z: s.h }, others)) return null;

  // ── frame coordinates: min corner of the item's oriented box ──
  const Cf = toFrame(C, phi);
  const raw: Vec3 = { x: Cf.x - fs.w / 2, y: Cf.y - fs.d / 2, z: C.z };
  const pos: Vec3 = { ...raw };

  // ── grid snap (free horizontal axes) ──
  if (settings.snapGrid && settings.gridCell > 0 && !offFrameFace) {
    // in the item's frame: a turned item moves in grid steps along its own axes
    // (so sliding it along a turned wall never shifts it sideways)
    const g = settings.gridCell;
    for (const a of ['x', 'y'] as Axis[]) {
      if (locked[a]) continue;
      pos[a] = Math.round(raw[a] / g) * g;
    }
    guides.push({ axis: 'x', kind: 'grid', value: g });
  }

  // ── magnetic snap (wins over grid), with the items sharing the frame ──
  const mates = others.filter(it => sameFrame(phi, it.rotation));
  if (settings.snapItems && mates.length) {
    const thr = snapThreshold({ x: C.x - s.w / 2 + grab.x, y: C.y - s.d / 2 + grab.y, z: raw.z + grab.z });
    const boxes = mates.map(it => ({ id: it.id, b: obbFrameBox(itemOBB(it), phi) }));
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

  // back to the world: min corner of the item's AABB; tidy floating point
  const Cw = fromFrame({ x: pos.x + fs.w / 2, y: pos.y + fs.d / 2, z: pos.z }, phi);
  const out: Vec3 = { x: Cw.x - s.w / 2, y: Cw.y - s.d / 2, z: pos.z };
  if (!phi) { out.x = pos.x; out.y = pos.y; }
  for (const a of AXES) out[a] = Math.round(out[a] * 1000) / 1000;
  if (out.z < 0 && out.z > -0.01) out.z = 0;

  const valid = itemsFree([{ item, pos: out }], o.ignoreIds);
  return {
    position: out, valid, surface, guides,
    label: describeGuides(guides, surface, hitItem?.id ?? null),
    ...(turned !== undefined ? { rotation: turned, grab: grabIn } : {}),
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
