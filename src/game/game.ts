// ─────────────────────────────────────────────────────────────
// Game mode — easter egg of the walk mode ("Visite"): pressing T while
// walking lazily loads this chunk (src/game/index.ts) and hands over the
// walker (position, heading, pitch, adult / child, sound); the walk mode
// exits and the game starts on the same spot, fists raised, its HUD
// revealed with a short animation. Quitting returns to the editor.
//
// Isolated from the app: it reads a deep-cloned snapshot of the document,
// owns its renderer / canvas (full-screen overlay), scene, cameras, loop,
// audio context and listeners, and disposes all of it on exit — the app,
// whose render loop is on-demand and idle meanwhile, is left as it was.
// The overlay captures the keyboard (app shortcuts never fire) and the
// pointer.
//
// Controls: click → pointer lock; mouse aims; ZQSD / WASD move (event.code),
// ↑ / ↓ forward / back, ← / → turn (120°/s); ⇧ run, Space jump, C crouch;
// T cycles none → fists → shotgun; left click punches / shoots (hold to
// repeat); M sound; Esc → pause card, Esc again → quit.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { DesignDoc, Item } from '../core/types';
import { itemBox, unionBox } from '../core/kallax';
import { HUMAN_EYE, HUMAN_HEIGHT } from '../core/objects-human';
import { itemOBB } from '../core/obb';
import { orientDir } from '../core/orient';
import { gt } from './i18n';
import { Hud } from './hud';
import { GameAudio } from './audio';
import { GameMaterials } from './materials';
import { buildScene, disposeScene, visibleItems, type BuiltScene, type GameItem } from './scene-build';
import { buildGround, buildSky, buildSkyline, HORIZON, type Bounds } from './environment';
import { parquetTexture, PARQUET_CM } from './textures';
import { linearFog } from './geom';
import { Walker, buildColliders, findFree, spawnPoint, type Collider, type WalkInput } from './world';
import { ViewModel, PUNCH_HIT_AT, type Weapon } from './viewmodel';
import { Effects } from './fx';
import { Destruction } from './destruction';

const FOV = 70;
const bodyOf = (child: boolean) => child
  ? { height: HUMAN_HEIGHT.child, eye: HUMAN_EYE.child, radius: 16 }
  : { height: HUMAN_HEIGHT.adult, eye: HUMAN_EYE.adult, radius: 20 };
const PITCH_MAX = THREE.MathUtils.degToRad(85);
const LOOK_RAD_PER_PX = 0.0022;
const TURN_SPEED = THREE.MathUtils.degToRad(120);
const PUNCH_COOLDOWN = 0.45;
const SHOTGUN_COOLDOWN = 0.9;
const FIST_REACH = 75;            // cm beyond the body (horizontal), see doPunchHit
const SHOTGUN_RANGE = 1500;
const PELLETS = 8;
const PELLET_HALF_ANGLE = THREE.MathUtils.degToRad(2.6);
const WEAPONS: Weapon[] = ['none', 'fists', 'shotgun'];

type Phase = 'start' | 'running' | 'paused' | 'win';

/** Walker state handed over by the walk mode. */
export interface GameStart {
  x: number; y: number; z: number;
  /** Radians (0 = +X, counter-clockwise) / radians, up > 0. */
  yaw: number; pitch: number;
  child: boolean;
  sound: boolean;
}

