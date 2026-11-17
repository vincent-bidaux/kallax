// ─────────────────────────────────────────────────────────────
// Viewport — renderer, scene, cameras & view transitions, grid + origin,
// item meshes (synced from the store), render modes, picking, ghost.
//
// World is Z-up, model coordinates = world coordinates (cm).
// Two cameras share one orbit target: a PerspectiveCamera and a
// ShearOrthoCamera (orthographic + optional shear = cavalier oblique view).
// Rendering is on demand: requestRender() / animations / damping only.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { GhostState, SurfaceHit, ViewportAPI } from '../core/contracts';
import { store, type StoreEvent } from '../core/store';
import { THEMES, type ThemeTokens } from '../core/theme';
import type { Projection, Settings, Vec3, ViewPreset } from '../core/types';
import { unionBox } from '../core/kallax';
import { setLineResolution } from './lines';
import { ShearOrthoCamera } from './shear-camera';
import { ItemView } from './item-view';
import { geometryKey } from './item-geometry';
import { MaterialLibrary, type VisualState } from './materials';
import { Ground } from './ground';

type FixedPreset = Exclude<ViewPreset, 'free'>;
type CamKind = 'persp' | 'ortho';

const FOV = 30;                 // perspective vertical FOV (deg) — architectural, low distortion
const ORTHO_BASE = 100;         // ortho frustum height at zoom = 1 (cm)
const ORTHO_DIST = 10000;       // ortho camera distance from the target (cm)
const ANIM_MS = 450;
const TILT = 1e-5;              // tiny tilt for straight top / bottom views (keeps lookAt stable)
const MIN_VIEW_H = 20;          // closest framing (visible height, cm)
const MAX_VIEW_H = 40000;
const Z_UP = new THREE.Vector3(0, 0, 1);
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

const PRESET_DIRS: Record<FixedPreset, THREE.Vector3> = {
  iso: new THREE.Vector3(-1, 1, -1).normalize(),     // camera at (+1, −1, +1): front-right-top
  cavalier: new THREE.Vector3(0, 1, 0),              // front view (camera at −Y)
  front: new THREE.Vector3(0, 1, 0),
  back: new THREE.Vector3(0, -1, 0),
  left: new THREE.Vector3(1, 0, 0),                  // camera on the left (−X), looking +X
  right: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, TILT, -1).normalize(),   // screen-up = +Y
  bottom: new THREE.Vector3(0, TILT, 1).normalize(),
};
const MATCHABLE: FixedPreset[] = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface PoseAnim {
  t0: number; dur: number;
  fromQ: THREE.Quaternion; toQ: THREE.Quaternion;
  fromDir: THREE.Vector3; toDir: THREE.Vector3; useDir: boolean;
  fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  fromH: number; toH: number;
}
interface ScalarAnim { t0: number; dur: number; from: number; to: number }
interface CavAnim { t0: number; dur: number; fromA: number; toA: number; fromR: number; toR: number }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

function sanitizeDir(d: Vec3): THREE.Vector3 {
  const v = new THREE.Vector3(d.x, d.y, d.z);
  if (v.lengthSq() < 1e-12) return PRESET_DIRS.iso.clone();
  v.normalize();
  if (Math.abs(v.z) > 0.99999) v.set(0, TILT, Math.sign(v.z)).normalize();
  return v;
}

/** Camera orientation looking along `dir` with world Z up. */
function quatForDir(dir: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  _v1.copy(dir).negate();            // eye relative to target
  _m.lookAt(_v1, _v2.set(0, 0, 0), Z_UP);
  return out.setFromRotationMatrix(_m);
}

function forwardOf(q: THREE.Quaternion, out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(q); }

/** Spherical interpolation of unit directions, never passing through the poles for antipodal horizontals. */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const dot = a.dot(b);
  if (dot > 0.999999) return out.copy(b);
  const q = new THREE.Quaternion();
  if (dot < -0.9999) {
    const axis = Math.abs(a.z) < 0.9 ? Z_UP : new THREE.Vector3(1, 0, 0);
    q.setFromAxisAngle(axis, Math.PI * t);
  } else {
    q.setFromUnitVectors(a, b);
    q.slerp(new THREE.Quaternion(), 1 - t); // identity → full rotation
  }
  return out.copy(a).applyQuaternion(q).normalize();
}

export class Viewport implements ViewportAPI {
  readonly container: HTMLElement;
  readonly scene = new THREE.Scene();
  readonly overlay = new THREE.Group();

