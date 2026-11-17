// ─────────────────────────────────────────────────────────────
// ViewCube — Fusion 360 / Onshape-style orientation widget.
// Own tiny WebGLRenderer + ortho camera mirroring the main camera.
// Chamfered cube = 26 zones (6 faces, 12 edge bevels, 8 corner
// facets). Click a zone → viewport.setViewDirection(−Σnormals).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ViewportAPI } from '../core/contracts';
import type { ThemeTokens } from '../core/theme';
import { store, type StoreEvent } from '../core/store';
import { ensureCubeStyle, HOME_SVG } from './viewcube-style';

const SIZE = 110;          // CSS px
const CH = 0.34;           // chamfer (cube half-size = 1)
const E = 1 - CH;          // inner extent of a face square
const FRUSTUM = 2.08;

type ZoneKind = 'face' | 'edge' | 'corner';
interface Zone {
  key: string;
  kind: ZoneKind;
  /** Sum of the adjacent face normals (integers). */
  n: THREE.Vector3;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  face?: FaceDef;
}

interface FaceDef {
  label: string;
  n: THREE.Vector3;
  /** Reading direction (right) and up of the label on that face. */
  r: THREE.Vector3;
  u: THREE.Vector3;
  canvas?: HTMLCanvasElement;
  tex?: THREE.CanvasTexture;
}

const FACES: FaceDef[] = [
  { label: 'AVANT', n: new THREE.Vector3(0, -1, 0), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, 1) },
  { label: 'ARRIÈRE', n: new THREE.Vector3(0, 1, 0), r: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1) },
  { label: 'GAUCHE', n: new THREE.Vector3(-1, 0, 0), r: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(0, 0, 1) },
  { label: 'DROITE', n: new THREE.Vector3(1, 0, 0), r: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(0, 0, 1) },
  { label: 'DESSUS', n: new THREE.Vector3(0, 0, 1), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
  { label: 'DESSOUS', n: new THREE.Vector3(0, 0, -1), r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, -1, 0) },
];

/** Fake key light for a soft, Apple-ish shading of the facets. */
const LIGHT = new THREE.Vector3(0.35, -0.55, 0.76).normalize();

export class ViewCube {
  private vp: ViewportAPI;
  private root: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private cube = new THREE.Group();
  private zones: Zone[] = [];
  private edgeMat: LineMaterial;
  private edgeLines: LineSegments2;
  private axes = new THREE.Group();
  private axisMats: LineMaterial[] = [];
  private axisSprites: THREE.Sprite[] = [];
  private hover: Zone | null = null;
  private lastQ = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  private needsRender = true;
  private theme: ThemeTokens;
  private raycaster = new THREE.Raycaster();
  private down: { x: number; y: number; id: number } | null = null;
  private unsubs: (() => void)[] = [];
  private homeBtn: HTMLButtonElement;
  private disposed = false;

