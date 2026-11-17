// ─────────────────────────────────────────────────────────────
// Automatic architectural dimensioning ("cotes").
//
//  • per item: width (X) / depth (Y) / height (Z) of its world AABB
//  • global: overall W × D × H of the composition, on an outer tier
//
// Geometry = fat lines in viewport.overlay (dimension line, extension
// lines with a gap + overshoot, 45° architect ticks). Everything lies
// on the ground plane or on vertical planes, on the faces visible from
// the current camera (decided in screen space, so it also works with
// the sheared cavalier projection). Labels = HTML pills rendered by a
// private CSS2DRenderer, rotated along the line, de-cluttered per frame.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { ViewportAPI } from '../core/contracts';
import type { ThemeTokens } from '../core/theme';
import type { Item } from '../core/types';
import { fmtCm, itemBox, unionBox, type Box3 } from '../core/kallax';
import { store, type StoreEvent } from '../core/store';
import { LineSegments2, LineMaterial, makeLineMaterial, disposeLineMaterial } from './lines';
import { applyMeasureTheme, ensureMeasureStyle } from './measure-style';

type V3 = THREE.Vector3;
type Sign = 1 | -1;
type Tier = 'item' | 'global';

/** Which sides of the composition the dimensions go on. */
interface Layout {
  /** Visible X face: +1 = right (+X), −1 = left. Depth goes on this side. */
  fx: Sign;
  /** Visible Y face: −1 = front (−Y), +1 = back. */
  fy: Sign;
  /** Visible Z face: +1 = top (camera above), −1 = bottom (camera below). */
  fz: Sign;
  /** Width: 'h' = lies on a horizontal plane (offset along ±Y), 'v' = vertical front plane (offset along ∓Z). */
  w: 'h' | 'v';
  /** Depth: 'h' = horizontal plane (offset along ±X), 'v' = vertical side plane (offset along ∓Z). */
  d: 'h' | 'v';
  /** Height: 'y' = vertical front plane (offset along ∓X), 'x' = vertical side plane (offset along ±Y). */
  h: 'y' | 'x';
}

interface DimSpec {
  key: string;
  tier: Tier;
  itemId: string | null;
  /** Measured points on the object (start / end of the measured extent). */
  pa: V3;
  pb: V3;
  /** Unit offset direction (perpendicular to pb − pa). */
  o: V3;
  off: number;
  value: number;
  /** Extension line starts at the object (false → short stub near the dimension line, nothing to attach to). */
  attachA?: boolean;
  attachB?: boolean;
}

interface NameSpec {
  key: string;
  itemId: string;
  text: string;
  pos: V3;
  /** Face extents used to decide if the name fits on screen. */
  wa: V3; wb: V3; ha: V3; hb: V3;
}

interface LabelRec {
  key: string;
  kind: 'dim' | 'name';
  tier: Tier;
  itemId: string | null;
  obj: CSS2DObject;
  pill: HTMLElement;
  text: string;
  /** Dimension line ends (world) — or face extents for names. */
  a: V3; b: V3;
  ha?: V3; hb?: V3;
  lines: THREE.Object3D | null;
  w: number; h: number;
  on: boolean;
  angle: number;
  dying: boolean;
  // per-frame scratch
  cand: boolean;
  sx: number; sy: number; bw: number; bh: number; prio: number; len: number;
}

const EPS = 0.05;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const toVec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

const LAYOUT_THROTTLE_MS = 90;

export class Measurements {
  private vp: ViewportAPI;
  private group = new THREE.Group();
  private labelScene = new THREE.Scene();
  private css = new CSS2DRenderer();
  private labels = new Map<string, LabelRec>();
  private mats: Record<'dim' | 'dimG' | 'ext' | 'tick' | 'tickG', LineMaterial> | null = null;
  private theme: ThemeTokens;
  private layout: Layout | null = null;
  private layoutKey = '';
  private dirty = true;
  private lastBuild = 0;
  private throttleTimer = 0;
  private cssW = -1;
  private cssH = -1;
  private unsubs: (() => void)[] = [];
  private disposed = false;

