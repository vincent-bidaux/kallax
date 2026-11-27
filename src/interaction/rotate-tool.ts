// ─────────────────────────────────────────────────────────────
// Canvas rotation tool (à la Bambu Studio) + angle eyedropper.
//
// When exactly one item or one whole group is selected, a horizontal circle
// is drawn at the vertical centre of the selection (middle of its world box),
// around its rotation pivot (commands.rotationPivot). A handle on the rim
// shows the angle about Z of the selection's reference item (0° = +X,
// counter-clockwise seen from above, like `rotation`); long ticks inside the
// circle (≈ 92 % → 55 % of the radius) mark every 45°.
//
// Dragging the handle turns the selection live (store.preview → one undo
// step on release, Esc cancels):
//   - padlock closed (settings.rotationFree = false): 45° steps;
//   - padlock open: free angle, magnetised (±7°, released beyond ±9° —
//     hysteresis, no flicker at the edge of the zone) to the 45° ticks and to
//     the angles of the other visible items (modulo 90°), so a unit can be
//     turned to sit square with a wall at 34°. Entering a magnet lights its
//     tick, shows the snapped value in the pill (accent) and pulses the handle.
// A pill next to the handle shows the angle, the padlock and the eyedropper:
// arm it, click another item → the selection takes that item's angle.
//
// Sizes are screen-constant (fat lines in px, ticks / margins converted from
// px at the pivot), so the tool reads the same at any zoom, in iso, cavalier
// and perspective. Hidden while items are moved / placed, and when the floor
// plane is seen edge-on (elevations), where it could not be dragged.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { ViewportAPI } from '../core/contracts';
import type { Item, Vec3 } from '../core/types';
import { store } from '../core/store';
import { soleGroup } from '../core/groups';
import { angleDiff, fmtAngle, isRightAngle, normAngle } from '../core/orient';
import { itemOBB, obbCorners2D } from '../core/obb';
import { unionBox } from '../core/kallax';
import { t, DECIMAL } from '../core/i18n';
import { LineSegments2, makeLineMaterial, disposeLineMaterial, type LineMaterial } from '../render/lines';
import { ui } from './context';
import * as cmd from './commands';
import { toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { tip } from '../ui/controls';
import { installSnapMarker } from './snap-marker';

/** Magnet distance (degrees) to the 45° ticks and to other items' angles. */
const SNAP_DEG = 7;
/** Once snapped, the magnet only lets go beyond SNAP_DEG + SNAP_HYST (no flicker at the boundary). */
const SNAP_HYST = 2;
/** Screen sizes (CSS px). */
const PX = { margin: 26, minRadius: 46 };
/** Ticks, as fractions of the radius: outer end, inner end (90° / 45° ticks). */
const TICK = { outer: 0.92, innerMajor: 0.55, innerMinor: 0.62 };

const STYLE_ID = 'kd-rot-style';
const CSS = `
.kd-rot-layer { position: absolute; left: 0; top: 0; pointer-events: none; overflow: hidden; z-index: 3; -webkit-user-select: none; user-select: none; }
.kd-rot-anchor { pointer-events: none; }
.kd-rot-handle {
  pointer-events: auto; width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%;
  background: var(--kd-rot-fill); border: 2.5px solid #fff; cursor: grab; touch-action: none;
  box-shadow: 0 1px 3px rgba(0,0,0,.35), 0 0 0 .5px rgba(0,0,0,.25);
  transition: transform .12s ease, box-shadow .12s ease;
}
.kd-rot-handle:hover { transform: scale(1.18); }
.kd-rot-handle.drag { cursor: grabbing; transform: scale(1.25); box-shadow: 0 0 0 5px var(--kd-rot-halo), 0 1px 3px rgba(0,0,0,.35); }
.kd-rot-handle.pulse { animation: kd-rot-pulse .32s ease-out; }
@keyframes kd-rot-pulse {
  0% { transform: scale(1.25); box-shadow: 0 0 0 5px var(--kd-rot-halo), 0 1px 3px rgba(0,0,0,.35); }
  35% { transform: scale(1.5); box-shadow: 0 0 0 9px var(--kd-rot-halo), 0 1px 3px rgba(0,0,0,.35); }
  100% { transform: scale(1.25); box-shadow: 0 0 0 5px var(--kd-rot-halo), 0 1px 3px rgba(0,0,0,.35); }
}
.kd-rot-pill.pulse .kd-rot-val { animation: kd-rot-bump .32s ease-out; }
@keyframes kd-rot-bump { 0% { transform: scale(1); } 35% { transform: scale(1.14); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .kd-rot-handle.pulse, .kd-rot-pill.pulse .kd-rot-val { animation: none; } }
.kd-rot-pill {
  pointer-events: auto; display: inline-flex; align-items: center; gap: 2px; height: 26px; box-sizing: border-box;
  padding: 0 3px 0 9px; border-radius: 999px; white-space: nowrap;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
  color: var(--text); background: var(--popover-bg);
  -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
  box-shadow: var(--shadow-float), 0 0 0 .5px var(--shadow-pop-border);
}
.kd-rot-val { display: inline-block; min-width: 42px; text-align: right; margin-right: 3px; transform-origin: 100% 50%; }
.kd-rot-pill.snapped .kd-rot-val { color: var(--accent-text); }
.kd-rot-btn {
  display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--text-2); cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.kd-rot-btn:hover { background: var(--fill-2); color: var(--text); }
.kd-rot-btn.on { background: var(--accent); color: #fff; }
.kd-rot-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.kd-rot-layer.dragging .kd-rot-btn { pointer-events: none; opacity: .45; }
`;
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

interface Target { items: Item[]; ref: Item }
interface Drag {
  pid: number;
  base: Item[];
  pivot: Vec3;
  z: number;
  /** Reference angle at the start, pointer angle at the start (deg). */
  theta0: number;
  a0: number;
  angle: number;
  snapped: 'tick' | 'item' | null;
  snapName: string;
  /** Angle of the magnet currently holding the handle (hysteresis), null when free. */
  snapTo: number | null;
}

let cancelRotate: (() => boolean) | null = null;
/** Cancel an in-progress handle drag (Escape). */
export function cancelActiveRotate(): boolean { return cancelRotate ? cancelRotate() : false; }

/** The selection the tool acts on: one editable item, or one whole (editable) group. */
function currentTarget(): Target | null {
  const sel = store.selectedItems();
  if (!sel.length) return null;
  if (sel.length > 1 && !soleGroup(store.selection, store.visibleItems())) return null;
  if (sel.some(i => store.isLocked(i))) return null;
  const vis = new Set(store.visibleItems().map(i => i.id));
  if (sel.some(i => !vis.has(i.id))) return null;
  const ref = cmd.rotationRef(sel);
  return ref ? { items: sel, ref } : null;
}

/** Arm / disarm the eyedropper (inspector and canvas buttons). */
export function toggleEyedropper(on = !ui.eyedropper) {
  if (on && !store.selection.length) return;
  ui.setEyedropper(on);
}

export function installRotateTool(vp: ViewportAPI) {
  ensureStyle();
  // the move / placement snap marker (cross-angle corner magnets) lives in the same overlay
  installSnapMarker(vp);
  const el = vp.container;
  const canvas = () => vp.getRenderer().domElement;

  // ── 3D lines ──
  const group = new THREE.Group();
  group.name = 'kd-rotate-tool';
  group.renderOrder = 30;
  group.visible = false;
  vp.overlay.add(group);
  let mats: { ring: LineMaterial; tick: LineMaterial; hot: LineMaterial; ray: LineMaterial } | null = null;
  let matTheme = '';
  const makeMats = () => {
    const paper = store.settings.theme === 'paper';
    if (mats && matTheme === store.settings.theme) return mats;
    if (mats) for (const m of Object.values(mats)) disposeLineMaterial(m);
    const stroke = paper ? '#007aff' : '#64d2ff';
    const mk = (width: number, opacity: number) => {
      const m = makeLineMaterial({ color: stroke, width, opacity, depthTest: false });
      m.transparent = true; m.depthWrite = false;
      return m;
    };
    mats = { ring: mk(1.5, 0.95), tick: mk(2.25, 0.8), hot: mk(3.5, 1), ray: mk(1, 0.75) };
    matTheme = store.settings.theme;
    layer.style.setProperty('--kd-rot-fill', paper ? '#007aff' : '#0a84ff');
    layer.style.setProperty('--kd-rot-halo', paper ? 'rgba(0,122,255,.22)' : 'rgba(100,210,255,.3)');
    return mats;
  };
  const seg = (mat: LineMaterial, order: number) => {
    const l = new LineSegments2(new LineSegmentsGeometry(), mat);
    l.renderOrder = order;
    l.frustumCulled = false;
    (l as any).raycast = () => { /* not pickable */ };
    group.add(l);
    return l;
  };
  const setPos = (l: LineSegments2, pos: number[]) => {
    l.visible = pos.length > 0;
    if (!pos.length) return;
    l.geometry.dispose();
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    l.geometry = g;
  };

  // ── DOM: handle + pill ──
  const css = new CSS2DRenderer();
  const layer = css.domElement;
  layer.className = 'kd-rot-layer';
  el.appendChild(layer);
  const labelScene = new THREE.Scene();
  const handle = document.createElement('div');
  handle.className = 'kd-rot-handle';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', t('rot.handle'));
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '360');
  const hAnchor = document.createElement('div');
  hAnchor.className = 'kd-rot-anchor';
  hAnchor.appendChild(handle);
  const hObj = new CSS2DObject(hAnchor);
  labelScene.add(hObj);

  const val = document.createElement('span');
  val.className = 'kd-rot-val';
  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = 'kd-rot-btn';
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'kd-rot-btn';
  pickBtn.setAttribute('aria-label', t('rot.pick'));
  pickBtn.appendChild(icon('eyedropper', 14));
  tip(pickBtn, t('rot.pick'), t('key.esc'));
  const pill = document.createElement('div');
  pill.className = 'kd-rot-pill';
  pill.append(val, lockBtn, pickBtn);
  const pAnchor = document.createElement('div');
  pAnchor.className = 'kd-rot-anchor';
  pAnchor.appendChild(pill);
  const pObj = new CSS2DObject(pAnchor);
  labelScene.add(pObj);

  for (const b of [lockBtn, pickBtn]) b.addEventListener('pointerdown', e => e.stopPropagation());
  lockBtn.addEventListener('click', () => store.setSettings({ rotationFree: !store.settings.rotationFree }));
  pickBtn.addEventListener('click', () => toggleEyedropper());
  let lockKey = '';
  const syncButtons = () => {
    const free = store.settings.rotationFree;
    const k = `${free}|${ui.eyedropper}`;
    if (k === lockKey) return;
    lockKey = k;
    lockBtn.replaceChildren(icon(free ? 'lockOpen' : 'lock', 14));
    lockBtn.classList.toggle('on', free);
    lockBtn.setAttribute('aria-pressed', String(free));
    lockBtn.setAttribute('aria-label', t('rot.lockAria'));
    tip(lockBtn, free ? t('rot.freeTip') : t('rot.lockedTip'));
    pickBtn.classList.toggle('on', ui.eyedropper);
    pickBtn.setAttribute('aria-pressed', String(ui.eyedropper));
    document.body.classList.toggle('eyedropper-on', ui.eyedropper);
  };

  // ── state ──
  let drag: Drag | null = null;
  let shown = false;
  /** Geometry of the last frame (for the pill placement and the drag). */
  let frame: { P: Vec3; R: number; angle: number } | null = null;
  const ring = seg(makeMats().ring, 30);
  const ticks = seg(makeMats().tick, 31);
  const hot = seg(makeMats().hot, 32);
  const ray = seg(makeMats().ray, 31);
  let geoKey = '';

  /** cm per screen px on the floor plane at P (null when the plane is seen edge-on). */
  const pxScale = (P: Vec3): number | null => {
    const a = vp.worldToScreen(P);
    const bx = vp.worldToScreen({ x: P.x + 10, y: P.y, z: P.z });
    const by = vp.worldToScreen({ x: P.x, y: P.y + 10, z: P.z });
    const ux = { x: bx.x - a.x, y: bx.y - a.y }, uy = { x: by.x - a.x, y: by.y - a.y };
    const lx = Math.hypot(ux.x, ux.y), ly = Math.hypot(uy.x, uy.y);
    if (!(lx > 1e-6 && ly > 1e-6) || !a.visible) return null;
    const sin = Math.abs(ux.x * uy.y - ux.y * uy.x) / (lx * ly);
    if (sin < 0.22) return null; // floor seen edge-on (front / side elevations)
    return 10 / Math.max(lx, ly);
  };

  const hide = () => {
    if (!shown) return;
    shown = false;
    group.visible = false;
    layer.style.display = 'none';
    frame = null;
  };

  /** Pointer angle (deg, from +X, CCW) on the plane z around P. */
  const pointerAngle = (x: number, y: number, P: Vec3, z: number): number | null => {
    const p = vp.rayToPlane(x, y, { x: 0, y: 0, z: 1 }, z);
    if (!p || Math.hypot(p.x - P.x, p.y - P.y) < 1e-6) return null;
    return normAngle((Math.atan2(p.y - P.y, p.x - P.x) * 180) / Math.PI);
  };

  const beforeRender = () => {
    const tgt = drag ? null : currentTarget();
    const busy = ui.gesture === 'move' || ui.gesture === 'place' || !!ui.insertTool;
    if ((!drag && !tgt) || busy) { hide(); return; }
    const items = drag ? store.items.filter(i => drag!.base.some(b => b.id === i.id)) : tgt!.items;
    const ref = drag ? null : tgt!.ref;
    const P0 = drag ? drag.pivot : cmd.rotationPivot(items, ref!.rotation);
    // vertical centre of the selection's world box (the ring stays horizontal: rotation about Z)
    const ub = unionBox(items);
    const z = drag ? drag.z : ub ? (ub.min.z + ub.max.z) / 2 : P0.z;
    const P = { x: P0.x, y: P0.y, z };
    const k = pxScale(P);
    if (k === null) { hide(); return; }
    // footprint radius around the pivot
    let rr = 0;
    for (const it of items) for (const c of obbCorners2D(itemOBB(it))) rr = Math.max(rr, Math.hypot(c.x - P.x, c.y - P.y));
    const R = Math.max(rr + PX.margin * k, PX.minRadius * k);
    const angle = drag ? drag.angle : normAngle(ref!.rotation);
    frame = { P, R, angle };
    const m = makeMats();
    ring.material = m.ring; ticks.material = m.tick; hot.material = m.hot; ray.material = m.ray;
    // geometry (rebuilt only when it changed on screen)
    const hotAngle = drag?.snapped ? drag.angle : null;
    const key = [P.x, P.y, P.z, R, k].map(v => v.toFixed(2)).join(',') + `|${hotAngle?.toFixed(3) ?? ''}|${drag ? angle.toFixed(3) : ''}`;
    if (key !== geoKey) {
      geoKey = key;
      const circle: number[] = [];
      const N = 128;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        circle.push(P.x + R * Math.cos(a0), P.y + R * Math.sin(a0), z, P.x + R * Math.cos(a1), P.y + R * Math.sin(a1), z);
      }
      setPos(ring, circle);
      const tk: number[] = [];
      const tickAt = (deg: number, major: boolean, out: number[]) => {
        const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const r1 = R * TICK.outer, r0 = R * (major ? TICK.innerMajor : TICK.innerMinor);
        out.push(P.x + r0 * c, P.y + r0 * s, z, P.x + r1 * c, P.y + r1 * s, z);
      };
      for (let d = 0; d < 360; d += 45) tickAt(d, d % 90 === 0, tk);
      setPos(ticks, tk);
      const hp: number[] = [];
      if (hotAngle !== null) tickAt(hotAngle, true, hp);
      setPos(hot, hp);
      // while dragging: a ray from near the pivot towards the handle; when snapped it
      // stops short of the ticks (so the highlighted tick reads on its own)
      const rp: number[] = [];
      if (drag) {
        const a = (angle * Math.PI) / 180;
        const r1 = hotAngle !== null ? R * TICK.innerMajor - 5 * k : R * TICK.outer;
        const r0 = Math.min(r1 * 0.4, 18 * k);
        if (r1 > r0) rp.push(P.x + r0 * Math.cos(a), P.y + r0 * Math.sin(a), z, P.x + r1 * Math.cos(a), P.y + r1 * Math.sin(a), z);
        // and the outer stub from the rim to the handle is the rim itself
      }
      setPos(ray, rp);
    }
    group.visible = true;
    if (!shown) { shown = true; layer.style.display = ''; }
    const a = (angle * Math.PI) / 180;
    hObj.position.set(P.x + R * Math.cos(a), P.y + R * Math.sin(a), z);
    pObj.position.copy(hObj.position);
    handle.setAttribute('aria-valuenow', String(Math.round(angle * 10) / 10));
    const text = fmtAngle(angle, DECIMAL);
    if (val.textContent !== text) val.textContent = text;
    pill.classList.toggle('snapped', !!drag?.snapped);
    syncButtons();
  };

  const afterRender = () => {
    const { width, height } = vp.getSize();
    css.setSize(width, height);
    if (!shown || !frame) return;
    // pill: outside the circle, along the handle's screen direction
    const { P, R, angle } = frame;
    const a = (angle * Math.PI) / 180;
    const sP = vp.worldToScreen(P);
    const sH = vp.worldToScreen({ x: P.x + R * Math.cos(a), y: P.y + R * Math.sin(a), z: P.z });
    let dx = sH.x - sP.x, dy = sH.y - sP.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const w = pill.offsetWidth || 110, h = pill.offsetHeight || 26;
    const off = 16 + Math.abs(dx) * w / 2 + Math.abs(dy) * h / 2;
    pill.style.transform = `translate(${(dx * off).toFixed(1)}px, ${(dy * off).toFixed(1)}px)`;
    css.render(labelScene, vp.getCamera());
  };

  vp.onBeforeRender(beforeRender);
  vp.onAfterRender(afterRender);
  layer.style.display = 'none';

  const redraw = () => vp.requestRender();
  store.on(ev => {
    if (ev === 'selection' && ui.eyedropper && !store.selection.length) ui.setEyedropper(false);
    if (ev === 'settings') lockKey = '';
    redraw();
  });
  ui.on(ev => { if (ev === 'gesture' || ev === 'tool') { syncButtons(); redraw(); } });

  // ── drag the handle ──
  /** Angle after magnets: 45° ticks (always when the padlock is closed) and other items' angles. */
  const snapAngle = (raw: number, moving: Set<string>, held: number | null): { angle: number; snapped: Drag['snapped']; name: string } => {
    raw = normAngle(raw);
    if (!store.settings.rotationFree) return { angle: normAngle(Math.round(raw / 45) * 45), snapped: 'tick', name: '' };
    let best: { angle: number; d: number; snapped: Drag['snapped']; name: string } | null = null;
    const consider = (a: number, kind: 'tick' | 'item', name: string) => {
      const d = Math.abs(angleDiff(raw, a));
      // the magnet holding the handle keeps it up to SNAP_DEG + SNAP_HYST, and wins ties
      const isHeld = held !== null && Math.abs(angleDiff(a, held)) < 1e-6;
      const lim = isHeld ? SNAP_DEG + SNAP_HYST : SNAP_DEG;
      const dd = isHeld ? d - SNAP_HYST : d;
      if (d <= lim && (!best || dd < best.d - 1e-9)) best = { angle: normAngle(a), d: dd, snapped: kind, name };
    };
    for (let a = 0; a < 360; a += 45) consider(a, 'tick', '');
    for (const it of store.visibleItems()) {
      if (moving.has(it.id) || isRightAngle(it.rotation)) continue;
      for (let q = 0; q < 4; q++) consider(it.rotation + q * 90, 'item', it.name);
    }
    if (!best) return { angle: normAngle(Math.round(raw * 10) / 10), snapped: null, name: '' };
    const b = best as { angle: number; snapped: Drag['snapped']; name: string };
    // an item angle that falls on a tick reads as the tick
    if (b.snapped === 'item' && Math.abs(b.angle / 45 - Math.round(b.angle / 45)) < 1e-6) b.snapped = 'tick';
    return { angle: b.angle, snapped: b.snapped, name: b.name };
  };

  /** Short "click" of the handle and the pill value when a magnet catches it. */
  const pulse = () => {
    for (const n of [handle, pill]) {
      n.classList.remove('pulse');
      void n.offsetWidth; // restart the animation
      n.classList.add('pulse');
    }
  };
  for (const n of [handle, pill]) n.addEventListener('animationend', () => n.classList.remove('pulse'));

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.stopPropagation();
    const a = pointerAngle(e.clientX, e.clientY, drag.pivot, drag.z);
    if (a === null) return;
    const raw = drag.theta0 + angleDiff(a, drag.a0);
    const moving = new Set(drag.base.map(i => i.id));
    const s = snapAngle(raw, moving, drag.snapTo);
    const entered = s.snapped !== null && (drag.snapTo === null || Math.abs(angleDiff(s.angle, drag.snapTo)) > 1e-6);
    drag.snapped = s.snapped;
    drag.snapName = s.name;
    drag.snapTo = s.snapped ? s.angle : null;
    if (entered) pulse();
    if (Math.abs(angleDiff(s.angle, drag.angle)) < 1e-9 && store.items.some(i => moving.has(i.id))) { vp.requestRender(); return; }
    drag.angle = s.angle;
    const delta = angleDiff(s.angle, drag.theta0);
    const next = cmd.zRotationLayout(drag.base, delta, drag.pivot);
    store.preview(d => cmd.applyRotated(d, next));
    const deg = fmtAngle(s.angle, DECIMAL);
    ui.setSnap(s.snapped === 'item' ? t('rot.snapItem', { name: s.name, deg })
      : s.snapped === 'tick' ? (store.settings.rotationFree ? t('rot.snapTick', { deg }) : t('rot.step', { deg }))
      : t('rot.free', { deg }));
    vp.requestRender();
  };

  const end = (commit: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelRotate = null;
    try { handle.releasePointerCapture(d.pid); } catch { /* ignore */ }
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    handle.classList.remove('drag');
    layer.classList.remove('dragging');
    document.body.classList.remove('rotating');
    const changed = Math.abs(angleDiff(d.angle, d.theta0)) > 1e-9;
    if (commit && changed) store.commit(); else store.cancelPreview();
    vp.setControlsEnabled(true);
    ui.setSnap(null);
    ui.setGesture('none');
    geoKey = '';
    vp.requestRender();
  };
  const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.pid) { e.stopPropagation(); end(true); } };
  const onCancel = (e: PointerEvent) => { if (drag && e.pointerId === drag.pid) end(false); };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const tgt = currentTarget();
    if (!tgt || !frame) return;
    e.preventDefault();
    e.stopPropagation();
    const a0 = pointerAngle(e.clientX, e.clientY, frame.P, frame.P.z);
    if (a0 === null) return;
    if (ui.eyedropper) ui.setEyedropper(false);
    drag = {
      pid: e.pointerId, base: structuredClone(tgt.items), pivot: { ...frame.P }, z: frame.P.z,
      theta0: normAngle(tgt.ref.rotation), a0, angle: normAngle(tgt.ref.rotation), snapped: null, snapName: '', snapTo: null,
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    handle.classList.add('drag');
    layer.classList.add('dragging');
    document.body.classList.add('rotating');
    vp.setControlsEnabled(false);
    store.setHover(null);
    ui.setGesture('rotate');
    ui.setSnap(t('rot.free', { deg: fmtAngle(drag.angle, DECIMAL) }));
    cancelRotate = () => { if (!drag) return false; end(false); return true; };
  });
  // keyboard on the focused handle: ←/→ by the step (1° with ⌥)
  handle.tabIndex = 0;
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    const step = e.altKey ? 1 : cmd.ROT_STEP;
    cmd.rotateSelection(e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : step, 'z');
  });

  // ── eyedropper: the next click on an item copies its angle (capture phase, before select / move) ──
  el.addEventListener('pointerdown', (e) => {
    if (!ui.eyedropper || e.target !== canvas() || e.button !== 0) return;
    const id = vp.pickItem(e.clientX, e.clientY);
    if (!id) return; // empty space: the camera may still orbit
    e.stopImmediatePropagation();
    e.preventDefault();
    if (store.selection.includes(id)) { toast(t('rot.pickSelf'), 1400); return; }
    const src = store.getItem(id);
    if (!src) return;
    ui.setEyedropper(false);
    cmd.rotateSelectionTo(src.rotation);
    toast(t('rot.picked', { deg: fmtAngle(src.rotation, DECIMAL) }), 1400);
  }, true);
}
