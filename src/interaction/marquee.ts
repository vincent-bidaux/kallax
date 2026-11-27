// ─────────────────────────────────────────────────────────────
// Marquee (rectangle / box) selection — Shift-drag in the viewport.
//
//   ⇧-drag            replaces the selection
//   ⇧⌘-drag (macOS)   adds to it  (⇧Alt-drag elsewhere; both work everywhere)
//   ⇧-click (< 4 px)  unchanged: toggles the clicked item (or its group)
//   Esc               cancels the marquee (selection untouched)
//
// Crossing selection: an item is caught when the rectangle ENCLOSES or
// TOUCHES it. Each candidate (visible, unlocked layer) is reduced to the
// screen convex hull of the 8 projected corners of its oriented box
// (core/obb.ts), then tested against the rectangle with the separating axis
// theorem — exact for two convex polygons, so it covers the rectangle inside
// the hull, the hull inside the rectangle and crossing edges alike. It works
// for every camera (iso, cavalier shear, free, perspective / ortho) since
// it only relies on vp.worldToScreen. Grouped items bring their whole group
// (as a click does), except members of the entered group.
//
// The press is caught in the CAPTURE phase on the viewport container and
// stopped there: neither OrbitControls (which would pan on Shift) nor
// select-move (which would move the items) ever see a Shift press.
// ─────────────────────────────────────────────────────────────
import type { ViewportAPI } from '../core/contracts';
import type { Item, Vec3 } from '../core/types';
import { store } from '../core/store';
import { itemOBB, frameAxes } from '../core/obb';
import { expandToGroups } from '../core/groups';
import { ui } from './context';

const CLICK_PX = 4;

interface P2 { x: number; y: number }

let cancelMarquee: (() => boolean) | null = null;
/** Cancel a marquee being drawn (Escape). True when something was cancelled. */
export function cancelActiveMarquee(): boolean { return cancelMarquee ? cancelMarquee() : false; }

/** The 8 world corners of an item's oriented box. */
function obbCorners(it: Item): Vec3[] {
  const o = itemOBB(it);
  const { ex, ey } = frameAxes(o.a);
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push({
      x: o.c.x + ex.x * o.h.x * sx + ey.x * o.h.y * sy,
      y: o.c.y + ex.y * o.h.x * sx + ey.y * o.h.y * sy,
      z: o.c.z + o.h.z * sz,
    });
  }
  return out;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, no collinear points. */
export function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * Axis-aligned rectangle ∩ convex polygon ≠ ∅ (separating axis theorem:
 * the rectangle's two axes + every edge normal of the polygon). Touching
 * counts as intersecting. Degenerate polygons (a point, a segment) work too.
 */
export function rectHitsHull(r: { x0: number; y0: number; x1: number; y1: number }, hull: P2[]): boolean {
  if (!hull.length) return false;
  // rectangle axes (x, y)
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const q of hull) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mny = Math.min(mny, q.y); mxy = Math.max(mxy, q.y); }
  if (mxx < r.x0 || mnx > r.x1 || mxy < r.y0 || mny > r.y1) return false;
  // polygon edge normals
  const corners: P2[] = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    const nx = -(b.y - a.y), ny = b.x - a.x;
    if (Math.abs(nx) + Math.abs(ny) < 1e-9) continue;
    let pmin = Infinity, pmax = -Infinity;
    for (const q of hull) { const d = q.x * nx + q.y * ny; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
    let rmin = Infinity, rmax = -Infinity;
    for (const q of corners) { const d = q.x * nx + q.y * ny; rmin = Math.min(rmin, d); rmax = Math.max(rmax, d); }
    const eps = 1e-6 * (Math.abs(nx) + Math.abs(ny));
    if (rmax < pmin - eps || rmin > pmax + eps) return false;
  }
  return true;
}