export interface GameOptions {
  /** Document snapshot (read only). */
  doc: DesignDoc;
  /** Start from the walk mode's walker; else in front of the scene. */
  from?: GameStart;
  /** Spawn direction when there is no `from`. */
  viewDir?: { x: number; y: number; z: number };
  onExit?: () => void;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Game {
  active = false;
  private phase: Phase = 'start';
  private snapshot: DesignDoc;
  private hud = new Hud();
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(FOV, 1, 5, 200000);
  private vm = new ViewModel();
  private mats = new GameMaterials();
  readonly audio = new GameAudio();
  private fx = new Effects();
  private built!: BuiltScene;
  private colliders: Collider[] = [];
  private walker!: Walker;
  private destruction!: Destruction;
  private env: { dispose(): void }[] = [];
  private sun = new THREE.DirectionalLight('#fff0d8', 3.4);
  /** Muzzle flash light: a directional light from the camera (no PointLight: see geom.ts). */
  private muzzle = new THREE.DirectionalLight('#ffb35a', 0);
  private floor!: THREE.Mesh;
  private bounds!: Bounds;
  private raf = 0;
  private last = 0;
  private lastReal = 0;
  /** Test hook: draw without advancing time (deterministic screenshots). */
  frozen = false;
  private time = 0;
  private playTime = 0;
  private keys = new Set<string>();
  private input: WalkInput = { forward: 0, side: 0, run: false, crouch: false, jump: false };
  private lookAcc = { dx: 0, dy: 0 };
  private weapon: Weapon = 'none';
  private cooldown = 0;
  private pendingPunch = -1;
  private mouseHeld = false;
  private kick = 0;
  private shake = 0;
  private flashT = -1;
  private winAt = -1;
  private destructibles = 0;
  private lockedOnce = false;
  private dragLook = false;
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private pausedAt = 0;
  private soundOn = true;
  /** The game UI has been revealed (first T press); it stays for the session. */
  private revealed = false;
  private cleanup: (() => void)[] = [];
  private inertSaved: [HTMLElement, boolean][] = [];
  private prevFocus: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private raycaster = new THREE.Raycaster();
  readonly stats = { punches: 0, shots: 0, hits: 0, whiffs: 0, frames: 0, fpsAvg: 0, lastPunch: '' as string };

  constructor(private o: GameOptions) {
    this.snapshot = JSON.parse(JSON.stringify(o.doc)) as DesignDoc;
    this.body = bodyOf(!!o.from?.child);
    this.soundOn = o.from ? o.from.sound : true;
  }
  private body: { height: number; eye: number; radius: number };

  // ── lifecycle ──────────────────────────────────────────────
  enter() {
    if (this.active) return;
    this.active = true;
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.prevFocus?.blur?.();
    for (const id of ['app', 'toolbar', 'sidebar', 'inspector', 'statusbar']) {
      const e = document.getElementById(id);
      if (e) { this.inertSaved.push([e, e.inert]); e.inert = true; }
    }
    this.hud.mount();
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    r.domElement.className = 'kg-canvas';
    this.renderer = r;
    this.hud.root.prepend(r.domElement);
    this.buildWorld(true);
    this.hud.setWeapon('none', false);
    this.hud.setSound(this.soundOn);
    this.audio.setMuted(!this.soundOn);
    this.hud.setCard(null);
    this.hud.setHudVisible(true);
    this.listen();
    this.resize();
    this.hud.root.focus({ preventScroll: true });
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
    // straight into the action (the T key press that got us here is a user
    // gesture): pointer lock, fists raised, HUD revealed
    this.handover = true;
    this.start();
    this.reveal();
    this.setWeapon('fists');
  }
  /** Started from the walk mode: if the pointer lock is refused, show the card (click to play). */
  private handover = false;

  exit() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) { try { f(); } catch { /* ignore */ } }
    this.cleanup = [];
    this.resizeObs?.disconnect();
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.dispose();
    this.destruction?.clear();
    if (this.built) disposeScene(this.built);
    this.fx.dispose();
    this.vm.dispose();
    for (const e of this.env) e.dispose();
    this.env = [];
    this.sun.shadow.dispose();
    this.mats.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.hud.unmount();
    for (const [e, v] of this.inertSaved) e.inert = v;
    this.inertSaved = [];
    if (this.prevFocus && this.prevFocus !== document.body && this.prevFocus.isConnected) this.prevFocus.focus({ preventScroll: true });
    this.o.onExit?.();
  }

  /** Scene from the snapshot (also used by "Rejouer"). */
  private buildWorld(first: boolean) {
    const doc = this.snapshot;
    const items = visibleItems(doc).filter(i => !(i.kind === 'block' && i.shape === 'human'));
    const ub = unionBox(items);
    const b: Bounds = ub ? { minX: ub.min.x, minY: ub.min.y, maxX: ub.max.x, maxY: ub.max.y, maxZ: ub.max.z } : { minX: -300, minY: -300, maxX: 300, maxY: 300, maxZ: 250 };
    this.bounds = b;
    if (first) this.buildEnvironment(items, b);
    this.built = buildScene(doc, this.mats);
    this.scene.add(this.built.root);
    this.colliders = buildColliders(items);
    this.walker = new Walker(this.colliders, this.body);
    const f = this.o.from;
    if (f) {
      const p = findFree(this.walker, f.x, f.y);
      this.walker.place(p.x, p.y, f.z);
      this.walker.yaw = f.yaw;
      this.walker.pitch = f.pitch;
    } else {
      const p = spawnPoint(items, this.walker, this.o.viewDir ?? { x: 0, y: 1, z: 0 });
      this.walker.place(p.x, p.y, 0);
      this.walker.yaw = p.yaw;
      this.walker.pitch = THREE.MathUtils.degToRad(-6);
    }
    this.destruction = new Destruction(this.built, this.colliders, this.fx, this.audio);
    this.destruction.panOf = (q) => this.panOf(q);
    this.destruction.onItemDestroyed = () => this.hud.setCompletion(this.destruction.completion());
    this.scene.add(this.destruction.root);
    this.destructibles = this.built.items.filter(g => g.destructible).length;
    this.hud.setCompletion(0);
    this.winAt = -1;
    this.playTime = 0;
    this.placeCamera(0);
  }

  private buildEnvironment(items: Item[], b: Bounds) {
    const s = this.scene;
    s.background = HORIZON.clone();
    s.fog = linearFog(HORIZON.clone(), 3000, 60000);
    // sun through the biggest window (else from the front-left)
    const sunDir = this.sunDirection(items, b);
    const sky = buildSky(sunDir);
    s.add(sky);
    this.env.push({ dispose: () => { sky.geometry.dispose(); (sky.material as THREE.Material).dispose(); } });
    const skyline = buildSkyline(b);
    s.add(skyline);
    this.env.push({ dispose: () => { skyline.geometry.dispose(); (skyline.material as THREE.Material).dispose(); skyline.dispose(); } });
    const ground = buildGround(b);
    s.add(ground.mesh);
    this.env.push({ dispose: () => { ground.mesh.geometry.dispose(); (ground.mesh.material as THREE.Material).dispose(); ground.tex.dispose(); } });
    // parquet floor over the scene footprint
    const m = 80;
    const fw = b.maxX - b.minX + 2 * m, fd = b.maxY - b.minY + 2 * m;
    const fg = new THREE.PlaneGeometry(fw, fd);
    fg.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
    const uv = fg.getAttribute('uv') as THREE.BufferAttribute, pos = fg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / PARQUET_CM, pos.getY(i) / PARQUET_CM);
    const ptex = parquetTexture();
    ptex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const fm = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.48, metalness: 0 });
    this.floor = new THREE.Mesh(fg, fm);
    this.floor.receiveShadow = true;
    this.floor.name = 'floor';
    s.add(this.floor);
    this.env.push({ dispose: () => { fg.dispose(); fm.dispose(); ptex.dispose(); } });
    // lights
    const hemi = new THREE.HemisphereLight('#dfe9f8', '#9a8064', 1.55);
    hemi.position.set(0, 0, 1);
    s.add(hemi);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.6);
    fill.position.set(-sunDir.x, -sunDir.y, 0.6).normalize();
    s.add(fill);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = b.maxZ / 2;
    const R = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ) / 2 + 120;
    this.sun.position.set(cx + sunDir.x * R * 2, cy + sunDir.y * R * 2, cz + sunDir.z * R * 2);
    this.sun.target.position.set(cx, cy, cz);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 4;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);
    s.add(this.muzzle, this.muzzle.target);
    s.add(this.fx.group);
  }

  /**
   * Afternoon sun, 40° high, from the front-left of the composition (the side
   * the app's default view looks from), so furniture shadows fall on the
   * floor and the back walls; a window facing it lets light patches in.
   */
  private sunDirection(_items: Item[], _b: Bounds): THREE.Vector3 {
    const az = THREE.MathUtils.degToRad(-118), el = THREE.MathUtils.degToRad(40);
    return new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)).normalize();
  }

  // ── loop ───────────────────────────────────────────────────
  private frame = (now: number) => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    try { if (!this.frozen) this.tick(dt); this.render(); } catch (e) { console.error(e); }
    this.stats.frames++;
    const real = this.lastReal ? (now - this.lastReal) / 1000 : 1 / 60;
    this.lastReal = now;
    this.stats.fpsAvg = this.stats.fpsAvg ? this.stats.fpsAvg * 0.9 + (1 / Math.max(1e-3, real)) * 0.1 : 60;
  };

  private tick(dt: number) {
    this.time += dt;
    const running = this.phase === 'running';
    const w = this.walker;
    const k = (c: string) => running && this.keys.has(c);
    this.input.forward = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    this.input.side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    this.input.run = k('ShiftLeft') || k('ShiftRight');
    this.input.crouch = k('KeyC');
    if (!running) this.input.jump = false;
    const turn = (k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0);
    if (turn) w.yaw += turn * TURN_SPEED * dt;
    const look = { ...this.lookAcc };
    this.lookAcc.dx = this.lookAcc.dy = 0;
    if (turn) look.dx -= turn * 6;
    if (running || this.phase === 'win') {
      const ev = w.step(dt, this.input);
      if (running) {
        this.playTime += dt;
        const o = { run: this.input.run && w.speed2D > 160, crouch: this.input.crouch };
        for (const f of ev.steps) this.audio.step(f, o);
        if (ev.land) this.audio.land(ev.land);
      }
      // weapons
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.pendingPunch >= 0) { this.pendingPunch -= dt; if (this.pendingPunch < 0) this.doPunchHit(); }
      if (running && this.mouseHeld && !this.dragLook) this.attack();
      this.destruction.update(dt, this.time);
    }
    this.fx.update(dt);
    // recoil
    this.kick *= Math.exp(-dt * 9);
    this.shake = Math.max(0, this.shake - dt);
    if (this.flashT >= 0) {
      this.flashT += dt;
      this.muzzle.intensity = this.flashT < 0.07 ? 2.6 * (1 - this.flashT / 0.07) : 0;
      if (this.flashT >= 0.07) this.flashT = -1;
    }
    this.placeCamera(dt);
    const moving = Math.min(1, w.speed2D / 140);
    this.vm.update(dt, w.bob(), moving, look);
    // completion / win
    this.hud.setCompletion(this.destruction.completion());
    if (this.phase === 'running' && this.destructibles > 0 && this.winAt < 0 && this.destruction.remaining === 0) this.winAt = this.time + 1.1;
    if (this.winAt > 0 && this.time >= this.winAt && this.phase === 'running') this.showWin();
  }

  private placeCamera(dt: number) {
    const w = this.walker;
    const b = w.bob();
    const rx = Math.sin(w.yaw), ry = -Math.cos(w.yaw);
    const x = w.x + rx * b.side, y = w.y + ry * b.side, z = w.camZ + w.eyeHeight + b.up;
    const pitch = THREE.MathUtils.clamp(w.pitch + this.kick, -PITCH_MAX, PITCH_MAX);
    const cp = Math.cos(pitch);
    this.cam.position.set(x, y, z);
    this.cam.up.set(0, 0, 1);
    this.cam.lookAt(x + Math.cos(w.yaw) * cp, y + Math.sin(w.yaw) * cp, z + Math.sin(pitch));
    if (this.shake > 0) this.cam.rotateZ((Math.random() - 0.5) * 0.012 * (this.shake / 0.18));
    this.cam.updateMatrixWorld();
    void dt;
    if (this.flashT >= 0) {
      this.cam.getWorldDirection(_v);
      this.muzzle.position.copy(this.cam.position).add(_v2.set(0, 0, -12));
      this.muzzle.target.position.copy(this.cam.position).addScaledVector(_v, 300);
      this.muzzle.target.updateMatrixWorld();
    }
  }

  private render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.cam);
    if (this.vm.shown !== 'none' && this.phase !== 'win') {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }

  private resize = () => {
    const w = Math.max(1, this.hud.root.clientWidth), h = Math.max(1, this.hud.root.clientHeight);
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.vm.setAspect(w / h);
  };

  // ── weapons ────────────────────────────────────────────────
  cycleWeapon() { this.setWeapon(WEAPONS[(WEAPONS.indexOf(this.weapon) + 1) % WEAPONS.length]); }

  /** First T: the calm visit turns into the game (HUD appears and stays). */
  reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.hud.reveal();
  }

  setWeapon(w: Weapon, immediate = false) {
    if (w !== 'none') this.reveal();
    if (w === this.weapon) return;
    this.weapon = w;
    this.pendingPunch = -1;
    if (immediate) this.vm.setImmediate(w); else this.vm.switchTo(w);
    this.hud.setWeapon(w, !immediate);
    if (!immediate) this.audio.switchTo(w);
    this.cooldown = immediate ? 0 : 0.25;
  }

  /** Left click (or held): punch / shoot when ready. */
  attack(): boolean {
    if (this.phase !== 'running' || this.cooldown > 0 || this.vm.switching) return false;
    if (this.weapon === 'fists') {
      this.cooldown = PUNCH_COOLDOWN;
      this.vm.punch();
      this.audio.grunt();
      this.audio.whoosh();
      this.pendingPunch = PUNCH_HIT_AT;
      this.stats.punches++;
      return true;
    }
    if (this.weapon === 'shotgun') { this.cooldown = SHOTGUN_COOLDOWN; this.fireShotgun(); return true; }
    if (this.revealed) { this.hud.toast(gt('noWeapon')); this.cooldown = 0.8; }
    return false;
  }

  private targets(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [this.floor, ...this.built.staticTargets];
    for (const g of this.built.items) {
      if (!g.destructible || g.destroyed) continue;
      if (g.intact) out.push(...g.intact.children);
      else for (const m of g.meshes) if (m) out.push(m);
    }
    return out;
  }

  private cast(dir: THREE.Vector3, far: number): THREE.Intersection | null {
    this.raycaster.set(this.cam.position, dir);
    this.raycaster.near = 0;
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObjects(this.targets(), false);
    const h = hits[0] ?? null;
    // furniture flush against a (zero-thickness) wall: the wall wins the tie, no shooting through it
    if (h && this.itemOf(h.object)?.destructible) {
      const w = hits.find(x => x.distance < h.distance + 0.8 && !this.itemOf(x.object)?.destructible);
      if (w) return w;
    }
    return h;
  }

  private itemOf(o: THREE.Object3D): GameItem | null {
    const id = o.userData.itemId as string | undefined;
    return id ? this.built.byId.get(id) ?? null : null;
  }

  private hitNormal(h: THREE.Intersection): THREE.Vector3 {
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
    if (n.dot(this.raycaster.ray.direction) > 0) n.negate();
    return n;
  }

  private colorOfHit(h: THREE.Intersection): THREE.Color | null {
    const m = (h.object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    return m?.color ? m.color.clone() : null;
  }

  private doPunchHit() {
    this.cam.getWorldDirection(_v);
    const h = this.cast(_v.clone(), 220);
    const w = this.walker;
    const reach = h ? Math.hypot(h.point.x - w.x, h.point.y - w.y) <= FIST_REACH + this.body.radius && h.distance <= 220 : false;
    if (!h || !reach) { this.stats.whiffs++; this.stats.lastPunch = 'whiff'; return; }
    const g = this.itemOf(h.object);
    const n = this.hitNormal(h);
    this.fx.impact(h.point, n, this.colorOfHit(h), 0.55, false);
    if (g && g.destructible && !g.destroyed) {
      const r = this.destruction.damage(g, { point: h.point.clone(), dir: _v.clone(), weapon: 'fists' });
      this.audio.punchHit(1);
      this.hud.hitMarker(r.destroyed);
      this.stats.hits++;
      this.stats.lastPunch = r.destroyed ? 'destroyed' : 'hit';
      this.shake = 0.08;
    } else {
      this.audio.punchHit(0.75);
      this.stats.lastPunch = 'wall';
    }
  }

  private fireShotgun() {
    this.stats.shots++;
    this.vm.fire();
    this.audio.shotgun();
    this.audio.pump(0.32);
    // aim = where the crosshair is now (the recoil kick applies after the shot)
    this.placeCamera(0);
    const f = this.cam.getWorldDirection(new THREE.Vector3());
    const origin = this.cam.position.clone();
    const right = new THREE.Vector3().crossVectors(f, this.cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const hitItems = new Map<GameItem, THREE.Vector3>();
    const t = Math.tan(PELLET_HALF_ANGLE);
    for (let i = 0; i < PELLETS; i++) {
      const rr = i === 0 ? 0 : Math.sqrt(Math.random()) * t, a = Math.random() * Math.PI * 2;   // first pellet dead centre
      const d = f.clone().addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
      const h = this.cast(d, SHOTGUN_RANGE);
      if (!h) continue;
      const n = this.hitNormal(h);
      const g = this.itemOf(h.object);
      this.fx.impact(h.point, n, this.colorOfHit(h), 0.6, !g || !g.destructible);
      if (g && g.destructible && !g.destroyed) { if (!hitItems.has(g)) hitItems.set(g, h.point.clone()); }
      else this.fx.decal(h.object, h.point, n, 2.4 + Math.random() * 1.6);
    }
    let kill = false;
    for (const [g, p] of hitItems) {
      const r = this.destruction.damage(g, { point: p, dir: f.clone(), weapon: 'shotgun' });
      kill = kill || r.destroyed;
      this.stats.hits++;
    }
    if (hitItems.size) this.hud.hitMarker(kill);
    this.kick += THREE.MathUtils.degToRad(3.4);
    this.walker.pitch = Math.min(PITCH_MAX, this.walker.pitch + THREE.MathUtils.degToRad(0.7));
    this.shake = 0.18;
    this.flashT = 0;
    this.muzzle.intensity = 2.6;
    void origin;
  }

  private panOf(p: THREE.Vector3): number {
    const w = this.walker;
    const rx = Math.sin(w.yaw), ry = -Math.cos(w.yaw);
    const dx = p.x - this.cam.position.x, dy = p.y - this.cam.position.y;
    const l = Math.hypot(dx, dy) || 1;
    return THREE.MathUtils.clamp((dx * rx + dy * ry) / l, -0.8, 0.8);
  }

  // ── phases ─────────────────────────────────────────────────
  start() {
    if (!this.active || this.phase === 'win') return;
    this.audio.init();
    this.audio.setMuted(!this.soundOn);
    this.audio.resume();
    const el = this.hud.root;
    const fallback = () => { this.dragLook = true; this.setPhase('running'); };
    try {
      const r = el.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).catch(() => {
          if (!this.active || this.phase === 'win') return;
          if (this.lockedOnce) this.setPhase('paused', true);
          else if (this.handover) { this.handover = false; this.setPhase('start'); }  // click to play
          else fallback();
        });
      } else if (!el.requestPointerLock) fallback();
    } catch { fallback(); }
    this.setPhase('running');
  }

  private onLockChange = () => {
    if (!this.active) return;
    const locked = document.pointerLockElement === this.hud.root;
    if (locked) { this.lockedOnce = true; this.dragLook = false; if (this.phase !== 'win') this.setPhase('running'); }
    else if (this.phase === 'running' && !this.dragLook) this.setPhase('paused');
    this.hud.setLocked(locked);
  };

  private setPhase(p: Phase, retry = false) {
    if (p === 'paused' && this.phase !== 'paused') this.pausedAt = performance.now();
    this.phase = p;
    if (p !== 'running') { this.keys.clear(); this.mouseHeld = false; }
    this.hud.setCard(p === 'running' || p === 'win' ? null : p, retry);
    this.hud.dragHint.hidden = !(p === 'running' && this.dragLook);
    if (p === 'paused') this.audio.suspend(); else if (p === 'running') this.audio.resume();
  }

  private showWin() {
    this.phase = 'win';
    this.keys.clear(); this.mouseHeld = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const s = Math.round(this.playTime);
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.hud.showWin(gt('winStats', { n: this.destruction.destroyedCount, time }));
    this.audio.resume();
    this.audio.victory();
    this.hud.btnReplay.focus({ preventScroll: true });
  }

  /** "Rejouer": rebuild the scene from the original snapshot. */
  replay() {
    if (!this.active) return;
    this.hud.hideWin();
    this.destruction.clear();
    this.destruction.root.removeFromParent();
    this.fx.clear();
    disposeScene(this.built);
    this.buildWorld(false);
    this.weapon = 'none';
    this.setWeapon('fists', true);
    this.hud.setHudVisible(true);
    this.phase = 'start';
    this.start();
  }

  // ── input ──────────────────────────────────────────────────
  private listen() {
    const on = <K extends keyof WindowEventMap>(tg: Window | Document, type: K, fn: (e: WindowEventMap[K]) => void, capture = true) => {
      tg.addEventListener(type, fn as EventListener, capture);
      this.cleanup.push(() => tg.removeEventListener(type, fn as EventListener, capture));
    };
    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'keypress', (e) => e.stopImmediatePropagation());
    on(window, 'blur', () => { this.keys.clear(); this.mouseHeld = false; if (this.phase === 'running' && this.dragLook) this.setPhase('paused'); });
    on(window, 'resize', this.resize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', this.onLockChange));
    on(document, 'mousemove', (e) => {
      if (this.phase === 'running' && document.pointerLockElement === this.hud.root) this.look(e.movementX, e.movementY);
    });
    this.resizeObs = new ResizeObserver(this.resize);
    this.resizeObs.observe(this.hud.root);
    const root = this.hud.root;
    const stop = (e: Event) => e.stopPropagation();
    for (const t of ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu', 'mousedown', 'mouseup'] as const) root.addEventListener(t, stop);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('mousedown', (e) => {
      if (this.phase !== 'running' || this.dragLook || e.button !== 0) return;
      this.mouseHeld = true;
      this.attack();
    });
    on(window, 'mouseup', (e) => { if (e.button === 0) this.mouseHeld = false; });
    // drag-to-look fallback (no pointer lock): drag = look, click = attack
    root.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'running' || !this.dragLook || e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      root.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.look(dx, dy);
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      if (this.drag.moved < 5 && this.phase === 'running') this.attack();
      this.drag = null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('click', (e) => {
      if (this.phase === 'running' || this.phase === 'win') return;
      if ((e.target as HTMLElement).closest('button')) return;
      this.start();
    });
    this.hud.btnResume.addEventListener('click', (e) => { e.stopPropagation(); this.start(); });
    this.hud.btnQuit.addEventListener('click', (e) => { e.stopPropagation(); this.exit(); });
    this.hud.btnReplay.addEventListener('click', (e) => { e.stopPropagation(); this.replay(); });
    this.hud.btnExit.addEventListener('click', (e) => { e.stopPropagation(); this.exit(); });
    const onVis = () => { if (document.hidden && this.phase === 'running') { if (document.pointerLockElement) document.exitPointerLock(); this.setPhase('paused'); } };
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  private look(dx: number, dy: number) {
    const w = this.walker;
    w.yaw -= dx * LOOK_RAD_PER_PX;
    w.pitch = THREE.MathUtils.clamp(w.pitch - dy * LOOK_RAD_PER_PX, -PITCH_MAX, PITCH_MAX);
    this.lookAcc.dx += dx; this.lookAcc.dy += dy;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.active) return;
    e.stopImmediatePropagation();                 // the app's shortcuts are off while playing
    if (e.metaKey || e.ctrlKey || e.altKey) { if (down) this.keys.clear(); return; }
    const code = e.code;
    if (!down) { this.keys.delete(code); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (document.pointerLockElement) return;      // the browser releases the lock → pause
      if (this.phase === 'running') this.setPhase('paused');
      else if (this.phase === 'win' || this.phase === 'start' || performance.now() - this.pausedAt > 250) this.exit();
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (this.phase !== 'running' && tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab' || e.key.startsWith('Arrow'))) return;
    if (e.key === 'Tab') { e.preventDefault(); return; }
    if (this.phase === 'win') { if (e.key === 'Enter') { e.preventDefault(); this.replay(); } return; }
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC'];
    if (movement.includes(code)) {
      e.preventDefault();
      if (this.phase !== 'running') { if (code === 'Space') this.start(); return; }
      if (code === 'Space' && !e.repeat && this.walker.onGround) this.input.jump = true;
      this.keys.add(code);
      return;
    }
    if (e.repeat) return;
    const kl = e.key.toLowerCase();
    if (kl === 't') { e.preventDefault(); if (this.phase === 'running') { this.reveal(); this.cycleWeapon(); } }
    else if (kl === 'm') { e.preventDefault(); this.setSound(!this.soundOn); }
    else if (e.key === 'Enter' && this.phase !== 'running') { e.preventDefault(); this.start(); }
  }

  setSound(on: boolean) {
    this.soundOn = on;
    this.audio.setMuted(!on);
    if (on && this.active) this.audio.init();
    this.hud.setSound(on);
    this.hud.toast(on ? gt('soundOn') : gt('soundOff'));
  }

  // ── test / debug ───────────────────────────────────────────
  debug() {
    const w = this.walker;
    return {
      active: this.active, phase: this.phase, weapon: this.weapon, shown: this.vm.shown, dragLook: this.dragLook,
      pos: w ? { x: w.x, y: w.y, z: w.z } : null, eye: this.cam.position.z, yaw: w ? THREE.MathUtils.radToDeg(w.yaw) : 0,
      pitch: w ? THREE.MathUtils.radToDeg(w.pitch) : 0, onGround: w?.onGround, speed: w?.speed2D ?? 0,
      fov: this.cam.fov, near: this.cam.near, colliders: this.colliders.length,
      completion: this.destruction?.completion() ?? 0, remaining: this.destruction?.remaining ?? 0, destructibles: this.destructibles,
      debris: this.destruction?.debris.length ?? 0, debrisAge: this.destruction?.debris.slice(0, 3).map(d => [+d.age.toFixed(2), +d.life.toFixed(2), d.onGround, +d.v.length().toFixed(1)]), sleeping: this.destruction?.debris.filter(d => d.sleeping).length ?? 0,
      destruction: { ...this.destruction?.stats }, fx: { ...this.fx.stats, particles: this.fx.particles },
      items: this.built?.items.map(g => ({ id: g.id, kind: g.src.kind, shape: g.src.kind === 'block' ? g.src.shape : undefined, destructible: g.destructible, pieces: g.pieces.length, attached: g.attached.filter(Boolean).length, hits: g.hits, hitsNeeded: g.hitsNeeded, destroyed: g.destroyed, falling: g.falling, dz: Math.round(g.dz * 10) / 10, z0: g.z0, supporters: g.supporters.length })),
      audio: { state: this.audio.state, ...this.audio.stats }, stats: { ...this.stats }, kick: THREE.MathUtils.radToDeg(this.kick),
      win: this.hud.winVisible, revealed: this.revealed, render: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures },
    };
  }
  teleport(x: number, y: number, yawDeg?: number, pitchDeg?: number) {
    this.walker.place(x, y, 0);
    if (yawDeg != null) this.walker.yaw = THREE.MathUtils.degToRad(yawDeg);
    if (pitchDeg != null) this.walker.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.placeCamera(0);
  }
  aim(yawDeg: number, pitchDeg: number) { this.walker.yaw = THREE.MathUtils.degToRad(yawDeg); this.walker.pitch = THREE.MathUtils.degToRad(pitchDeg); this.placeCamera(0); }
  /** Aim the camera centre at a world point. */
  aimAt(x: number, y: number, z: number) {
    this.placeCamera(0);
    const p = this.cam.position;
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    this.walker.yaw = Math.atan2(dy, dx);
    this.walker.pitch = Math.atan2(dz, Math.hypot(dx, dy));
    this.kick = 0;
    this.placeCamera(0);
  }
  /** Item centre (world) by id or index among destructibles. */
  itemCenter(idOrIndex: string | number): { x: number; y: number; z: number } | null {
    const g = typeof idOrIndex === 'number' ? this.built.items.filter(i => i.destructible)[idOrIndex] : this.built.byId.get(idOrIndex);
    if (!g) return null;
    const b = itemBox(g.src);
    return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 + g.dz };
  }
  /**
   * Test helper: stand on a free spot near an item with a clear line of sight
   * to its centre and aim at it. Returns false when no such spot was found.
   */
  approach(idOrIndex: string | number, extra = 45): boolean {
    const g = typeof idOrIndex === 'number' ? this.built.items.filter(i => i.destructible && !i.destroyed)[idOrIndex] : this.built.byId.get(idOrIndex);
    if (!g || g.destroyed) return false;
    const c = this.itemCenter(g.id)!;
    const o = itemOBB(g.src);
    const r0 = Math.max(o.h.x, o.h.y) + this.body.radius + extra;
    const fn = orientDir(g.src, { x: 0, y: -1, z: 0 }), fa = Math.atan2(fn.y, fn.x);
    const angles = Array.from({ length: 24 }, (_, k) => (k / 24) * Math.PI * 2).sort((p, q) => Math.cos(q - fa) - Math.cos(p - fa));
    for (const r of extra < 40 ? [r0, r0 + 10, r0 + 20] : [r0, r0 + 40, r0 + 90]) for (const a of angles) {
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      if (!this.walker.isFree(x, y, 0)) continue;
      this.walker.place(x, y, 0);
      if (this.walker.z > 1) continue;
      this.aimAt(c.x, c.y, Math.min(c.z, this.cam.position.z - 10));
      this.cam.getWorldDirection(_v);
      const h = this.cast(_v.clone(), 2000);
      if (h && this.itemOf(h.object) === g && h.distance < Math.hypot(r, this.cam.position.z - c.z) + 5) return true;
    }
    return false;
  }
  /** Test helper: advance the simulation by `seconds` at 60 Hz without drawing (slow software GL). */
  simulate(seconds: number) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.tick(1 / 60);
    this.render();
  }
  /** Test helper: what the crosshair ray hits. */
  probe() {
    this.cam.getWorldDirection(_v);
    const h = this.cast(_v.clone(), 3000);
    if (!h) return null;
    return { item: h.object.userData.itemId ?? h.object.name, d: Math.round(h.distance), p: h.point.toArray().map(Math.round), cam: this.cam.position.toArray().map(Math.round), player: [Math.round(this.walker.x), Math.round(this.walker.y)] };
  }
  /** Start without pointer lock (tests: headless browsers refuse it). */
  play() { if (!this.active) return; this.audio.init(); this.dragLook = true; this.setPhase('running'); }
  fire() { this.cooldown = 0; return this.attack(); }
  hold(key: string, on: boolean) { if (on) this.keys.add(key); else this.keys.delete(key); }
}