  constructor(viewport: ViewportAPI) {
    this.vp = viewport;
    ensureMeasureStyle();
    this.theme = viewport.getTheme();

    this.group.name = 'kd-measurements';
    this.group.renderOrder = 20;
    viewport.overlay.add(this.group);

    const el = this.css.domElement;
    el.className = 'kd-dim-layer';
    const cont = viewport.container;
    if (getComputedStyle(cont).position === 'static') cont.style.position = 'relative';
    cont.appendChild(el);
    applyMeasureTheme(el, this.theme);
    this.makeMaterials();

    this.unsubs.push(store.on(ev => this.onStore(ev)));
    this.unsubs.push(viewport.onBeforeRender(() => this.beforeRender()));
    this.unsubs.push(viewport.onAfterRender(() => this.afterRender()));
    viewport.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    clearTimeout(this.throttleTimer);
    this.clearLines();
    this.vp.overlay.remove(this.group);
    for (const r of this.labels.values()) this.labelScene.remove(r.obj);
    this.labels.clear();
    this.disposeMaterials();
    this.css.domElement.remove();
    this.vp.requestRender();
  }

  // ── events ─────────────────────────────────────────────────
  private onStore(ev: StoreEvent) {
    if (ev === 'doc') { this.dirty = true; this.vp.requestRender(); }
    else if (ev === 'settings') {
      // Let the viewport digest the settings first (theme swap…).
      queueMicrotask(() => {
        if (this.disposed) return;
        const t = this.vp.getTheme();
        if (t !== this.theme || t.name !== this.theme.name) {
          this.theme = t;
          applyMeasureTheme(this.css.domElement, t);
          this.disposeMaterials();
          this.makeMaterials();
        }
        this.dirty = true;
        this.vp.requestRender();
      });
    } else if (ev === 'selection') {
      const sel = new Set(store.selection);
      for (const r of this.labels.values()) r.pill.classList.toggle('kd-dim-sel', !!r.itemId && sel.has(r.itemId) && r.kind === 'dim');
      this.vp.requestRender();
    }
  }