  private renderer: THREE.WebGLRenderer;
  private css2d: CSS2DRenderer;
  private persp: THREE.PerspectiveCamera;
  private ortho: ShearOrthoCamera;
  private camera: THREE.PerspectiveCamera | ShearOrthoCamera;
  private controls: OrbitControls;
  private ground: Ground;
  private mats: MaterialLibrary;
  private theme: ThemeTokens;
  private itemsRoot = new THREE.Group();
  private views = new Map<string, ItemView>();
  private ghost: ItemView | null = null;
  private ghostValid = true;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private resizeObs: ResizeObserver;

  private width = 1;
  private height = 1;
  private fitted = false;
  private sceneRadius = 300;
  private extentKey = '';

  private beforeCbs = new Set<() => void>();
  private afterCbs = new Set<() => void>();
  private rafId = 0;
  private dirty = true;
  private inRender = false;
  private needsAnotherFrame = false;

  private currentView: ViewPreset;
  private shear = 0;              // 0 = plain ortho, 1 = full cavalier
  private cavA: number;           // displayed cavalier angle (deg) / ratio (animated)
  private cavR: number;
  private poseAnim: PoseAnim | null = null;
  private shearAnim: ScalarAnim | null = null;
  private cavAnim: CavAnim | null = null;
  private applyingPose = false;
  private controlsWanted = true;
  private lastSettings: Settings;
  private unsub: () => void;
  private raycastRay = new THREE.Ray();

  constructor(container: HTMLElement) {
    this.container = container;
    const s = store.settings;
    this.lastSettings = { ...s };
    this.theme = THEMES[s.theme];

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';

    // ── renderer ────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none;';
    container.appendChild(canvas);

    this.css2d = new CSS2DRenderer();
    const cssEl = this.css2d.domElement;
    cssEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.appendChild(cssEl);

    // ── scene ───────────────────────────────────────────────
    this.scene.name = 'kallax-scene';
    this.overlay.name = 'overlay';
    this.itemsRoot.name = 'items';
    this.ground = new Ground(this.theme);
    this.ground.setCell(s.gridCell);
    this.ground.setGridVisible(s.showGrid);
    this.ground.setAxesVisible(s.showAxes);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x6f7f99, 1.25);
    this.hemi.position.set(0, 0, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.ground.group, this.itemsRoot, this.overlay, this.hemi, this.sun, this.sun.target);

    // ── cameras & controls ──────────────────────────────────
    this.persp = new THREE.PerspectiveCamera(FOV, 1, 1, 50000);
    this.persp.up.copy(Z_UP);
    this.ortho = new ShearOrthoCamera(-ORTHO_BASE / 2, ORTHO_BASE / 2, ORTHO_BASE / 2, -ORTHO_BASE / 2, 1, ORTHO_DIST * 3);
    this.ortho.up.copy(Z_UP);
    this.currentView = s.view;
    this.shear = s.view === 'cavalier' ? 1 : 0;
    this.cavA = s.cavalierAngle;
    this.cavR = s.cavalierRatio;
    this.camera = this.desiredKind() === 'persp' ? this.persp : this.ortho;

    this.controls = new OrbitControls(this.camera, canvas);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.14;
    c.rotateSpeed = 0.8;
    c.panSpeed = 1;
    c.zoomSpeed = 1.1;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.maxPolarAngle = Math.PI / 2;
    c.minZoom = ORTHO_BASE / MAX_VIEW_H;
    c.maxZoom = ORTHO_BASE / MIN_VIEW_H;
    this.configureControlsFor(this.camera);
    c.addEventListener('change', this.onControlsChange);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── materials, items ────────────────────────────────────
    this.mats = new MaterialLibrary(this.theme, { shadows: s.shadows, transparency: s.transparency });
    this.applyModeFlags();
    this.applyBackground();
    this.syncItems();

    // ── initial pose ────────────────────────────────────────
    const preset: FixedPreset = s.view === 'free' ? 'iso' : s.view;
    this.applyPose(quatForDir(PRESET_DIRS[preset]), new THREE.Vector3(), 400);
    this.resize(); // fits the content as soon as the container has a size

