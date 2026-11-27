// Pointer-based drag from a library tile into the viewport (no HTML5 DnD).
import type { Item, Vec3 } from '../core/types';
import { store } from '../core/store';
import { ui } from './context';
import { computePlacement, freeSpot, itemsFree, type PlaceResult } from './placement';
import { h, toast } from '../ui/dom';
import { t, DECIMAL } from '../core/i18n';
import { worldSize } from '../core/kallax';

/** True when (x, y) is over the 3D canvas itself (not over an overlay widget such as the ViewCube). */
export function overCanvas(x: number, y: number): boolean {
  const vp = ui.viewport;
  const canvas = vp.getRenderer().domElement;
  const r = vp.container.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  if (el === canvas) return true;
  if (!vp.container.contains(el)) return false;
  return !el.closest('button, a, input, select, [role=button], [data-ui-overlay], .kd-cube, .vp-pill, .vp-empty');
}

let active: (() => void) | null = null;
export function cancelActiveDrag(): boolean {
  if (!active) return false;
  active();
  return true;
}

/**
 * Begin tracking a potential drag from `source`. `make` builds a fresh item (position ignored).
 * A click without movement inserts the item at a free spot next to the composition.
 */
export function beginLibraryDrag(e: PointerEvent, source: HTMLElement, make: () => Item, label: string) {
  beginDrag(e, source, {
    make, label,
    drop: (it) => store.addItem(it),
    click: () => {
      const it = make();
      it.layerId = store.doc.activeLayerId;
      it.position = freeSpot(it);
      store.addItem(it);
      ui.viewport.zoomToFit(true);
    },
  });
}

/**
 * Drag several items as one (a component): `proxy` is a box the size of their
 * union, used for snapping / surfaces; `expand(pos)` gives the real items with
 * their union min corner at `pos` (ghost + collision test); `drop(pos)` inserts them.
 */
export function beginMultiDrag(e: PointerEvent, source: HTMLElement, o: {
  proxy: () => Item; expand: (pos: Vec3) => Item[]; label: string; drop: (pos: Vec3) => void; click: () => void;
}) {
  beginDrag(e, source, { make: o.proxy, label: o.label, expand: o.expand, drop: it => o.drop(it.position), click: o.click });
}

interface DragSpec {
  make: () => Item;
  label: string;
  expand?: (pos: Vec3) => Item[];
  drop: (placed: Item) => void;
  click: () => void;
}

function beginDrag(e: PointerEvent, source: HTMLElement, spec: DragSpec) {
  const { make, label } = spec;
  if (e.button !== 0) return;
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY;
  const pid = e.pointerId;
  let dragging = false;
  let item: Item | null = null;
  let last: PlaceResult | null = null;
  let lastOver = false;
  let chip: HTMLElement | null = null;
  let raf = 0;
  let pending: PointerEvent | null = null;

  try { source.setPointerCapture(pid); } catch { /* ignore */ }

  const startDrag = () => {
    dragging = true;
    item = make();
    item.layerId = store.doc.activeLayerId;
    const s = worldSize(item);
    chip = h('div', { class: 'drag-chip', 'aria-hidden': 'true' },
      h('span', { class: 'drag-chip-name' }, label),
      h('span', { class: 'drag-chip-dims' }, `${fmt(s.w)} × ${fmt(s.d)} × ${fmt(s.h)} cm`));
    document.body.appendChild(chip);
    document.body.classList.add('dragging');
    source.classList.add('drag-source');
    ui.setGesture('place');
    store.setHover(null);
  };

  const update = (ev: PointerEvent) => {
    if (!item || !chip) return;
    chip.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
    const over = overCanvas(ev.clientX, ev.clientY);
    lastOver = over;
    chip.classList.toggle('over-canvas', over);
    if (!over) {
      last = null;
      ui.viewport.setGhost(null);
      ui.setSnap(null);
      ui.setGesture('place', true);
      return;
    }
    const res = computePlacement({ item, clientX: ev.clientX, clientY: ev.clientY, ignoreIds: [] });
    // Out-of-reach pointer (near the horizon…): keep the last valid ghost.
    if (!res && last) return;
    if (res && spec.expand) {
      // several items: the real items decide validity (the union box is only for placement)
      const all = spec.expand(res.position);
      res.valid = itemsFree(all.map(it => ({ item: it })), []);
      last = res;
      item.position = res.position;
      ui.viewport.setGhost({ item: all[0], valid: res.valid, items: all });
      ui.setSnap(res.label);
      ui.setGesture('place', res.valid);
      ui.setCursor(ui.viewport.rayToPlane(ev.clientX, ev.clientY, { x: 0, y: 0, z: 1 }, 0));
      ui.viewport.requestRender();
      return;
    }
    last = res;
    if (res) {
      item.position = res.position;
      ui.viewport.setGhost({ item: { ...item, position: { ...res.position } } as Item, valid: res.valid });
      ui.setSnap(res.label);
      ui.setGesture('place', res.valid);
      const g = ui.viewport.rayToPlane(ev.clientX, ev.clientY, { x: 0, y: 0, z: 1 }, 0);
      ui.setCursor(g);
    } else {
      ui.viewport.setGhost(null);
    }
    ui.viewport.requestRender();
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 3) startDrag();
    if (!dragging) return;
    pending = ev;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) update(pending); });
  };

  const cleanup = () => {
    source.removeEventListener('pointermove', onMove);
    source.removeEventListener('pointerup', onUp);
    source.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    try { source.releasePointerCapture(pid); } catch { /* ignore */ }
    chip?.remove();
    document.body.classList.remove('dragging');
    source.classList.remove('drag-source');
    if (dragging) { ui.viewport.setGhost(null); ui.viewport.requestRender(); }
    ui.setSnap(null);
    ui.setGesture('none');
    active = null;
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    if (!dragging) {
      cleanup();
      // simple click → insert next to the composition
      spec.click();
      return;
    }
    if (pending) update(ev);
    const ok = lastOver && last && last.valid && item;
    const placed = item;
    cleanup();
    if (ok && placed) {
      spec.drop(placed);
    } else if (lastOver && last && !last.valid) {
      toast(t('cmd.spotTaken'));
    }
  };

  const onCancel = () => cleanup();
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cleanup(); }
  };

  source.addEventListener('pointermove', onMove);
  source.addEventListener('pointerup', onUp);
  source.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  active = cleanup;
}

function fmt(v: number) {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', DECIMAL);
}
