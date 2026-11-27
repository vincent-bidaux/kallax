// User commands shared by keyboard shortcuts, inspector and menus.
// Each command = at most one store.update() (one undo step).
import { store, uid } from '../core/store';
import type { Item, Rotation, Settings, ViewPreset, Vec3 } from '../core/types';
import { angleDiff, frameAngle, isRightAngle, rotateVec, rotatedOrientation, sameFrame, type Axis3 } from '../core/orient';
import { unionBox, worldSize, collides } from '../core/kallax';
import { fromFrame, itemOBB, obbFrameBox } from '../core/obb';
import { itemsFree } from './placement';
import { ui } from './context';
import { toast } from '../ui/dom';
import { t, tn } from '../core/i18n';
import { fullGroups, nextGroupName, regroupCopies } from '../core/groups';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Selected items that are editable (layer not locked). */
export function editableSelection(): Item[] {
  return store.selectedItems().filter(i => !store.isLocked(i));
}

function warnLocked(): boolean {
  if (store.selection.length && !editableSelection().length) {
    toast(t('cmd.locked'));
    return true;
  }
  return false;
}

export function deleteSelection() {
  if (warnLocked()) return;
  const ids = editableSelection().map(i => i.id);
  if (!ids.length) return;
  store.removeItems(ids);
  store.select([]);
}

export function selectAll() {
  store.select(store.visibleItems().map(i => i.id));
}

/**
 * Duplicate the selection flush against its group box along +X / +Y / +Z,
 * skipping occupied slots. A turned selection (all items at the same angle
 * modulo 90°) is duplicated along its own axes (the frame, core/obb.ts).
 */
export function duplicate(axis: 'x' | 'y' | 'z' = 'x') {
  const sel = store.selectedItems();
  if (!sel.length) return;
  const phi0 = frameAngle(sel[0].rotation);
  const phi = sel.every(i => sameFrame(i.rotation, phi0)) ? phi0 : 0;
  const boxes = sel.map(i => obbFrameBox(itemOBB(i), phi));
  const lo = Math.min(...boxes.map(b => b.min[axis])), hi = Math.max(...boxes.map(b => b.max[axis]));
  const step = hi - lo;
  const dir = axis === 'z' ? { x: 0, y: 0, z: 1 } : fromFrame(axis === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }, phi);
  const at = (it: Item, off: number): Vec3 => ({ x: r3(it.position.x + dir.x * off), y: r3(it.position.y + dir.y * off), z: r3(it.position.z + dir.z * off) });
  // items with collisions off neither need a free slot nor block one
  const solid = sel.filter(collides);
  let k = 1;
  for (; k < 30 && solid.length; k++) {
    if (itemsFree(solid.map(it => ({ item: it, pos: at(it, step * k) })), [])) break;
  }
  const off = step * k;
  const copies: Item[] = sel.map(it => {
    const c = structuredClone(it) as Item;
    c.id = uid();
    c.position = at(it, off);
    if (store.isLocked(c)) c.layerId = store.doc.activeLayerId;
    return c;
  });
  const names = copyGroups(copies, sel.map(i => i.id));
  store.update(d => { d.items.push(...copies); addGroupNames(d, names); });
  store.select(copies.map(c => c.id), true);
}

/**
 * Copies of whole selected groups become new groups (fresh groupIds, same
 * names); a member copied from inside an entered group stays in that group.
 * Returns the names of the new groups (to store in doc.groups).
 */
export function copyGroups(copies: Item[], sourceSelection: string[]): Record<string, { name: string }> {
  const whole = new Set(fullGroups(sourceSelection, store.visibleItems()));
  const names: Record<string, { name: string }> = {};
  const remap = copies.filter(c => c.groupId && whole.has(c.groupId));
  regroupCopies(remap, () => uid('grp'), store.doc, names);
  return names;
}
export function addGroupNames(d: import('../core/types').DesignDoc, names: Record<string, { name: string }>) {
  if (Object.keys(names).length) d.groups = { ...(d.groups ?? {}), ...names };
}

// ── groups ──
/** ⌘G: make one group of the selection (grouped items are merged into the new group). */
export function groupSelection() {
  if (warnLocked()) return;
  const sel = editableSelection();
  if (sel.length < 2) { toast(t('group.needTwo')); return; }
  const gid = uid('grp');
  const name = nextGroupName(store.doc);
  const ids = new Set(sel.map(i => i.id));
  store.update(d => {
    for (const it of d.items) if (ids.has(it.id)) it.groupId = gid;
    d.groups = { ...(d.groups ?? {}), [gid]: { name } };
  });
  store.enteredGroup = null;
  store.select([...ids], true);
  toast(tn('group.grouped', ids.size, { name }), 1600);
}