let current: Game | null = null;

export function startGame(o: GameOptions): Game {
  const g = new Game({ ...o, onExit: () => { if (current === g) current = null; o.onExit?.(); } });
  current = g;
  g.enter();
  return g;
}

// Test / debug hook (localStorage 'kallax-designer:debug' = '1').
try {
  if (localStorage.getItem('kallax-designer:debug') === '1') {
    const w = window as unknown as { __kd?: Record<string, unknown> };
    w.__kd = { ...(w.__kd ?? {}), game: {
      get current() { return current; },
      state: () => current?.debug() ?? { active: false },
      teleport: (x: number, y: number, yaw?: number, pitch?: number) => current?.teleport(x, y, yaw, pitch),
      aim: (yaw: number, pitch: number) => current?.aim(yaw, pitch),
      aimAt: (x: number, y: number, z: number) => current?.aimAt(x, y, z),
      itemCenter: (k: string | number) => current?.itemCenter(k) ?? null,
      fire: () => current?.fire(),
      probe: () => current?.probe() ?? null,
      simulate: (sec: number) => current?.simulate(sec),
      freeze: (on: boolean) => { if (current) current.frozen = on; },
      approach: (k: string | number, extra?: number) => current?.approach(k, extra) ?? false,
      setWeapon: (wp: Weapon, immediate = false) => current?.setWeapon(wp, immediate),
      cycle: () => { current?.reveal(); current?.cycleWeapon(); },
      play: () => current?.play(),
      hold: (k: string, on: boolean) => current?.hold(k, on),
      replay: () => current?.replay(),
      exit: () => current?.exit(),
    } };
  }
} catch { /* ignore */ }
