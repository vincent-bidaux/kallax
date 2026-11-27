// User commands shared by keyboard shortcuts, inspector and menus.
// Each command = at most one store.update() (one undo step).
import { store, uid } from '../core/store';
import type { Item, Settings, ViewPreset, Vec3 } from '../core/types';
import { rotateVec, rotatedOrientation, type Axis3 } from '../core/orient';
import { itemBox, unionBox, worldSize, boxesOverlap, collides } from '../core/kallax';
import { ui } from './context';
import { toast } from '../ui/dom';
import { t } from '../core/i18n';

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

/** Duplicate the selection flush against its group bbox along +X / +Y / +Z, skipping occupied slots. */
export function duplicate(axis: 'x' | 'y' | 'z' = 'x') {
  const sel = store.selectedItems();
  if (!sel.length) return;
  const u = unionBox(sel)!;
  const step = { x: u.max.x - u.min.x, y: u.max.y - u.min.y, z: u.max.z - u.min.z }[axis];
  // items with collisions off neither need a free slot nor block one
  const others = store.visibleItems().filter(collides).map(itemBox);
  const solid = sel.filter(collides);
  let k = 1;
  for (; k < 30 && solid.length; k++) {
    const off = step * k;
    const clash = solid.some(it => {
      const b = itemBox(it);
      b.min[axis] += off; b.max[axis] += off;
      return others.some(o => boxesOverlap(b, o));
    });
    if (!clash) break;
  }
  const off = step * k;
  const copies: Item[] = sel.map(it => {
    const c = structuredClone(it) as Item;
    c.id = uid();
    c.position = { ...c.position, [axis]: r3(c.position[axis] + off) };
    if (store.isLocked(c)) c.layerId = store.doc.activeLayerId;
    return c;
  });
  store.update(d => { d.items.push(...copies); });
  store.select(copies.map(c => c.id));
}

/** Rotate the editable selection by ±90° about a world axis through its group centre, then re-snap to the grid. */
export function rotateSelection(delta: 90 | -90, axis: Axis3 = 'z') {
  if (warnLocked()) return;
  const sel = editableSelection();
  if (!sel.length) return;
  const u = unionBox(sel)!;
  const C = { x: (u.min.x + u.max.x) / 2, y: (u.min.y + u.max.y) / 2, z: (u.min.z + u.max.z) / 2 };
  const next = sel.map(it => {
    const s = worldSize(it);
    const c = { x: it.position.x + s.w / 2 - C.x, y: it.position.y + s.d / 2 - C.y, z: it.position.z + s.h / 2 - C.z };
    const nc = rotateVec(c, axis, delta);
    const o = rotatedOrientation(it, axis, delta);
    const ns = worldSize({ ...it, rotation: o.rotation, tilt: o.tilt } as Item);
    return { id: it.id, o, pos: { x: C.x + nc.x - ns.w / 2, y: C.y + nc.y - ns.d / 2, z: C.z + nc.z - ns.h / 2 } };
  });
  // keep the group on/above the floor (X/Y rotations change heights): rest it where it was
  const minZ0 = u.min.z;
  const minZ1 = Math.min(...next.map(n => n.pos.z));
  const dz = axis === 'z' ? 0 : minZ0 - minZ1;
  // re-snap the group's min corner
  let dx = 0, dy = 0;
  if (store.settings.snapGrid) {
    const g = store.settings.gridCell;
    const mx = Math.min(...next.map(n => n.pos.x)), my = Math.min(...next.map(n => n.pos.y));
    dx = Math.round(mx / g) * g - mx; dy = Math.round(my / g) * g - my;
  }
  store.update(d => {
    for (const n of next) {
      const it = d.items.find(i => i.id === n.id);
      if (!it) continue;
      it.rotation = n.o.rotation;
      if (n.o.tilt) it.tilt = n.o.tilt; else delete it.tilt;
      it.position = { x: r3(n.pos.x + dx), y: r3(n.pos.y + dy), z: r3(Math.max(0, n.pos.z + dz)) };
    }
  });
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