/** ⇧⌘G: dissolve every group touched by the selection (its items stay selected). */
export function ungroupSelection() {
  if (warnLocked()) return;
  const sel = editableSelection();
  const gids = new Set(sel.map(i => i.groupId).filter((g): g is string => !!g));
  if (!gids.size) { toast(t('group.noneSelected')); return; }
  const keep = [...store.selection];
  const members = store.items.filter(i => i.groupId && gids.has(i.groupId)).map(i => i.id);
  store.update(d => {
    for (const it of d.items) if (it.groupId && gids.has(it.groupId)) delete it.groupId;
    if (d.groups) for (const g of gids) delete d.groups[g];
  });
  store.enteredGroup = null;
  store.select([...new Set([...keep, ...members])], true);
  toast(gids.size > 1 ? t('group.ungroupedN', { n: gids.size }) : t('group.ungrouped'), 1400);
}

export function renameGroup(gid: string, name: string) {
  name = name.trim();
  if (!name || store.doc.groups?.[gid]?.name === name) return;
  store.update(d => { d.groups = { ...(d.groups ?? {}), [gid]: { name } }; });
}

// ── rotation ──
/** Default rotation step about Z (R / ⇧R, inspector −/+). */
export const ROT_STEP = 45;

/** Reference item of a selection for its angle (inspector, rotation handle): the first one in document order. */
export function rotationRef(items: Item[]): Item | null {
  if (!items.length) return null;
  const ids = new Set(items.map(i => i.id));
  return store.items.find(i => ids.has(i.id)) ?? items[0];
}

/**
 * Pivot of a rotation about Z: the centre of the items' common box in the
 * frame of the reference angle (core/obb.ts). It turns with the items, so a
 * rotation in several steps (45° + 45°, or a drag of the handle) ends where
 * one rotation of the total angle would: one item turns about its centre,
 * an axis-aligned group about the centre of its bounding box.
 */
export function rotationPivot(items: Item[], refAngle = rotationRef(items)?.rotation ?? 0): Vec3 {
  const phi = frameAngle(refAngle);
  const bs = items.map(i => obbFrameBox(itemOBB(i), phi));
  const c = {
    x: (Math.min(...bs.map(b => b.min.x)) + Math.max(...bs.map(b => b.max.x))) / 2,
    y: (Math.min(...bs.map(b => b.min.y)) + Math.max(...bs.map(b => b.max.y))) / 2,
    z: (Math.min(...bs.map(b => b.min.z)) + Math.max(...bs.map(b => b.max.z))) / 2,
  };
  return fromFrame(c, phi);
}

export interface RotatedState { id: string; rotation: number; tilt?: { x: Rotation; y: Rotation }; position: Vec3 }

/** New angles / positions of `items` turned by `delta` degrees about Z around `pivot` (no snapping). */
export function zRotationLayout(items: Item[], delta: number, pivot: Vec3): RotatedState[] {
  return items.map(it => {
    const c = itemOBB(it).c;
    const nc = rotateVec({ x: c.x - pivot.x, y: c.y - pivot.y, z: 0 }, 'z', delta);
    const o = rotatedOrientation(it, 'z', delta);
    const ns = worldSize({ ...it, rotation: o.rotation } as Item);
    return {
      id: it.id, rotation: o.rotation, tilt: o.tilt,
      position: { x: r3(pivot.x + nc.x - ns.w / 2), y: r3(pivot.y + nc.y - ns.d / 2), z: it.position.z },
    };
  });
}

/** Write rotated states into a draft document. */
export function applyRotated(d: import('../core/types').DesignDoc, next: RotatedState[]) {
  const byId = new Map(next.map(n => [n.id, n]));
  for (const it of d.items) {
    const n = byId.get(it.id);
    if (!n) continue;
    it.rotation = n.rotation;
    if (n.tilt) it.tilt = n.tilt; else delete it.tilt;
    it.position = { ...n.position };
  }
}

/**
 * Rotate the editable selection by `delta` degrees:
 * - about Z (any angle) around its pivot (rotationPivot); when the result is
 *   axis-aligned (0 / 90 / 180 / 270°) the group's min corner is re-snapped to
 *   the grid, as before free rotation;
 * - about X / Y (±90°): about the axes of the items' frame (they must share it).
 */