  private beforeRender() {
    if (!this.dirty) return;
    const now = performance.now();
    if (this.layoutPending && now - this.lastBuild < LAYOUT_THROTTLE_MS) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = window.setTimeout(() => this.vp.requestRender(), LAYOUT_THROTTLE_MS - (now - this.lastBuild) + 2);
      return;
    }
    this.rebuild();
  }
  private layoutPending = false;

  private afterRender() {
    const cam = this.vp.getCamera();
    const { width, height } = this.vp.getSize();
    if (width !== this.cssW || height !== this.cssH) {
      this.cssW = width; this.cssH = height;
      this.css.setSize(width, height);
    }

    // Layout check (fresh camera matrices here).
    const items = store.visibleItems();
    const ub = items.length ? unionBox(items) : null;
    if (ub) {
      const L = this.computeLayout(ub, this.layout);
      const key = layoutKey(L);
      if (key !== this.layoutKey) {
        const first = !this.layout;
        this.layout = L;
        this.layoutKey = key;
        this.dirty = true;
        this.layoutPending = !first;
        this.deferRender();
      }
    }

    // Decide rotation / visibility first so the CSS pass applies them this frame.
    const unmeasured = this.updateLabels();
    this.css.render(this.labelScene, cam);
    if (unmeasured) {
      // New labels are in the DOM now: measure them and lay out again next frame.
      for (const r of this.labels.values()) if (!r.w && !r.dying) { r.w = r.pill.offsetWidth; r.h = r.pill.offsetHeight; }
      this.deferRender();
    }
  }

  /** requestRender() from inside a frame hook may be ignored by the viewport → defer it. */
  private renderQueued = false;
  private deferRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => { this.renderQueued = false; if (!this.disposed) this.vp.requestRender(); });
  }

  // ── layout (screen-space face visibility) ──────────────────
  private facing(c: V3, t1: V3, t2: V3): number {
    const s0 = this.vp.worldToScreen(toVec(c));
    const s1 = this.vp.worldToScreen(toVec(c.clone().add(t1)));
    const s2 = this.vp.worldToScreen(toVec(c.clone().add(t2)));
    const cross = (s1.x - s0.x) * (s2.y - s0.y) - (s1.y - s0.y) * (s2.x - s0.x);
    const r = -cross;
    return Number.isFinite(r) ? r : 0;
  }

  private computeLayout(b: Box3, prev: Layout | null): Layout {
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    const ext = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 10);
    const T = ext * 0.25;
    const X = v3(T, 0, 0), Y = v3(0, T, 0), Z = v3(0, 0, T);

    const fFront = this.facing(v3(cx, b.min.y, cz), X, Z);
    const fBack = this.facing(v3(cx, b.max.y, cz), Z, X);
    const fRight = this.facing(v3(b.max.x, cy, cz), Y, Z);
    const fLeft = this.facing(v3(b.min.x, cy, cz), Z, Y);
    const fTop = this.facing(v3(cx, cy, b.max.z), X, Y);
    const fBot = this.facing(v3(cx, cy, b.min.z), Y, X);

    const d = this.vp.getViewDirection();
    const tiny = 1e-3 * T * T;
    const pick = (pos: number, neg: number, prevS: Sign | undefined, fallback: Sign): Sign => {
      if (Math.abs(pos - neg) < tiny) return prevS ?? fallback;
      return pos > neg ? 1 : -1;
    };
    const fy: Sign = pick(fBack, fFront, prev?.fy, d.y > 0 ? -1 : 1);
    const fx: Sign = pick(fRight, fLeft, prev?.fx, d.x < 0 ? 1 : (d.x > 0 ? -1 : 1));
    const fz: Sign = pick(fTop, fBot, prev?.fz, d.z > 0.001 ? -1 : 1);

    const visX = Math.max(0, fRight, fLeft);
    const visY = Math.max(0, fFront, fBack);
    const visZ = Math.max(0, fTop, fBot);

    // Horizontal-vs-vertical plane choice with hysteresis.
    const choose = <A extends string, B extends string>(
      primary: number, secondary: number, a: A, bb: B, prevV: A | B | undefined,
      enter: number, leave: number, init: number,
    ): A | B => {
      if (secondary <= 1e-9) return a;
      const r = primary / secondary;
      if (prevV === a) return r < leave ? bb : a;
      if (prevV === bb) return r > enter ? a : bb;
      return r >= init ? a : bb;
    };
    const w = choose(visZ, visY, 'h' as const, 'v' as const, prev?.w, 0.8, 0.74, 0.77);
    const dd = choose(visZ, visX, 'h' as const, 'v' as const, prev?.d, 0.5, 0.32, 0.42);
    const h = choose(visY, visX, 'y' as const, 'x' as const, prev?.h, 0.55, 0.35, 0.45);
    return { fx, fy, fz, w, d: dd, h };
  }

  private fallbackLayout(): Layout {
    const d = this.vp.getViewDirection();
    const az = Math.abs(d.z), ay = Math.abs(d.y), ax = Math.abs(d.x);
    return {
      fx: d.x > 0 ? -1 : 1,
      fy: d.y < 0 ? 1 : -1,
      fz: d.z > 0.001 ? -1 : 1,
      w: az >= 0.78 * ay ? 'h' : 'v',
      d: az >= 0.42 * ax ? 'h' : 'v',
      h: ay >= 0.45 * ax ? 'y' : 'x',
    };
  }

  // ── materials ──────────────────────────────────────────────
  private makeMaterials() {
    const t = this.theme;
    const W = t.widths;
    const mk = (color: string, width: number, opacity: number) => {
      const m = makeLineMaterial({ color, width, opacity, depthTest: false });
      m.transparent = true;
      m.depthWrite = false;
      return m;
    };
    const blue = t.name === 'blueprint';
    this.mats = {
      dim: mk(t.info, W.dim, blue ? 0.92 : 0.9),
      dimG: mk(t.info, W.dim + 0.2, 1),
      ext: mk(t.infoMuted, W.ext, blue ? 0.85 : 0.8),
      tick: mk(t.info, W.dim + 0.6, blue ? 0.95 : 0.92),
      tickG: mk(t.info, W.dim + 0.8, 1),
    };
  }
  private disposeMaterials() {
    if (!this.mats) return;
    for (const m of Object.values(this.mats)) disposeLineMaterial(m);
    this.mats = null;
  }

  private clearLines() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o: any) => o.geometry?.dispose?.());
    }
  }

  // ── build ──────────────────────────────────────────────────
  private rebuild() {
    this.dirty = false;
    this.layoutPending = false;
    this.lastBuild = performance.now();
    this.clearLines();

    const s = store.settings;
    const items = store.visibleItems();
    const dims: DimSpec[] = [];
    const names: NameSpec[] = [];

    if (items.length && (s.measureItems || s.measureGlobal)) {
      const L = this.layout ?? this.fallbackLayout();
      const ub = unionBox(items)!;
      const ext = Math.max(ub.max.x - ub.min.x, ub.max.y - ub.min.y, ub.max.z - ub.min.z);
      const sc = Math.min(1.7, Math.max(0.85, Math.sqrt(ext / 120)));
      const itemOff = 10 * sc;
      const globalOff = Math.max(28 * sc, itemOff + 16);
      const showGlobal = s.measureGlobal && (items.length >= 2 || !s.measureItems);

      if (s.measureItems) this.itemDims(items, ub, L, itemOff, showGlobal, dims, names);
      if (showGlobal) {
        const n0 = dims.length;
        this.boxDims('g', 'global', null, ub, L, globalOff, dims, [true, true, true], []);
        const boxes = items.map(itemBox);
        const onItem = (p: V3) => boxes.some(b =>
          p.x >= b.min.x - EPS && p.x <= b.max.x + EPS && p.y >= b.min.y - EPS && p.y <= b.max.y + EPS && p.z >= b.min.z - EPS && p.z <= b.max.z + EPS);
        for (let i = n0; i < dims.length; i++) { dims[i].attachA = onItem(dims[i].pa); dims[i].attachB = onItem(dims[i].pb); }
      }

      this.geomScale = Math.sqrt(sc);
    }

    // lines
    const objs = new Map<string, THREE.Object3D>();
    for (const d of dims) {
      const o = this.makeDimObject(d);
      this.group.add(o);
      objs.set(d.key, o);
    }

    // labels: reuse by key, fade out the rest
    const alive = new Set<string>();
    const sel = new Set(store.selection);
    for (const d of dims) {
      alive.add(d.key);
      const a = d.pa.clone().addScaledVector(d.o, d.off);
      const b = d.pb.clone().addScaledVector(d.o, d.off);
      const rec = this.ensureLabel(d.key, 'dim', d.tier, d.itemId);
      rec.a.copy(a); rec.b.copy(b);
      rec.obj.position.copy(a).add(b).multiplyScalar(0.5);
      rec.lines = objs.get(d.key) ?? null;
      this.setLabelText(rec, fmtCm(d.value));
      rec.pill.classList.toggle('kd-dim-sel', !!d.itemId && sel.has(d.itemId));
    }
    for (const n of names) {
      alive.add(n.key);
      const rec = this.ensureLabel(n.key, 'name', 'item', n.itemId);
      rec.a.copy(n.wa); rec.b.copy(n.wb);
      rec.ha = n.ha.clone(); rec.hb = n.hb.clone();
      rec.obj.position.copy(n.pos);
      this.setLabelText(rec, n.text);
    }
    for (const [key, rec] of this.labels) {
      if (alive.has(key) || rec.dying) continue;
      rec.dying = true;
      rec.lines = null;
      rec.pill.classList.remove('kd-dim-on');
      rec.on = false;
      window.setTimeout(() => {
        if (this.labels.get(key) === rec) { this.labels.delete(key); this.labelScene.remove(rec.obj); }
      }, 220);
    }
  }
  private geomScale = 1;

  /** Per-item dimensions with de-duplication and obstacle avoidance. */
  private itemDims(items: Item[], ub: Box3, L: Layout, off: number, showGlobal: boolean, dims: DimSpec[], names: NameSpec[]) {
    const boxes = items.map(it => ({ it, b: itemBox(it) }));
    const { fx, fy, fz } = L;

    const rankW = (b: Box3) => [fz > 0 ? b.min.z : -b.max.z, fy < 0 ? b.min.y : -b.max.y];
    const rankD = (b: Box3) => [fx > 0 ? -b.max.x : b.min.x, fz > 0 ? b.min.z : -b.max.z];
    const rankH = (b: Box3) => [fx > 0 ? b.min.x : -b.max.x, fy < 0 ? b.min.y : -b.max.y];
    const less = (p: number[], q: number[]) => (Math.abs(p[0] - q[0]) > EPS ? p[0] < q[0] : Math.abs(p[1] - q[1]) > EPS ? p[1] < q[1] : false);

    boxes.forEach(({ it, b }, i) => {
      let showW = true, showD = true, showH = true;
      if (showGlobal) {
        if (eq(b.min.x, ub.min.x) && eq(b.max.x, ub.max.x)) showW = false;
        if (eq(b.min.y, ub.min.y) && eq(b.max.y, ub.max.y)) showD = false;
        if (eq(b.min.z, ub.min.z) && eq(b.max.z, ub.max.z)) showH = false;
      }
      for (let j = 0; j < boxes.length && (showW || showD || showH); j++) {
        if (j === i) continue;
        const o = boxes[j].b;
        const ovX = overlap(b.min.x, b.max.x, o.min.x, o.max.x);
        const ovY = overlap(b.min.y, b.max.y, o.min.y, o.max.y);
        const ovZ = overlap(b.min.z, b.max.z, o.min.z, o.max.z);
        const better = (rk: (bx: Box3) => number[]) => less(rk(o), rk(b)) || (!less(rk(b), rk(o)) && j < i);
        if (showW && eq(b.min.x, o.min.x) && eq(b.max.x, o.max.x) && (ovY || ovZ) && better(rankW)) showW = false;
        if (showD && eq(b.min.y, o.min.y) && eq(b.max.y, o.max.y) && (ovX || ovZ) && better(rankD)) showD = false;
        if (showH && eq(b.min.z, o.min.z) && eq(b.max.z, o.max.z) && (ovX || ovY) && better(rankH)) showH = false;
      }
      const others = boxes.filter((_, j) => j !== i).map(x => x.b);
      this.boxDims(it.id, 'item', it.id, b, L, off, dims, [showW, showD, showH], others);

      if (it.kind === 'block' && it.name?.trim()) {
        const yF = fy < 0 ? b.min.y : b.max.y;
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        names.push({
          key: `${it.id}:name`, itemId: it.id, text: it.name.trim(),
          pos: v3(cx, yF, cz),
          wa: v3(b.min.x, yF, cz), wb: v3(b.max.x, yF, cz),
          ha: v3(cx, yF, b.min.z), hb: v3(cx, yF, b.max.z),
        });
      }
    });
  }

  /**
   * W / D / H dimensions of one box. For items, each dimension tries a few
   * placements and takes the first whose dimension line doesn't run through
   * another item.
   */
  private boxDims(prefix: string, tier: Tier, itemId: string | null, b: Box3, L: Layout, off: number,
    dims: DimSpec[], show: [boolean, boolean, boolean], obstacles: Box3[]) {
    const { fx, fy, fz } = L;
    const zRef = fz > 0 ? b.min.z : b.max.z;
    const zAlt = fz > 0 ? b.max.z : b.min.z;
    const yF = fy < 0 ? b.min.y : b.max.y;
    const xD = fx > 0 ? b.max.x : b.min.x;   // depth side
    const xO = fx > 0 ? b.min.x : b.max.x;   // opposite side (height)
    const Yo = v3(0, fy, 0), Zdown = v3(0, 0, -fz), Zup = v3(0, 0, fz);
    const Xd = v3(fx, 0, 0), Xo = v3(-fx, 0, 0);

    const pickCand = (cands: { pa: V3; pb: V3; o: V3 }[]) => {
      if (!obstacles.length) return cands[0];
      for (const c of cands) if (!this.blocked(c.pa, c.pb, c.o, off, obstacles)) return c;
      return cands[0];
    };

    if (show[0]) {
      const pa = v3(b.min.x, yF, zRef), pb = v3(b.max.x, yF, zRef);
      const prim = L.w === 'h' ? Yo : Zdown, sec = L.w === 'h' ? Zdown : Yo;
      const c = pickCand([
        { pa, pb, o: prim },
        { pa, pb, o: sec },
        { pa: v3(b.min.x, yF, zAlt), pb: v3(b.max.x, yF, zAlt), o: Zup },
      ]);
      dims.push({ key: `${prefix}:w`, tier, itemId, pa: c.pa, pb: c.pb, o: c.o, off, value: b.max.x - b.min.x });
    }
    if (show[1]) {
      const pa = v3(xD, b.min.y, zRef), pb = v3(xD, b.max.y, zRef);
      const prim = L.d === 'h' ? Xd : Zdown, sec = L.d === 'h' ? Zdown : Xd;
      const c = pickCand([
        { pa, pb, o: prim },
        { pa, pb, o: sec },
        { pa: v3(xD, b.min.y, zAlt), pb: v3(xD, b.max.y, zAlt), o: Zup },
      ]);
      dims.push({ key: `${prefix}:d`, tier, itemId, pa: c.pa, pb: c.pb, o: c.o, off, value: b.max.y - b.min.y });
    }
    if (show[2]) {
      const cands = L.h === 'y'
        ? [
          { pa: v3(xO, yF, b.min.z), pb: v3(xO, yF, b.max.z), o: Xo },
          { pa: v3(xD, yF, b.min.z), pb: v3(xD, yF, b.max.z), o: Xd },
          { pa: v3(xO, yF, b.min.z), pb: v3(xO, yF, b.max.z), o: Yo },
        ]
        : [
          { pa: v3(xD, yF, b.min.z), pb: v3(xD, yF, b.max.z), o: Yo },
          { pa: v3(xO, yF, b.min.z), pb: v3(xO, yF, b.max.z), o: Xo },
          { pa: v3(xD, yF, b.min.z), pb: v3(xD, yF, b.max.z), o: Xd },
        ];
      const c = pickCand(cands);
      dims.push({ key: `${prefix}:h`, tier, itemId, pa: c.pa, pb: c.pb, o: c.o, off, value: b.max.z - b.min.z });
    }
  }

  /** Does the dimension line (at `off`) run through one of the obstacle boxes? */
  private blocked(pa: V3, pb: V3, o: V3, off: number, obstacles: Box3[]): boolean {
    // Closed bounds: a line lying ON a neighbour's face counts as blocked too
    // (it would be drawn straight over that face).
    const tol = 0.01;
    const p = new THREE.Vector3();
    for (const t of [0.12, 0.5, 0.88]) {
      p.copy(pa).lerp(pb, t).addScaledVector(o, off);
      for (const bx of obstacles) {
        if (p.x >= bx.min.x - tol && p.x <= bx.max.x + tol &&
            p.y >= bx.min.y - tol && p.y <= bx.max.y + tol &&
            p.z >= bx.min.z - tol && p.z <= bx.max.z + tol) return true;
      }
    }
    return false;
  }

  private makeDimObject(d: DimSpec): THREE.Object3D {
    const k = this.geomScale;
    const gap = 1.5, over = 2 * k, runout = 1.2 * k, tick = 3.6 * k;
    const u = d.pb.clone().sub(d.pa);
    const len = u.length();
    u.normalize();
    const o = d.o;
    const a = d.pa.clone().addScaledVector(o, d.off);
    const b = d.pb.clone().addScaledVector(o, d.off);

    const dim: number[] = [];
    const ext: number[] = [];
    const tk: number[] = [];
    const push = (arr: number[], p: V3, q: V3) => arr.push(p.x, p.y, p.z, q.x, q.y, q.z);

    push(dim, a.clone().addScaledVector(u, -runout), b.clone().addScaledVector(u, runout));
    const e0 = Math.min(gap, d.off * 0.4);
    const stub = Math.max(e0, d.off - 9 * k);
    push(ext, d.pa.clone().addScaledVector(o, d.attachA === false ? stub : e0), d.pa.clone().addScaledVector(o, d.off + over));
    push(ext, d.pb.clone().addScaledVector(o, d.attachB === false ? stub : e0), d.pb.clone().addScaledVector(o, d.off + over));
    const t = this.tickDir(a, b, u, o).multiplyScalar(tick / 2);
    if (len > 1e-6) {
      push(tk, a.clone().sub(t), a.clone().add(t));
      push(tk, b.clone().sub(t), b.clone().add(t));
    }

    const g = new THREE.Group();
    g.name = d.key;
    const M = this.mats!;
    const glob = d.tier === 'global';
    g.add(this.seg(ext, M.ext, 20));
    g.add(this.seg(dim, glob ? M.dimG : M.dim, 21));
    g.add(this.seg(tk, glob ? M.tickG : M.tick, 22));
    g.renderOrder = 20;
    return g;
  }

  /**
   * 45° tick in the plane of the dimension. Of the two in-plane diagonals
   * (u ± o) take the one that reads closest to a 45° slash on screen, and
   * orient it like "/" (rising to the right).
   */
  private tickDir(a: V3, b: V3, u: V3, o: V3): V3 {
    const s0 = this.vp.worldToScreen(toVec(a));
    const best = { d: u.clone().add(o).normalize(), score: Infinity };
    const lu = this.vp.worldToScreen(toVec(b));
    const la = Math.atan2(lu.y - s0.y, lu.x - s0.x);
    for (const sgn of [1, -1]) {
      const d = u.clone().addScaledVector(o, sgn).normalize();
      const s1 = this.vp.worldToScreen(toVec(a.clone().addScaledVector(d, 10)));
      const len = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      if (!Number.isFinite(len) || len < 1e-3) continue;
      let rel = Math.abs(Math.atan2(s1.y - s0.y, s1.x - s0.x) - la) % Math.PI;
      if (rel > Math.PI / 2) rel = Math.PI - rel;            // 0..90°
      // prefer the classic "/" slash when both diagonals read the same
      const sdx = s1.x - s0.x, sdy = s1.y - s0.y;
      const slash = sdx * sdy < 0;
      const score = Math.abs(rel - Math.PI / 4) + (slash ? 0 : 0.06);
      if (score < best.score - 1e-3) { best.d = d; best.score = score; }
    }
    // orient as "/" : screen direction going up-right
    const s1 = this.vp.worldToScreen(toVec(a.clone().addScaledVector(best.d, 10)));
    if (s1.x - s0.x < 0) best.d.negate();
    return best.d;
  }

  private seg(pos: number[], mat: LineMaterial, order: number): THREE.Object3D {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(pos));
    const l = new LineSegments2(geo, mat);
    l.renderOrder = order;
    l.frustumCulled = false;
    l.castShadow = false;
    l.receiveShadow = false;
    (l as any).raycast = () => { /* annotations are not pickable */ };
    return l;
  }

  // ── labels ─────────────────────────────────────────────────
  private ensureLabel(key: string, kind: 'dim' | 'name', tier: Tier, itemId: string | null): LabelRec {
    let rec = this.labels.get(key);
    if (rec && rec.dying) {
      // resurrect
      rec.dying = false;
    }
    if (rec) return rec;
    const anchor = document.createElement('div');
    anchor.className = 'kd-dim-anchor';
    const pill = document.createElement('div');
    pill.className = 'kd-dim-pill' + (tier === 'global' ? ' kd-dim-global' : '') + (kind === 'name' ? ' kd-dim-name' : '');
    anchor.appendChild(pill);
    const obj = new CSS2DObject(anchor);
    this.labelScene.add(obj);
    rec = {
      key, kind, tier, itemId, obj, pill, text: '', a: new THREE.Vector3(), b: new THREE.Vector3(),
      lines: null, w: 0, h: 0, on: false, angle: 0, dying: false,
      cand: false, sx: 0, sy: 0, bw: 0, bh: 0, prio: 0, len: 0,
    };
    this.labels.set(key, rec);
    return rec;
  }

  private setLabelText(rec: LabelRec, text: string) {
    if (rec.text === text) return;
    rec.text = text;
    if (rec.kind === 'dim') {
      rec.pill.textContent = '';
      rec.pill.append(document.createTextNode(text));
      const u = document.createElement('span');
      u.className = 'kd-dim-unit';
      u.textContent = 'cm';
      rec.pill.append(u);
    } else {
      rec.pill.textContent = text;
    }
    rec.w = 0; rec.h = 0; // re-measure
  }

  /** Per-frame: rotation, fit test, overlap resolution, fades. */
  private updateLabels(): boolean {
    let unmeasured = false;
    const vp = this.vp;
    const { width: W, height: H } = vp.getSize();
    const sel = new Set(store.selection);
    const list: LabelRec[] = [];
    let lineVisChanged = false;

    for (const r of this.labels.values()) {
      r.cand = false;
      if (r.dying) continue;
      if (!r.w && r.pill.isConnected && r.obj.element.style.display !== 'none') {
        r.w = r.pill.offsetWidth;
        r.h = r.pill.offsetHeight;
      }
      if (!r.w) unmeasured = true;
      const sa = vp.worldToScreen(toVec(r.a));
      const sb = vp.worldToScreen(toVec(r.b));
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      const len = Math.hypot(dx, dy);
      r.len = len;

      if (r.kind === 'dim') {
        // degenerate (edge-on) → hide the line geometry too
        // too short for its label (or edge-on) → hide the line geometry too
        const fits = r.w ? len >= r.w + 12 : len >= 6;
        const lineOk = fits && sa.visible && sb.visible;
        if (r.lines && r.lines.visible !== lineOk) { r.lines.visible = lineOk; lineVisChanged = true; }
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        // keep text upright: (−90.5°, 89.5°] — vertical lines read bottom-to-top (architectural convention)
        // (half-degree tolerance so exactly vertical lines don't flip on float noise)
        if (ang > 89.5) ang -= 180;
        else if (ang <= -90.5) ang += 180;
        if (Math.abs(ang - r.angle) > 0.05) {
          r.angle = ang;
          r.obj.rotation2D = -ang * Math.PI / 180;
        }
        if (!r.w || !lineOk) continue;
        if (len < r.w + 12) continue;
        const rad = ang * Math.PI / 180;
        const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
        r.bw = r.w * c + r.h * s;
        r.bh = r.w * s + r.h * c;
        r.prio = r.tier === 'global' ? 3 : (r.itemId && sel.has(r.itemId) ? 2 : 1);
      } else {
        if (!r.w || !sa.visible || !sb.visible) continue;
        const ha = vp.worldToScreen(toVec(r.ha!));
        const hb = vp.worldToScreen(toVec(r.hb!));
        const hl = Math.hypot(hb.x - ha.x, hb.y - ha.y);
        if (len < r.w + 10 || hl < r.h + 8) continue;
        r.bw = r.w; r.bh = r.h;
        r.prio = 0;
      }
      const m = vp.worldToScreen(toVec(r.obj.position));
      if (!m.visible || m.x < -50 || m.y < -50 || m.x > W + 50 || m.y > H + 50) continue;
      r.sx = m.x; r.sy = m.y;
      r.cand = true;
      list.push(r);
    }

    // overlap resolution: higher priority first, then longer dimensions
    list.sort((p, q) => q.prio - p.prio || q.len - p.len);
    const placed: LabelRec[] = [];
    for (const r of list) {
      let ok = true;
      for (const p of placed) {
        // cheap AABB reject first, then exact oriented-rectangle test
        if (Math.abs(r.sx - p.sx) * 2 >= r.bw + p.bw + 6 || Math.abs(r.sy - p.sy) * 2 >= r.bh + p.bh + 6) continue;
        if (obbOverlap(r, p, 3)) { ok = false; break; }
      }
      if (ok) placed.push(r); else r.cand = false;
    }

    for (const r of this.labels.values()) {
      const on = r.cand && !r.dying;
      if (on !== r.on) {
        r.on = on;
        r.pill.classList.toggle('kd-dim-on', on);
      }
    }
    if (lineVisChanged) this.deferRender();
    return unmeasured;
  }
}