export function installMarquee(vp: ViewportAPI) {
  const el = vp.container;
  const canvas = () => vp.getRenderer().domElement;

  const box = document.createElement('div');
  box.className = 'marquee-box';
  box.setAttribute('aria-hidden', 'true');
  box.hidden = true;
  el.appendChild(box);

  let m: {
    pid: number;
    /** Container-relative start / current points (CSS px). */
    x0: number; y0: number; x1: number; y1: number;
    additive: boolean;
    active: boolean;
    hits: string[];
  } | null = null;
  let raf = 0;

  const local = (e: PointerEvent): P2 => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Ids caught by the current rectangle (before group expansion). */
  const caught = (): string[] => {
    if (!m) return [];
    const r = { x0: Math.min(m.x0, m.x1), y0: Math.min(m.y0, m.y1), x1: Math.max(m.x0, m.x1), y1: Math.max(m.y0, m.y1) };
    const out: string[] = [];
    for (const it of store.visibleItems()) {
      if (store.isLocked(it)) continue;
      const pts: P2[] = [];
      for (const c of obbCorners(it)) {
        const s = vp.worldToScreen(c);
        if (s.visible) pts.push({ x: s.x, y: s.y }); // corners behind a perspective camera are dropped
      }
      if (pts.length && rectHitsHull(r, convexHull(pts))) out.push(it.id);
    }
    return out;
  };

  const expand = (ids: string[]) => expandToGroups(ids, store.visibleItems(), store.enteredGroup);

  const draw = () => {
    if (!m) return;
    const x = Math.round(Math.min(m.x0, m.x1)), y = Math.round(Math.min(m.y0, m.y1));
    const w = Math.round(Math.max(m.x0, m.x1)) - x, hh = Math.round(Math.max(m.y0, m.y1)) - y;
    box.style.transform = `translate(${x}px, ${y}px)`;
    box.style.width = `${Math.max(1, w)}px`;
    box.style.height = `${Math.max(1, hh)}px`;
    m.hits = expand(caught());
    vp.setMarquee({ ids: m.hits, additive: m.additive });
    const total = m.additive ? new Set([...store.selection, ...m.hits]).size : m.hits.length;
    ui.setMarqueeInfo(total, m.additive);
  };

  const end = (commit: boolean, e?: PointerEvent) => {
    if (!m) return;
    const g = m;
    m = null;
    cancelMarquee = null;
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    try { canvas().releasePointerCapture(g.pid); } catch { /* ignore */ }
    box.hidden = true;
    box.classList.remove('additive');
    document.body.classList.remove('marqueeing');
    canvas().style.cursor = '';
    vp.setMarquee(null);
    vp.setControlsEnabled(true);
    if (commit) {
      if (g.active) {
        if (g.additive) store.select([...store.selection, ...g.hits]);
        else store.select(g.hits);
      } else if (e) {
        // plain ⇧-click: same as before the marquee existed — toggle the clicked item (or its group)
        const id = vp.pickItem(e.clientX, e.clientY);
        if (id) store.toggleSelect(id);
      }
    }
    ui.setMarqueeInfo(0, false);
    ui.setGesture('none');
    vp.requestRender();
  };

  const onMove = (e: PointerEvent) => {
    if (!m || e.pointerId !== m.pid) return;
    e.stopPropagation();
    const p = local(e);
    m.x1 = p.x; m.y1 = p.y;
    if (!m.active) {
      if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) <= CLICK_PX) return;
      m.active = true;
      box.hidden = false;
      box.classList.toggle('additive', m.additive);
      document.body.classList.add('marqueeing');
      store.setHover(null);
      ui.setGesture('marquee');
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  };
  const onUp = (e: PointerEvent) => {
    if (!m || e.pointerId !== m.pid) return;
    e.stopPropagation();
    if (m.active) { const p = local(e); m.x1 = p.x; m.y1 = p.y; draw(); }
    end(true, e);
  };
  const onCancel = (e: PointerEvent) => { if (m && e.pointerId === m.pid) end(false); };
  /** ⌘ / Alt pressed or released mid-drag switches between replace and add. */
  const onKey = (e: KeyboardEvent) => {
    if (!m || (e.key !== 'Meta' && e.key !== 'Alt' && e.key !== 'OS')) return;
    const add = e.metaKey || e.altKey;
    if (add === m.additive) return;
    m.additive = add;
    box.classList.toggle('additive', add);
    if (m.active) draw();
  };

  el.addEventListener('pointerdown', (e) => {
    if (m || e.target !== canvas() || e.button !== 0 || !e.shiftKey || e.ctrlKey) return;
    if (vp.isWalking() || ui.insertTool || ui.eyedropper || ui.gesture !== 'none') return;
    // ours: OrbitControls must not pan, select-move must not move
    e.stopImmediatePropagation();
    e.preventDefault();
    const p = local(e);
    m = { pid: e.pointerId, x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.metaKey || e.altKey, active: false, hits: [] };
    vp.setControlsEnabled(false);
    canvas().style.cursor = 'crosshair';
    try { canvas().setPointerCapture(e.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    cancelMarquee = () => { if (!m) return false; end(false); return true; };
  }, true);
}