    this.unsub = store.on(this.onStore);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.requestRender();
  }

  // ════════════════════════════════════════════════════════
  // ViewportAPI — basics
  // ════════════════════════════════════════════════════════
  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.camera; }
  getRenderer(): THREE.WebGLRenderer { return this.renderer; }
  getTheme(): ThemeTokens { return THEMES[store.settings.theme]; }
  getSize() { return { width: this.width, height: this.height }; }

  onBeforeRender(cb: () => void): () => void {
    this.beforeCbs.add(cb);
    return () => { this.beforeCbs.delete(cb); };
  }
  onAfterRender(cb: () => void): () => void {
    this.afterCbs.add(cb);
    return () => { this.afterCbs.delete(cb); };
  }
  requestRender(): void {
    // Called from inside a frame (e.g. an onBefore/AfterRender callback):
    // draw another frame once this one completes.
    if (this.inRender) { this.needsAnotherFrame = true; return; }
    this.dirty = true;
    this.schedule();
  }

  setControlsEnabled(on: boolean): void {
    this.controlsWanted = on;
    this.refreshControlsEnabled();
  }

  // ════════════════════════════════════════════════════════
  // Picking
  // ════════════════════════════════════════════════════════
  /** Pointer ray, built by unprojecting NDC near/far points (correct for the sheared camera too). */
  private rayAt(clientX: number, clientY: number): THREE.Ray {
    const r = this.container.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    const y = -((clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
    this.updateCameraDepth();
    const near = _v1.set(x, y, -1).unproject(this.camera);
    const far = _v2.set(x, y, 1).unproject(this.camera);
    this.raycastRay.origin.copy(near);
    this.raycastRay.direction.copy(far).sub(near).normalize();
    return this.raycastRay;
  }

  pickItem(clientX: number, clientY: number): string | null {
    const ray = this.rayAt(clientX, clientY);
    let best: string | null = null, bestT = Infinity;
    for (const v of this.views.values()) {
      const p = ray.intersectBox(v.box, _v3);
      if (!p) continue;
      const t = p.distanceTo(ray.origin);
      if (t < bestT) { bestT = t; best = v.item.id; }
    }
    return best;
  }

  raycastSurface(clientX: number, clientY: number, ignoreIds?: string[]): SurfaceHit | null {
    const ray = this.rayAt(clientX, clientY);
    const ignore = new Set(ignoreIds ?? []);
    let bestT = Infinity;
    let hit: SurfaceHit | null = null;
    const p = new THREE.Vector3();
    for (const v of this.views.values()) {
      if (ignore.has(v.item.id)) continue;
      if (!ray.intersectBox(v.box, p)) continue;
      const t = p.distanceTo(ray.origin);
      if (t >= bestT) continue;
      bestT = t;
      hit = { point: { x: p.x, y: p.y, z: p.z }, normal: boxFaceNormal(v.box, p, ray.direction), itemId: v.item.id };
    }
    // ground plane z = 0 (seen from above)
    if (ray.direction.z < -1e-9) {
      const t = -ray.origin.z / ray.direction.z;
      if (t > 0 && t < bestT) {
        ray.at(t, p);
        hit = { point: { x: p.x, y: p.y, z: 0 }, normal: { x: 0, y: 0, z: 1 }, itemId: null };
      }
    }
    return hit;
  }

  rayToPlane(clientX: number, clientY: number, normal: Vec3, constant: number): Vec3 | null {
    const ray = this.rayAt(clientX, clientY);
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const plane = new THREE.Plane(n, -constant);
    const out = new THREE.Vector3();
    if (!ray.intersectPlane(plane, out)) return null;
    return { x: out.x, y: out.y, z: out.z };
  }

  worldToScreen(p: Vec3): { x: number; y: number; visible: boolean } {
    this.updateCameraDepth();
    const v = _v3.set(p.x, p.y, p.z).project(this.camera);
    return {
      x: (v.x + 1) / 2 * this.width,
      y: (1 - v.y) / 2 * this.height,
      visible: v.z >= -1 && v.z <= 1,
    };
  }

  // ════════════════════════════════════════════════════════
  // Ghost
  // ════════════════════════════════════════════════════════
  setGhost(g: GhostState | null): void {
    if (!g) {
      if (this.ghost) { this.ghost.dispose(); this.ghost = null; this.requestRender(); }
      return;
    }
    if (!this.ghost || this.ghost.geoKey !== geometryKey(g.item) || this.ghost.item.kind !== g.item.kind) {
      this.ghost?.dispose();
      this.ghost = new ItemView(g.item, true);
      this.scene.add(this.ghost.group);
      this.ghostValid = !g.valid; // force material assignment below
    } else {
      this.ghost.setItem(g.item);
    }
    if (this.ghostValid !== g.valid || this.ghost.face.material !== this.mats.ghost[g.valid ? 'ok' : 'bad'].face) {
      this.ghost.applyGhostMaterials(this.mats, g.valid);
      this.ghostValid = g.valid;
    }
    this.requestRender();
  }

  // ════════════════════════════════════════════════════════
  // Camera API
  // ════════════════════════════════════════════════════════
  setView(preset: ViewPreset, animate = true): void {
    if (preset === 'free') { this.becomeFree(); return; }
    this.currentView = preset;
    if (store.settings.view !== preset) store.setSettings({ view: preset });
    this.goTo(PRESET_DIRS[preset], preset === 'cavalier' ? 1 : 0, animate);
  }

  setViewDirection(dir: Vec3, animate = true): void {
    const d = sanitizeDir(dir);
    for (const p of MATCHABLE) {
      if (d.angleTo(PRESET_DIRS[p]) < 0.01) { this.setView(p, animate); return; }
    }
    this.currentView = 'free';
    if (store.settings.view !== 'free') store.setSettings({ view: 'free' });
    this.goTo(d, 0, animate);
  }

  setProjection(p: Projection): void {
    if (store.settings.projection !== p) store.setSettings({ projection: p }); // → onSettings
    else this.reconcileProjection();
  }

  zoomToFit(animate = true): void {
    const q = this.poseAnim ? this.poseAnim.toQ.clone() : this.camera.quaternion.clone();
    const shearTo = this.shearAnim ? this.shearAnim.to : this.shear;
    const kind: CamKind = this.camera === this.persp ? 'persp' : (shearTo > 0 ? 'ortho' : this.settingsKind());
    const fit = this.computeFit(q, this.shearVector(shearTo, this.cavTargetA(), this.cavTargetR()), kind);
    if (!animate) {
      this.poseAnim = null;
      this.applyPose(q, fit.target, fit.H);
      this.syncControls();
      this.requestRender();
      return;
    }
    this.startPoseAnim(q, fit.target, fit.H);
  }

  getViewDirection(): Vec3 {
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    return { x: d.x, y: d.y, z: d.z };
  }

  getCameraQuaternion(): THREE.Quaternion {
    // In cavalier the camera itself IS the front view (the shear lives in the projection).
    return this.camera.quaternion.clone();
  }

  dispose() {
    this.unsub();
    this.resizeObs.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.controls.dispose();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.ghost?.dispose();
    this.mats.dispose();
    this.ground.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css2d.domElement.remove();
  }

  // ════════════════════════════════════════════════════════
  // Camera internals
  // ════════════════════════════════════════════════════════
  private settingsKind(): CamKind { return store.settings.projection === 'perspective' ? 'persp' : 'ortho'; }
  /** Camera kind wanted right now (cavalier and any residual shear force ortho). */
  private desiredKind(): CamKind {
    if (this.currentView === 'cavalier' || this.shear > 0 || this.shearAnim) return 'ortho';
    return this.settingsKind();
  }
  private cavTargetA() { return this.cavAnim ? this.cavAnim.toA : this.cavA; }
  private cavTargetR() { return this.cavAnim ? this.cavAnim.toR : this.cavR; }

  private shearVector(shear: number, angleDeg: number, ratio: number) {
    const a = THREE.MathUtils.degToRad(angleDeg);
    return { x: shear * ratio * Math.cos(a), y: shear * ratio * Math.sin(a) };
  }

  /** Visible world height at the target plane. */
  private currentH(): number {
    if (this.camera === this.persp) {
      return 2 * this.persp.position.distanceTo(this.controls.target) * TAN_HALF_FOV;
    }
    return ORTHO_BASE / this.ortho.zoom;
  }

  /** Place the active camera: orientation q, orbit target, visible height H at the target. */
  private applyPose(q: THREE.Quaternion, target: THREE.Vector3, H: number) {
    this.applyingPose = true;
    H = THREE.MathUtils.clamp(H, MIN_VIEW_H, MAX_VIEW_H);
    const fwd = forwardOf(q, new THREE.Vector3());
    const cam = this.camera;
    cam.quaternion.copy(q);
    if (cam === this.persp) {
      cam.position.copy(target).addScaledVector(fwd, -H / (2 * TAN_HALF_FOV));
    } else {
      cam.position.copy(target).addScaledVector(fwd, -ORTHO_DIST);
      this.ortho.zoom = ORTHO_BASE / H;
    }
    this.controls.target.copy(target);
    cam.updateMatrixWorld();
    this.updateCameraDepth();
    this.applyingPose = false;
  }

  /** Switch the active camera keeping the same apparent framing. */
  private useCamera(kind: CamKind) {
    const next = kind === 'persp' ? this.persp : this.ortho;
    if (next === this.camera) return;
    const q = this.camera.quaternion.clone();
    const target = this.controls.target.clone();
    const H = this.currentH();
    this.camera = next;
    this.applyPose(q, target, H);
    this.controls.object = next;
    this.configureControlsFor(next);
    this.syncControls();
    this.requestRender();
  }

  private configureControlsFor(cam: THREE.Camera) {
    const c = this.controls;
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
      c.minDistance = MIN_VIEW_H / (2 * TAN_HALF_FOV);
      c.maxDistance = MAX_VIEW_H / (2 * TAN_HALF_FOV);
    } else {
      c.minDistance = 0;
      c.maxDistance = Infinity;
    }
  }

  private reconcileProjection() {
    if (this.poseAnim) return; // handled at the end of the animation
    this.useCamera(this.desiredKind());
  }

  /** Near/far (perspective) and shear pivot (ortho) — cheap, done every frame and before picking. */
  private updateCameraDepth() {
    const cam = this.camera;
    if (cam === this.persp) {
      const d = cam.position.distanceTo(this.controls.target);
      const near = THREE.MathUtils.clamp(d * 0.01, 0.5, 200);
      const far = Math.max(d * 40, d + this.sceneRadius * 6, 5000);
      if (Math.abs(near - cam.near) > 1e-6 || Math.abs(far - cam.far) > 1e-3) {
        cam.near = near; cam.far = far;
        cam.updateProjectionMatrix();
      }
    } else {
      const o = this.ortho;
      const k = this.shearVector(this.shear, this.cavA, this.cavR);
      const fwd = forwardOf(o.quaternion, _v1);
      o.pivotDepth = _v2.copy(this.controls.target).sub(o.position).dot(fwd);
      o.shearX = Math.abs(k.x) < 1e-9 ? 0 : k.x;
      o.shearY = Math.abs(k.y) < 1e-9 ? 0 : k.y;
      o.near = 1;
      o.far = ORTHO_DIST * 3;
      o.updateProjectionMatrix();
    }
  }

  /** Kill residual inertia and re-sync OrbitControls with the camera after we moved it. */
  private syncControls() {
    const c = this.controls as any;
    c._sphericalDelta?.set(0, 0, 0);
    c._panOffset?.set(0, 0, 0);
    if (typeof c._scale === 'number') c._scale = 1;
    // Manual orbit stays above the floor (looking from below is disorienting);
    // the "DESSOUS" ViewCube face can still go there on purpose.
    const below = this.camera.position.z < this.controls.target.z - 1e-3;
    this.controls.maxPolarAngle = below ? Math.PI : Math.PI / 2;
    this.applyingPose = true;
    this.controls.update();
    this.applyingPose = false;
    this.refreshControlsEnabled();
  }

  private refreshControlsEnabled() {
    this.controls.enabled = this.controlsWanted && !this.poseAnim;
  }

  /** Bounds to frame: visible items, or a 2 m area around the origin. */
  private contentBox(): THREE.Box3 {
    const b = unionBox(store.visibleItems());
    if (!b) return new THREE.Box3(new THREE.Vector3(-100, -100, 0), new THREE.Vector3(100, 100, 0));
    return new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z));
  }

  /** Target + visible height framing the content for orientation q (and screen shear k). */
  private computeFit(q: THREE.Quaternion, k: { x: number; y: number }, kind: CamKind): { target: THREE.Vector3; H: number } {
    const box = this.contentBox();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = forwardOf(q);
    const c = box.getCenter(new THREE.Vector3());
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxDz = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const dz = p.dot(fwd);
      const sx = p.dot(right) + k.x * dz;
      const sy = p.dot(up) + k.y * dz;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      maxDz = Math.max(maxDz, Math.abs(dz));
    }
    const target = c.clone()
      .addScaledVector(right, (minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2);
    const aspect = this.width / Math.max(1, this.height);
    const ext = Math.max(maxY - minY, (maxX - minX) / aspect);
    // margin for dimension lines / labels (~25 % + a constant for small items)
    let H = ext * 1.3 + 50;
    if (kind === 'persp') H += 2 * maxDz * TAN_HALF_FOV;
    return { target, H };
  }

  /** Animate (or jump) to look along `dir`, with final shear `shearTo`, refitting the content. */
  private goTo(dir: THREE.Vector3, shearTo: number, animate: boolean) {
    const toQ = quatForDir(dir);
    const finalKind: CamKind = shearTo > 0 ? 'ortho' : this.settingsKind();
    // During a shear transition the ortho camera is required.
    if (shearTo > 0 || this.shear > 0) this.useCamera('ortho');
    else this.useCamera(finalKind);
    const fit = this.computeFit(toQ, this.shearVector(shearTo, this.cavTargetA(), this.cavTargetR()), finalKind);

    if (!animate) {
      this.poseAnim = null;
      this.shearAnim = null;
      this.shear = shearTo;
      this.applyPose(toQ, fit.target, fit.H);
      this.useCamera(this.desiredKind());
      this.syncControls();
      this.requestRender();
      return;
    }
    if (shearTo !== this.shear) {
      this.shearAnim = { t0: performance.now(), dur: ANIM_MS, from: this.shear, to: shearTo };
    }
    this.startPoseAnim(toQ, fit.target, fit.H);
  }

  private startPoseAnim(toQ: THREE.Quaternion, toTarget: THREE.Vector3, toH: number) {
    const fromQ = this.camera.quaternion.clone();
    const fromDir = forwardOf(fromQ);
    const toDir = forwardOf(toQ);
    this.poseAnim = {
      t0: performance.now(), dur: ANIM_MS,
      fromQ, toQ: toQ.clone(),
      fromDir, toDir,
      // Direction slerp + Z-up lookAt keeps the horizon level; near the poles use the quaternion.
      useDir: Math.abs(fromDir.z) < 0.98 && Math.abs(toDir.z) < 0.98,
      fromTarget: this.controls.target.clone(), toTarget: toTarget.clone(),
      fromH: this.currentH(), toH: THREE.MathUtils.clamp(toH, MIN_VIEW_H, MAX_VIEW_H),
    };
    this.refreshControlsEnabled();
    this.requestRender();
  }

  private becomeFree() {
    if (this.currentView === 'free') return;
    const wasCav = this.currentView === 'cavalier';
    this.currentView = 'free';
    if (wasCav && this.shear > 0) {
      this.shearAnim = { t0: performance.now(), dur: ANIM_MS, from: this.shear, to: 0 };
    }
    if (store.settings.view !== 'free') store.setSettings({ view: 'free' });
    this.requestRender();
  }

  private onControlsChange = () => {
    this.dirty = true;
    this.schedule();
    if (this.applyingPose || this.poseAnim || this.currentView === 'free') return;
    // User orbited away from the preset? (pan & zoom keep the direction.)
    const dir = this.camera.getWorldDirection(_v3);
    if (dir.angleTo(PRESET_DIRS[this.currentView as FixedPreset]) > 0.003) this.becomeFree();
  };

  // ════════════════════════════════════════════════════════
  // Frame loop
  // ════════════════════════════════════════════════════════
  private schedule() {
    if (!this.rafId) this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.rafId = 0;
    let animating = false;

    if (this.poseAnim) { this.stepPose(now); animating = true; }
    if (this.shearAnim) {
      const a = this.shearAnim;
      const t = Math.min(1, (now - a.t0) / a.dur);
      this.shear = a.from + (a.to - a.from) * easeInOut(t);
      if (t >= 1) { this.shear = a.to; this.shearAnim = null; }
      animating = true;
    }
    if (this.cavAnim) {
      const a = this.cavAnim;
      const t = Math.min(1, (now - a.t0) / a.dur), e = easeInOut(t);
      this.cavA = a.fromA + (a.toA - a.fromA) * e;
      this.cavR = a.fromR + (a.toR - a.fromR) * e;
      if (t >= 1) this.cavAnim = null;
      animating = true;
    }
    if (!this.poseAnim) {
      if (!this.shearAnim) this.useCamera(this.desiredKind());
      if (this.controls.update()) animating = true; // damping tail
    }

    if (this.dirty || animating) this.renderNow();
    if (animating) this.schedule();
  };

  private stepPose(now: number) {
    const a = this.poseAnim!;
    const t = Math.min(1, (now - a.t0) / a.dur);
    const e = easeInOut(t);
    let q: THREE.Quaternion;
    if (t >= 1) q = a.toQ;
    else if (a.useDir) q = quatForDir(slerpDir(a.fromDir, a.toDir, e));
    else q = a.fromQ.clone().slerp(a.toQ, e);
    const target = new THREE.Vector3().lerpVectors(a.fromTarget, a.toTarget, e);
    const H = Math.exp(Math.log(a.fromH) + (Math.log(a.toH) - Math.log(a.fromH)) * e);
    this.applyPose(q, target, H);
    if (t >= 1) {
      this.poseAnim = null;
      if (!this.shearAnim) this.useCamera(this.desiredKind());
      this.syncControls();
    }
  }

  private renderNow() {
    this.inRender = true;
    this.needsAnotherFrame = false;
    this.dirty = false;
    try {
      this.camera.updateMatrixWorld();
      this.updateCameraDepth();
      this.mats.setPxPerCm(this.height / this.currentH());
      for (const cb of this.beforeCbs) { try { cb(); } catch (e) { console.error(e); } }
      this.renderer.render(this.scene, this.camera);
      this.css2d.render(this.ground.labelScene, this.camera);
      for (const cb of this.afterCbs) { try { cb(); } catch (e) { console.error(e); } }
    } finally {
      this.inRender = false;
    }
    if (this.needsAnotherFrame) {
      this.needsAnotherFrame = false;
      this.dirty = true;
      this.schedule();
    }
  }

  private resize() {
    const w = Math.max(1, Math.round(this.container.clientWidth));
    const h = Math.max(1, Math.round(this.container.clientHeight));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.css2d.setSize(w, h);
    setLineResolution(w, h);
    const aspect = w / h;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.ortho.left = -ORTHO_BASE / 2 * aspect;
    this.ortho.right = ORTHO_BASE / 2 * aspect;
    this.ortho.top = ORTHO_BASE / 2;
    this.ortho.bottom = -ORTHO_BASE / 2;
    this.ortho.updateProjectionMatrix();
    if (!this.fitted && w > 1 && h > 1 && this.controls) {
      this.fitted = true;
      this.zoomToFit(false);
    }
    if (this.controls) this.renderNow(); // avoid a blank frame after the canvas resize
  }

  // ════════════════════════════════════════════════════════
  // Store sync
  // ════════════════════════════════════════════════════════
  private onStore = (ev: StoreEvent) => {
    switch (ev) {
      case 'doc': this.syncItems(); break;
      case 'selection':
      case 'hover': this.applyStates(); break;
      case 'settings': this.onSettings(); break;
    }
  };

  private onSettings() {
    const s = store.settings;
    const prev = this.lastSettings;
    this.lastSettings = { ...s };

    if (s.theme !== prev.theme || s.shadows !== prev.shadows || s.transparency !== prev.transparency) {
      this.applyMode(s.theme !== prev.theme);
    }
    if (s.gridCell !== prev.gridCell) this.ground.setCell(s.gridCell);
    if (s.showGrid !== prev.showGrid) this.ground.setGridVisible(s.showGrid);
    if (s.showAxes !== prev.showAxes) this.ground.setAxesVisible(s.showAxes);

    if (s.cavalierAngle !== prev.cavalierAngle || s.cavalierRatio !== prev.cavalierRatio) {
      this.cavAnim = { t0: performance.now(), dur: ANIM_MS, fromA: this.cavA, toA: s.cavalierAngle, fromR: this.cavR, toR: s.cavalierRatio };
      if (this.currentView === 'cavalier') this.zoomToFit(true);
    }
    if (s.view !== this.currentView) {
      if (s.view === 'free') this.becomeFree();
      else this.setView(s.view, true);
    } else if (s.projection !== prev.projection) {
      this.reconcileProjection();
    }
    this.requestRender();
  }

  private applyBackground() {
    const t = this.theme;
    this.container.style.background = `radial-gradient(ellipse 120% 110% at 50% 42%, ${t.bg} 0%, ${t.bg} 35%, ${t.bgVignette} 100%)`;
  }

  private applyModeFlags() {
    const s = store.settings;
    this.renderer.shadowMap.enabled = s.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.hemi.visible = s.shadows;
    this.sun.visible = s.shadows;
    this.ground.setShadowsVisible(s.shadows);
  }

  private applyMode(themeChanged: boolean) {
    const s = store.settings;
    this.theme = THEMES[s.theme];
    const old = this.mats;
    this.mats = new MaterialLibrary(this.theme, { shadows: s.shadows, transparency: s.transparency });
    for (const v of this.views.values()) v.applyMaterials(this.mats, v.state);
    if (this.ghost) this.ghost.applyGhostMaterials(this.mats, this.ghostValid);
    old.dispose();
    this.applyModeFlags();
    if (themeChanged) {
      this.ground.setTheme(this.theme);
      this.applyBackground();
    }
    this.requestRender();
  }

  private stateOf(id: string): VisualState {
    if (store.selection.includes(id)) return 'select';
    if (store.hover === id) return 'hover';
    return 'normal';
  }

  private applyStates() {
    for (const v of this.views.values()) {
      const st = this.stateOf(v.item.id);
      if (st !== v.state) v.applyMaterials(this.mats, st);
    }
    this.requestRender();
  }

  private syncItems() {
    const items = store.visibleItems();
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      let v = this.views.get(it.id);
      if (!v) {
        v = new ItemView(it);
        this.itemsRoot.add(v.group);
        this.views.set(it.id, v);
        v.applyMaterials(this.mats, this.stateOf(it.id));
      } else {
        const kindBefore = v.item.kind;
        v.setItem(it);
        if (v.item.kind !== kindBefore) v.applyMaterials(this.mats, v.state);
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
    this.updateExtent(items.length ? unionBox(items) : null);
    this.applyStates();
  }

  /** Grid extent (bbox + 2 m, min 6 × 6 m) and the shadow light frustum. */
  private updateExtent(b: ReturnType<typeof unionBox>) {
    const M = 200;
    const minX = Math.floor(Math.min(-300, (b?.min.x ?? 0) - M) / 100) * 100;
    const minY = Math.floor(Math.min(-300, (b?.min.y ?? 0) - M) / 100) * 100;
    const maxX = Math.ceil(Math.max(300, (b?.max.x ?? 0) + M) / 100) * 100;
    const maxY = Math.ceil(Math.max(300, (b?.max.y ?? 0) + M) / 100) * 100;
    const key = `${minX},${minY},${maxX},${maxY},${b ? b.max.z : 0}`;
    if (key === this.extentKey) return;
    this.extentKey = key;
    this.ground.setExtent(minX, minY, maxX, maxY);

    const c = b
      ? new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
      : new THREE.Vector3();
    const size = b ? new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) : new THREE.Vector3(200, 200, 100);
    const R = Math.max(150, size.length() / 2 + 120);
    this.sceneRadius = Math.max(R, Math.hypot(maxX - minX, maxY - minY) / 2);
    // sun from the front-left-top
    const L = new THREE.Vector3(-0.55, -0.9, 1.5).normalize();
    this.sun.position.copy(c).addScaledVector(L, R * 2.5);
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = -R * 1.25; sc.right = R * 1.25; sc.top = R * 1.25; sc.bottom = -R * 1.25;
    sc.near = 1; sc.far = R * 5;
    sc.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }
}