export function rotateSelection(delta: number, axis: Axis3 = 'z') {
  if (warnLocked()) return;
  const sel = editableSelection();
  if (!sel.length) return;
  if (axis === 'z') {
    const next = zRotationLayout(sel, delta, rotationPivot(sel));
    if (store.settings.snapGrid && next.every(n => isRightAngle(n.rotation))) {
      const g = store.settings.gridCell;
      const mx = Math.min(...next.map(n => n.position.x)), my = Math.min(...next.map(n => n.position.y));
      const dx = Math.round(mx / g) * g - mx, dy = Math.round(my / g) * g - my;
      for (const n of next) n.position = { x: r3(n.position.x + dx), y: r3(n.position.y + dy), z: n.position.z };
    }
    store.update(d => applyRotated(d, next));
    return;
  }
  const phi = frameAngle(sel[0].rotation);
  if (!sel.every(i => sameFrame(i.rotation, phi))) { toast(t('cmd.tiltMixed')); return; }
  const bs = sel.map(i => obbFrameBox(itemOBB(i), phi));
  const Cf = {
    x: (Math.min(...bs.map(b => b.min.x)) + Math.max(...bs.map(b => b.max.x))) / 2,
    y: (Math.min(...bs.map(b => b.min.y)) + Math.max(...bs.map(b => b.max.y))) / 2,
    z: (Math.min(...bs.map(b => b.min.z)) + Math.max(...bs.map(b => b.max.z))) / 2,
  };
  const C = fromFrame(Cf, phi);
  const next = sel.map(it => {
    const c0 = itemOBB(it).c;
    const nc = rotateVec({ x: c0.x - C.x, y: c0.y - C.y, z: c0.z - C.z }, axis, delta, phi);
    const o = rotatedOrientation(it, axis, delta);
    const ns = worldSize({ ...it, rotation: o.rotation, tilt: o.tilt } as Item);
    return { id: it.id, rotation: o.rotation, tilt: o.tilt, position: { x: C.x + nc.x - ns.w / 2, y: C.y + nc.y - ns.d / 2, z: C.z + nc.z - ns.h / 2 } };
  });
  // keep the group on/above the floor (X/Y rotations change heights): rest it where it was
  const minZ0 = Math.min(...sel.map(i => i.position.z));
  const dz = minZ0 - Math.min(...next.map(n => n.position.z));
  // re-snap the group's min corner (axis-aligned items)
  let dx = 0, dy = 0;
  if (store.settings.snapGrid && !phi) {
    const g = store.settings.gridCell;
    const mx = Math.min(...next.map(n => n.position.x)), my = Math.min(...next.map(n => n.position.y));
    dx = Math.round(mx / g) * g - mx; dy = Math.round(my / g) * g - my;
  }
  for (const n of next) n.position = { x: r3(n.position.x + dx), y: r3(n.position.y + dy), z: r3(Math.max(0, n.position.z + dz)) };
  store.update(d => applyRotated(d, next));
}

/** Turn the editable selection so that its reference item faces `angle` (one undo step). */
export function rotateSelectionTo(angle: number) {
  if (warnLocked()) return;
  const sel = editableSelection();
  const ref = rotationRef(sel);
  if (!ref) return;
  const delta = angleDiff(angle, ref.rotation);
  if (Math.abs(delta) < 1e-6) return;
  const next = zRotationLayout(sel, delta, rotationPivot(sel));
  store.update(d => applyRotated(d, next));
}

export function nudge(dx: number, dy: number, dz: number) {
  if (warnLocked()) return;
  const sel = editableSelection();
  if (!sel.length) return;
  const minZ = Math.min(...sel.map(i => i.position.z));
  if (minZ + dz < 0) dz = -minZ;
  if (!dx && !dy && !dz) return;
  const ids = new Set(sel.map(i => i.id));
  store.update(d => {
    for (const it of d.items) if (ids.has(it.id)) {
      it.position = { x: r3(it.position.x + dx), y: r3(it.position.y + dy), z: r3(it.position.z + dz) };
    }
  });
}

export function moveItemTo(id: string, pos: Partial<Vec3>) {
  store.update(d => {
    const it = d.items.find(i => i.id === id);
    if (it) it.position = { ...it.position, ...pos, z: Math.max(0, pos.z ?? it.position.z) };
  });
}

export function align(axis: 'x' | 'y' | 'z') {
  const sel = editableSelection();
  if (sel.length < 2) return;
  const u = unionBox(sel)!;
  const ids = new Set(sel.map(i => i.id));
  store.update(d => {
    for (const it of d.items) if (ids.has(it.id)) it.position = { ...it.position, [axis]: u.min[axis] };
  });
}

// ── view / settings ──
export function setView(v: ViewPreset) {
  const vp = ui.viewport;
  if (v === 'free') { if (store.settings.view !== 'free') store.setSettings({ view: 'free' }); return; }
  // The viewport keeps store.settings.view in sync itself.
  vp.setView(v, true);
}

export function setProjection(p: Settings['projection']) {
  if (store.settings.view === 'cavalier') return;
  ui.viewport.setProjection(p);
}

export function toggleProjection() {
  if (store.settings.view === 'cavalier') { toast(t('cmd.cavalierOrtho')); return; }
  const p = store.settings.projection === 'perspective' ? 'orthographic' : 'perspective';
  setProjection(p);
  toast(p === 'perspective' ? t('cmd.projPersp') : t('cmd.projOrtho'), 1400);
}

export function toggleSetting(k: 'measureItems' | 'measureGlobal' | 'showGrid' | 'showAxes' | 'snapGrid' | 'snapItems' | 'shadows' | 'transparency') {
  store.setSettings({ [k]: !store.settings[k] } as Partial<Settings>);
}

export function zoomToFit() { ui.viewport.zoomToFit(true); }