/** Separating-axis test between two rotated label rectangles (screen px). */
function obbOverlap(a: LabelRec, b: LabelRec, pad: number): boolean {
  const ra = a.kind === 'dim' ? a.angle * Math.PI / 180 : 0;
  const rb = b.kind === 'dim' ? b.angle * Math.PI / 180 : 0;
  const axes = [[Math.cos(ra), Math.sin(ra)], [-Math.sin(ra), Math.cos(ra)], [Math.cos(rb), Math.sin(rb)], [-Math.sin(rb), Math.cos(rb)]];
  const dx = b.sx - a.sx, dy = b.sy - a.sy;
  const ah = [(a.w + pad) / 2, (a.h + pad) / 2], bh = [(b.w + pad) / 2, (b.h + pad) / 2];
  const aa = [axes[0], axes[1]], ba = [axes[2], axes[3]];
  for (const [ax, ay] of axes) {
    const ra2 = ah[0] * Math.abs(aa[0][0] * ax + aa[0][1] * ay) + ah[1] * Math.abs(aa[1][0] * ax + aa[1][1] * ay);
    const rb2 = bh[0] * Math.abs(ba[0][0] * ax + ba[0][1] * ay) + bh[1] * Math.abs(ba[1][0] * ax + ba[1][1] * ay);
    if (Math.abs(dx * ax + dy * ay) > ra2 + rb2) return false;
  }
  return true;
}

function layoutKey(L: Layout): string {
  return `${L.fx}${L.fy}${L.fz}${L.w}${L.d}${L.h}`;
}