/** Axis-aligned outward normal of the box face containing p (the face the ray entered). */
function boxFaceNormal(b: THREE.Box3, p: THREE.Vector3, rayDir: THREE.Vector3): Vec3 {
  const cand: [number, Vec3][] = [
    [Math.abs(p.x - b.min.x), { x: -1, y: 0, z: 0 }],
    [Math.abs(p.x - b.max.x), { x: 1, y: 0, z: 0 }],
    [Math.abs(p.y - b.min.y), { x: 0, y: -1, z: 0 }],
    [Math.abs(p.y - b.max.y), { x: 0, y: 1, z: 0 }],
    [Math.abs(p.z - b.min.z), { x: 0, y: 0, z: -1 }],
    [Math.abs(p.z - b.max.z), { x: 0, y: 0, z: 1 }],
  ];
  let best = cand[0];
  for (const c of cand) {
    // prefer faces facing the ray when distances tie (edges / corners)
    const facing = c[1].x * rayDir.x + c[1].y * rayDir.y + c[1].z * rayDir.z < 0;
    const bestFacing = best[1].x * rayDir.x + best[1].y * rayDir.y + best[1].z * rayDir.z < 0;
    if (c[0] < best[0] - 1e-4 || (Math.abs(c[0] - best[0]) <= 1e-4 && facing && !bestFacing)) best = c;
  }
  return best[1];
}