  constructor(viewport: ViewportAPI, host: HTMLElement) {
    this.vp = viewport;
    this.theme = viewport.getTheme();
    ensureCubeStyle();

    // DOM
    this.root = document.createElement('div');
    this.root.className = 'kd-cube';
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(SIZE, SIZE);
    this.renderer.setClearColor(0x000000, 0);
    const cv = this.renderer.domElement;
    cv.className = 'kd-cube-canvas';
    this.root.appendChild(cv);

    this.homeBtn = document.createElement('button');
    this.homeBtn.type = 'button';
    this.homeBtn.className = 'kd-cube-home';
    this.homeBtn.title = 'Vue isométrique';
    this.homeBtn.setAttribute('aria-label', 'Revenir à la vue isométrique');
    this.homeBtn.innerHTML = HOME_SVG;
    this.root.appendChild(this.homeBtn);
    host.appendChild(this.root);

    // scene
    this.camera = new THREE.OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 30);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.cube);
    this.buildCube();

    this.edgeMat = new LineMaterial({ color: 0xffffff, linewidth: 1, transparent: true, opacity: 1, worldUnits: false });
    this.edgeMat.resolution.set(SIZE, SIZE);
    this.edgeLines = new LineSegments2(this.buildEdgeGeometry(), this.edgeMat);
    this.edgeLines.renderOrder = 2;
    this.cube.add(this.edgeLines);
    this.buildAxes();
    this.applyTheme();

    // events
    this.bindEvents();
    this.unsubs.push(viewport.onAfterRender(() => this.sync()));
    this.unsubs.push(store.on((ev: StoreEvent) => {
      if (ev !== 'settings') return;
      queueMicrotask(() => {
        if (this.disposed) return;
        const t = this.vp.getTheme();
        if (t.name !== this.theme.name || t !== this.theme) { this.theme = t; this.applyTheme(); this.render(); }
      });
    }));
    this.sync(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.scene.traverse((o: any) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
    });
    for (const f of FACES) { f.tex?.dispose(); f.tex = undefined; f.canvas = undefined; }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
  }

  // ── geometry ───────────────────────────────────────────────
  private buildCube() {
    const poly = (pts: THREE.Vector3[], uvs?: number[][]) => {
      // ensure outward winding (convex, centred on origin)
      const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
      const nrm = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
      let P = pts, U = uvs;
      if (nrm.dot(c) < 0) { P = [...pts].reverse(); U = uvs ? [...uvs].reverse() : undefined; }
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      P.forEach((p, i) => { pos.push(p.x, p.y, p.z); if (U) uv.push(U[i][0], U[i][1]); });
      for (let i = 1; i < P.length - 1; i++) idx.push(0, i, i + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (U) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const addZone = (kind: ZoneKind, n: THREE.Vector3, geo: THREE.BufferGeometry, face?: FaceDef) => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.FrontSide, depthWrite: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      const key = `${n.x},${n.y},${n.z}`;
      const z: Zone = { key, kind, n, mesh, mat, face };
      mesh.userData.zone = z;
      this.cube.add(mesh);
      this.zones.push(z);
    };

    // faces
    for (const f of FACES) {
      const pts = [
        f.n.clone().addScaledVector(f.r, -E).addScaledVector(f.u, -E),
        f.n.clone().addScaledVector(f.r, E).addScaledVector(f.u, -E),
        f.n.clone().addScaledVector(f.r, E).addScaledVector(f.u, E),
        f.n.clone().addScaledVector(f.r, -E).addScaledVector(f.u, E),
      ];
      addZone('face', f.n.clone(), poly(pts, [[0, 0], [1, 0], [1, 1], [0, 1]]), f);
    }
    // edges (bevels)
    const axis = (i: number, v: number) => { const a = [0, 0, 0]; a[i] = v; return a; };
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const k = 3 - i - j;
      for (const si of [-1, 1]) for (const sj of [-1, 1]) {
        const mk = (ai: number, aj: number, ak: number) => {
          const a = [0, 0, 0]; a[i] = ai; a[j] = aj; a[k] = ak;
          return new THREE.Vector3(a[0], a[1], a[2]);
        };
        const pts = [mk(si, sj * E, -E), mk(si, sj * E, E), mk(si * E, sj, E), mk(si * E, sj, -E)];
        const n = new THREE.Vector3(...(axis(i, si) as [number, number, number])).add(new THREE.Vector3(...(axis(j, sj) as [number, number, number])));
        addZone('edge', n, poly(pts));
      }
    }
    // corners
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const pts = [new THREE.Vector3(sx, sy * E, sz * E), new THREE.Vector3(sx * E, sy, sz * E), new THREE.Vector3(sx * E, sy * E, sz)];
      addZone('corner', new THREE.Vector3(sx, sy, sz), poly(pts));
    }
  }

  private buildEdgeGeometry(): LineSegmentsGeometry {
    const pos: number[] = [];
    const S = 1.004; // a hair outside the faces → no z-fighting
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pos.push(a.x * S, a.y * S, a.z * S, b.x * S, b.y * S, b.z * S);
    for (const f of FACES) {
      const c = [
        f.n.clone().addScaledVector(f.r, -E).addScaledVector(f.u, -E),
        f.n.clone().addScaledVector(f.r, E).addScaledVector(f.u, -E),
        f.n.clone().addScaledVector(f.r, E).addScaledVector(f.u, E),
        f.n.clone().addScaledVector(f.r, -E).addScaledVector(f.u, E),
      ];
      for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]);
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p = [new THREE.Vector3(sx, sy * E, sz * E), new THREE.Vector3(sx * E, sy, sz * E), new THREE.Vector3(sx * E, sy * E, sz)];
      for (let i = 0; i < 3; i++) seg(p[i], p[(i + 1) % 3]);
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    return g;
  }

  private buildAxes() {
    // Origin corner of the cube = model min corner (left, front, bottom), like the scene origin gizmo.
    const o = new THREE.Vector3(-1, -1, -1).addScaledVector(new THREE.Vector3(-1, -1, -1).normalize(), 0.03);
    const len = 2.12;
    const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const letters = ['X', 'Y', 'Z'];
    dirs.forEach((d, i) => {
      const g = new LineSegmentsGeometry();
      const e = o.clone().addScaledVector(d, len);
      g.setPositions([o.x, o.y, o.z, e.x, e.y, e.z]);
      const m = new LineMaterial({ color: 0xffffff, linewidth: 1.6, worldUnits: false, transparent: true });
      m.resolution.set(SIZE, SIZE);
      this.axisMats.push(m);
      const l = new LineSegments2(g, m);
      l.renderOrder = 3;
      this.axes.add(l);

      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false }));
      sp.position.copy(o.clone().addScaledVector(d, len + 0.19));
      sp.scale.set(0.36, 0.36, 1);
      sp.renderOrder = 4;
      sp.userData.letter = letters[i];
      this.axisSprites.push(sp);
      this.axes.add(sp);
    });
    this.scene.add(this.axes);
  }

  // ── theme / colours ────────────────────────────────────────
  private faceBase(n: THREE.Vector3): THREE.Color {
    const t = this.theme;
    const nn = n.clone().normalize();
    const lambert = Math.max(0, nn.dot(LIGHT));
    if (t.name === 'paper') {
      const c = new THREE.Color('#ffffff');
      const k = 0.86 + 0.14 * lambert;
      return c.multiplyScalar(k);
    }
    const c = new THREE.Color(t.fill).lerp(new THREE.Color('#ffffff'), 0.03 + 0.24 * lambert);
    return c;
  }

  private zoneColor(z: Zone, hovered: boolean): THREE.Color {
    const c = this.faceBase(z.n);
    if (hovered) c.lerp(new THREE.Color(this.theme.select), this.theme.name === 'paper' ? 0.5 : 0.82);
    return c;
  }

  private applyTheme() {
    const t = this.theme;
    const paper = t.name === 'paper';
    this.root.dataset.theme = t.name;
    for (const z of this.zones) {
      z.mat.opacity = paper ? 0.86 : 0.88;
      if (z.face) this.drawFace(z, z === this.hover);
      else z.mat.color.copy(this.zoneColor(z, z === this.hover));
      z.mat.needsUpdate = true;
    }
    this.edgeMat.color.set(paper ? '#3a3a3c' : '#ffffff');
    this.edgeMat.opacity = paper ? 0.55 : 0.9;
    this.edgeMat.linewidth = paper ? 1 : 1.1;
    const ax = [t.axisX, t.axisY, t.axisZ];
    this.axisMats.forEach((m, i) => { m.color.set(ax[i]); });
    this.axisSprites.forEach((sp, i) => {
      const mat = sp.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.map = this.letterTexture(sp.userData.letter, ax[i]);
      mat.needsUpdate = true;
    });
    this.needsRender = true;
  }

  private drawFace(z: Zone, hovered: boolean) {
    const f = z.face!;
    const S = 256;
    if (!f.canvas) {
      f.canvas = document.createElement('canvas');
      f.canvas.width = f.canvas.height = S;
    }
    const ctx = f.canvas.getContext('2d')!;
    const bg = this.zoneColor(z, hovered);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = `#${bg.getHexString()}`;
    ctx.fillRect(0, 0, S, S);
    const paper = this.theme.name === 'paper';
    ctx.fillStyle = paper ? (hovered ? '#1d1d1f' : '#3a3a3c') : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = 50;
    const font = (p: number) => `600 ${p}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, "Helvetica Neue", sans-serif`;
    const c2 = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const maxW = S * 0.86;
    for (;;) {
      ctx.font = font(px);
      if ('letterSpacing' in c2) c2.letterSpacing = `${Math.round(px * 0.06)}px`;
      if (ctx.measureText(f.label).width <= maxW || px <= 24) break;
      px -= 2;
    }
    ctx.fillText(f.label, S / 2, S / 2 + px * 0.04);
    if (!f.tex) {
      f.tex = new THREE.CanvasTexture(f.canvas);
      f.tex.colorSpace = THREE.SRGBColorSpace;
      f.tex.anisotropy = 4;
      f.tex.generateMipmaps = true;
      f.tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    f.tex.needsUpdate = true;
    z.mat.map = f.tex;
    z.mat.color.set('#ffffff');
    z.mat.needsUpdate = true;
  }

  private letterTexture(letter: string, color: string): THREE.CanvasTexture {
    const S = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    ctx.font = `700 40px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(letter, S / 2, S / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── frame sync ─────────────────────────────────────────────
  private sync(force = false) {
    const q = this.vp.getCameraQuaternion();
    const same = Math.abs(q.dot(this.lastQ)) > 1 - 1e-9;
    if (!force && same && !this.needsRender) return;
    this.lastQ.copy(q);
    this.camera.quaternion.copy(q);
    this.camera.position.set(0, 0, 8).applyQuaternion(q);
    this.camera.updateMatrixWorld();
    this.render();
  }

  private render() {
    if (this.disposed) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  // ── interaction ────────────────────────────────────────────
  private bindEvents() {
    const cv = this.renderer.domElement;
    const stop = (e: Event) => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      this.root.addEventListener(ev, stop, { passive: ev !== 'contextmenu' });
    }
    this.root.addEventListener('contextmenu', e => e.preventDefault());

    cv.addEventListener('pointermove', e => {
      this.setHover(this.zoneAt(e));
    });
    cv.addEventListener('pointerleave', () => this.setHover(null));
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    cv.addEventListener('pointerup', e => {
      const d = this.down;
      this.down = null;
      if (!d || e.pointerId !== d.id) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const z = this.zoneAt(e);
      if (!z) return;
      const dir = z.n.clone().normalize().negate();
      this.vp.setViewDirection({ x: dir.x, y: dir.y, z: dir.z }, true);
      this.vp.requestRender();
    });
    this.homeBtn.addEventListener('click', () => {
      this.vp.setView('iso', true);
      this.vp.requestRender();
    });
  }

  private zoneAt(e: PointerEvent): Zone | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.zones.map(z => z.mesh), false);
    return hits.length ? (hits[0].object.userData.zone as Zone) : null;
  }

  private setHover(z: Zone | null) {
    if (z === this.hover) return;
    const prev = this.hover;
    this.hover = z;
    if (prev) { if (prev.face) this.drawFace(prev, false); else prev.mat.color.copy(this.zoneColor(prev, false)); }
    if (z) { if (z.face) this.drawFace(z, true); else z.mat.color.copy(this.zoneColor(z, true)); }
    this.renderer.domElement.style.cursor = z ? 'pointer' : '';
    this.root.classList.toggle('kd-cube-hovering', !!z);
    this.render();
  }
}
