// Selection, hover and move gestures in the 3D viewport.
// Listeners run in the CAPTURE phase on the viewport container so they
// fire before OrbitControls (which then never sees a press on an item).
import type { ViewportAPI } from '../core/contracts';
import type { Item, Vec3 } from '../core/types';
import { store } from '../core/store';
import { ui } from './context';
import { computePlacement, itemsFree } from './placement';
import { toast } from '../ui/dom';
import { t } from '../core/i18n';
import { uid } from '../core/store';
import { copyGroups, addGroupNames } from './commands';

interface MoveGesture {
  pid: number;
  x0: number; y0: number;
  primary: Item;          // snapshot at pointerdown
  ids: string[];          // moved items (editable selection)
  orig: Map<string, Vec3>;
  grab: Vec3;
  moving: boolean;
  valid: boolean;
  /** Collapse a multi-selection to the clicked item if no drag happens. */
  collapseTo: string | null;
  /** ⌥-drag: move copies, leave the originals in place. */
  duplicate: boolean;
  /** Selection before the gesture (restored when a ⌥-drag copy is cancelled). */
  sel0: string[];
}

let cancelMove: (() => boolean) | null = null;
/** Cancel an in-progress move (Escape). Returns true when something was cancelled. */
export function cancelActiveMove(): boolean { return cancelMove ? cancelMove() : false; }

export function installSelectMove(vp: ViewportAPI) {
  const el = vp.container;
  const canvas = () => vp.getRenderer().domElement;
  let g: MoveGesture | null = null;
  let emptyDown: { pid: number; x0: number; y0: number; additive: boolean; maxD: number } | null = null;
  let hoverRaf = 0;
  let hoverEv: PointerEvent | null = null;
  let moveRaf = 0;
  let moveEv: PointerEvent | null = null;

  const setCursor = (c: string) => { canvas().style.cursor = c; };

  // ── pointerdown (capture) ──
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas()) return;
    if (e.button !== 0) return;
    const id = vp.pickItem(e.clientX, e.clientY);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!id) {
      emptyDown = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, additive, maxD: 0 };
      return; // let OrbitControls orbit
    }
    // Pressed an item: we own this gesture.
    e.stopPropagation();
    e.preventDefault();
    vp.setControlsEnabled(false);
    let collapseTo: string | null = null;
    if (additive) {
      store.toggleSelect(id);
    } else if (!store.selection.includes(id)) {
      store.select([id]);
    } else if (store.selection.length > 1) {
      collapseTo = id;
    }
    const item = store.getItem(id)!;
    const selected = store.selection.includes(id);
    const ids = selected ? store.selectedItems().filter(i => !store.isLocked(i)).map(i => i.id) : [];
    const canMove = selected && !store.isLocked(item) && ids.length > 0;

    const hit = vp.raycastSurface(e.clientX, e.clientY);
    const grab: Vec3 = hit && hit.itemId === id
      ? { x: hit.point.x - item.position.x, y: hit.point.y - item.position.y, z: Math.max(0, hit.point.z - item.position.z) }
      : { x: 0, y: 0, z: 0 };

    g = {
      pid: e.pointerId, x0: e.clientX, y0: e.clientY,
      primary: structuredClone(item), ids: canMove ? ids : [],
      orig: new Map(store.selectedItems().map(i => [i.id, { ...i.position }])),
      grab, moving: false, valid: true, collapseTo, duplicate: e.altKey, sel0: [...store.selection],
    };
    try { canvas().setPointerCapture(e.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onGestureMove, true);
    window.addEventListener('pointerup', onGestureUp, true);
    window.addEventListener('pointercancel', onGestureCancel, true);
    cancelMove = () => { if (!g) return false; endGesture(false); return true; };
  }, true);

  const applyMove = (ev: PointerEvent) => {
    if (!g) return;
    const res = computePlacement({ item: g.primary, clientX: ev.clientX, clientY: ev.clientY, ignoreIds: g.ids, grab: g.grab, keepHeight: g.orig.get(g.primary.id)?.z ?? g.primary.position.z });
    if (!res) return;
    // wall-hung item (frame, wall TV) moved onto another wall face: turned back to the wall
    let turn: number | undefined;
    if (res.rotation !== undefined && g.ids.length === 1) {
      turn = res.rotation;
      g.primary = { ...g.primary, rotation: res.rotation } as Item;
      if (res.grab) g.grab = res.grab;
    }
    const p0 = g.orig.get(g.primary.id)!;
    let d = { x: res.position.x - p0.x, y: res.position.y - p0.y, z: res.position.z - p0.z };
    // keep the whole group above the floor
    const minZ = Math.min(...g.ids.map(id => g!.orig.get(id)!.z));
    if (minZ + d.z < 0) d = { ...d, z: -minZ };
    const ids = new Set(g.ids);
    store.preview(doc => {
      for (const it of doc.items) if (ids.has(it.id)) {
        const o = g!.orig.get(it.id)!;
        it.position = { x: o.x + d.x, y: o.y + d.y, z: o.z + d.z };
        if (turn !== undefined) it.rotation = turn;
      }
    });
    const moved = store.items.filter(i => ids.has(i.id));
    g.valid = itemsFree(moved.map(item => ({ item })), g.ids);
    if (!g.valid) {
      const prim = store.getItem(g.primary.id);
      vp.setGhost(prim ? { item: prim, valid: false } : null);
    } else vp.setGhost(null);
    ui.setSnap(res.label);
    ui.setSnapMark(res.mark ?? null);
    ui.setGesture('move', g.valid);
    ui.setCursor(vp.rayToPlane(ev.clientX, ev.clientY, { x: 0, y: 0, z: 1 }, 0));
    vp.requestRender();
  };

  /** ⌥-drag: clone the moved items in place (same undo step) and drag the clones. */
  function startDuplicate() {
    if (!g) return;
    const map = new Map<string, string>();
    for (const id of g.ids) map.set(id, uid());
    const copies = store.items.filter(i => map.has(i.id)).map(i => ({ ...structuredClone(i), id: map.get(i.id)!, name: i.name }));
    const names = copyGroups(copies, g.ids);
    store.preview(doc => {
      doc.items.push(...copies);
      addGroupNames(doc, names);
    });
    const orig = new Map<string, Vec3>();
    for (const [from, to] of map) { const o = g.orig.get(from); if (o) orig.set(to, o); }
    g.orig = orig;
    g.ids = [...map.values()];
    g.primary = { ...g.primary, id: map.get(g.primary.id) ?? g.primary.id };
    store.select(g.ids, true);
    setCursor('copy');
  }

  function onGestureMove(ev: PointerEvent) {
    if (!g || ev.pointerId !== g.pid) return;
    ev.stopPropagation();
    if (!g.moving) {
      if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) <= 4 || !g.ids.length) return;
      g.moving = true;
      g.collapseTo = null;
      if (g.duplicate) startDuplicate();
      store.setHover(null);
      document.body.classList.add('moving');
      setCursor(g.duplicate ? 'copy' : 'grabbing');
      ui.setGesture('move');
    }
    moveEv = ev;
    if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = 0; if (moveEv) applyMove(moveEv); });
  }

  function endGesture(commit: boolean) {
    if (!g) return;
    const wasMoving = g.moving;
    cancelAnimationFrame(moveRaf); moveRaf = 0;
    if (wasMoving) {
      if (commit && g.valid) store.commit();
      else {
        store.cancelPreview();
        if (g.duplicate) store.select(g.sel0, true); // the copies are gone: back to the originals
        if (commit && !g.valid) toast(g.duplicate ? t('cmd.copyInvalid') : t('cmd.moveInvalid'));
      }
    } else if (commit && g.duplicate && g.primary.groupId && store.enteredGroup !== g.primary.groupId) {
      // ⌥-click (no drag) on a grouped item: enter its group, select that item alone
      store.enterGroup(g.primary.groupId, g.primary.id);
    } else if (commit && g.collapseTo) {
      store.select([g.collapseTo]);
    }
    try { canvas().releasePointerCapture(g.pid); } catch { /* ignore */ }
    g = null;
    cancelMove = null;
    window.removeEventListener('pointermove', onGestureMove, true);
    window.removeEventListener('pointerup', onGestureUp, true);
    window.removeEventListener('pointercancel', onGestureCancel, true);
    document.body.classList.remove('moving');
    vp.setGhost(null);
    vp.setControlsEnabled(true);
    setCursor('');
    ui.setSnap(null);
    ui.setSnapMark(null);
    ui.setGesture('none');
    vp.requestRender();
  }

  function onGestureUp(ev: PointerEvent) {
    if (!g || ev.pointerId !== g.pid) return;
    ev.stopPropagation();
    if (g.moving) applyMove(ev);
    endGesture(true);
  }
  function onGestureCancel(ev: PointerEvent) {
    if (!g || ev.pointerId !== g.pid) return;
    endGesture(false);
  }

  // ── double-click a grouped item: enter its group (edit one member) ──
  el.addEventListener('dblclick', (e) => {
    if (e.target !== canvas()) return;
    const id = vp.pickItem(e.clientX, e.clientY);
    const it = id ? store.getItem(id) : null;
    if (!it?.groupId || store.enteredGroup === it.groupId) return;
    e.stopPropagation();
    store.enterGroup(it.groupId, it.id);
  }, true);

  // ── empty-space click → clear selection (not after an orbit drag) ──
  window.addEventListener('pointermove', (e) => {
    if (emptyDown && e.pointerId === emptyDown.pid) {
      emptyDown.maxD = Math.max(emptyDown.maxD, Math.hypot(e.clientX - emptyDown.x0, e.clientY - emptyDown.y0));
    }
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (!emptyDown || e.pointerId !== emptyDown.pid) return;
    const d = emptyDown; emptyDown = null;
    if (d.maxD < 4 && !d.additive && store.selection.length) store.select([]);
  }, true);

  // ── hover + cursor coordinates ──
  el.addEventListener('pointermove', (e) => {
    if (g || ui.gesture !== 'none') return;
    if (ui.insertTool) { ui.setCursor(vp.rayToPlane(e.clientX, e.clientY, { x: 0, y: 0, z: 1 }, 0)); return; }
    if (e.target !== canvas()) { store.setHover(null); return; }
    hoverEv = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const ev = hoverEv; if (!ev) return;
      ui.setCursor(vp.rayToPlane(ev.clientX, ev.clientY, { x: 0, y: 0, z: 1 }, 0));
      if (ev.buttons !== 0) return; // orbiting
      const id = vp.pickItem(ev.clientX, ev.clientY);
      store.setHover(id);
      const it = id ? store.getItem(id) : null;
      if (ui.eyedropper) setCursor(it && !store.selection.includes(it.id) ? 'copy' : 'crosshair');
      else setCursor(it ? (store.isLocked(it) ? 'pointer' : 'grab') : '');
    });
  });
  el.addEventListener('pointerleave', () => {
    if (g) return;
    hoverEv = null;
    store.setHover(null);
    ui.setCursor(null);
  });
}
