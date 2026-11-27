// ─────────────────────────────────────────────────────────────
// Game mode — first-person weapon viewmodels, drawn by code and rendered in
// a second pass on top of the world (own scene / camera, depth cleared).
// Camera space: −Z forward, +Y up, +X right; units cm.
//   fists   — two forearms (skin) with sleeves and cuffs, closed fists with
//             knuckles, fingers and thumb, in a guard; right straight punch
//             (fast extend + corkscrew + retract, 0.35 s), left pulls back.
//   shotgun — pump action: dark metal receiver / barrel / magazine tube,
//             wooden stock and ridged forend, both hands; recoil kick, muzzle
//             flash (sprite + light), pump stroke.
// Idle breathing, walk bob, look sway, lower / raise when switching.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { flashTexture } from './textures';
import { capsuleGeo, sphereGeo, torusGeo } from './geom';

export type Weapon = 'none' | 'fists' | 'shotgun';
export const PUNCH_TIME = 0.35;
export const PUNCH_HIT_AT = 0.09;

const SKIN = '#d9a27e', SKIN_DARK = '#c08a68', SLEEVE = '#2f3d52', CUFF = '#263243';
const METAL = '#3d4046', METAL_EDGE = '#5a5e65', WOOD = '#7a4a26', WOOD_DARK = '#5c3519';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(54, 1, 1, 400);
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private flashTex: THREE.Texture;
  private holder = new THREE.Group();
  private fists = new THREE.Group();
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private gun = new THREE.Group();
  private forend = new THREE.Group();
  private flash: THREE.Sprite;
  private flashLight = new THREE.DirectionalLight('#ffb35a', 0);
  /** Displayed weapon (may lag `target` during a switch). */
  shown: Weapon = 'none';
  target: Weapon = 'none';
  private switchT = 1;      // 0…1 lowering, 1…2 raising; ≥ 2 idle
  private punchT = -1;
  private recoilT = -1;
  private pumpT = -1;
  private flashT = -1;
  private time = 0;
  private swayX = 0; private swayY = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight('#e8eef8', '#5b4a3c', 1.5));
    const key = new THREE.DirectionalLight('#fff4e4', 2.2);
    key.position.set(-0.6, 1, 0.9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#bcd2ff', 0.6);
    rim.position.set(1, 0.3, -0.5);
    this.scene.add(rim);
    this.scene.add(this.flashLight);
    this.flashTex = flashTexture();
    const fm = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.mats.push(fm);
    this.flash = new THREE.Sprite(fm);
    this.flash.visible = false;
    this.buildFists();
    this.buildGun();
    this.holder.add(this.fists, this.gun);
    this.scene.add(this.holder);
    this.fists.visible = false;
    this.gun.visible = false;
  }

  private mat(hex: string, rough = 0.6, metal = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
    this.mats.push(m);
    return m;
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T { this.geos.push(g); return g; }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const me = new THREE.Mesh(this.geo(g), m);
    me.position.set(x, y, z);
    return me;
  }

  // ── models ────────────────────────────────────────────────
  /** One arm: fist at the origin, forearm along +Z (towards the elbow). */
  private arm(mirror: boolean): THREE.Group {
    const s = mirror ? -1 : 1;
    const skin = this.mat(SKIN, 0.62), skinD = this.mat(SKIN_DARK, 0.66), sleeve = this.mat(SLEEVE, 0.92), cuff = this.mat(CUFF, 0.9);
    const g = new THREE.Group();
    // fist block
    const fist = this.mesh(new RoundedBoxGeometry(8.4, 7.6, 9.2, 3, 2.2), skin, 0, 0, 0.5);
    g.add(fist);
    // fingers curled across the front (4 rounded segments) + knuckles
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 2.05;
      g.add(this.mesh(new RoundedBoxGeometry(1.95, 3.1, 3.4, 2, 0.9), skinD, x, -1.2, -3.7));
      const kn = this.mesh(sphereGeo(1.05, 10, 8), skin, x, 2.2, -3.6);
      kn.scale.set(1, 0.8, 1);
      g.add(kn);
    }
    // thumb across the fingers
    const th = this.mesh(capsuleGeo(1.15, 4.2, 4, 8), skin, -s * 0.6, -2.9, -3.2);
    th.rotation.z = Math.PI / 2 + s * 0.25;
    g.add(th);
    // wrist + forearm (tapering capsule)
    const fa = this.mesh(capsuleGeo(3.1, 24, 6, 14), skin, 0, -0.4, 17);
    fa.rotation.x = Math.PI / 2;
    fa.scale.set(1.05, 1, 0.9);
    g.add(fa);
    // sleeve + cuff
    const sl = this.mesh(new THREE.CylinderGeometry(4.6, 5.2, 26, 16, 1, false), sleeve, 0, -0.4, 34);
    sl.rotation.x = Math.PI / 2;
    g.add(sl);
    const cf = this.mesh(torusGeo(4.55, 0.75, 8, 20), cuff, 0, -0.4, 21.3);
    g.add(cf);
    return g;
  }

  private buildFists() {
    this.armR.add(this.arm(false));
    this.armL.add(this.arm(true));
    this.fists.add(this.armR, this.armL);
  }

  private buildGun() {
    const metal = this.mat(METAL, 0.4, 0.45), edge = this.mat(METAL_EDGE, 0.34, 0.5);
    const wood = this.mat(WOOD, 0.55), woodD = this.mat(WOOD_DARK, 0.6);
    const skin = this.mat(SKIN, 0.62), sleeve = this.mat(SLEEVE, 0.92);
    const g = this.gun;
    // receiver
    g.add(this.mesh(new RoundedBoxGeometry(3.4, 4.8, 17, 2, 0.6), metal, 0, 0.2, 0));
    g.add(this.mesh(new THREE.BoxGeometry(3.7, 0.6, 9), edge, 0, -1.2, 1.5)); // ejection port trim
    // barrel + muzzle + bead
    const bar = this.mesh(new THREE.CylinderGeometry(1.05, 1.05, 48, 18), metal, 0, 1.4, -32);
    bar.rotation.x = Math.PI / 2;
    g.add(bar);
    const muz = this.mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 18), edge, 0, 1.4, -55.5);
    muz.rotation.x = Math.PI / 2;
    g.add(muz);
    g.add(this.mesh(sphereGeo(0.42, 8, 6), edge, 0, 2.55, -55));
    // magazine tube
    const mag = this.mesh(new THREE.CylinderGeometry(0.95, 0.95, 40, 16), metal, 0, -0.95, -28);
    mag.rotation.x = Math.PI / 2;
    g.add(mag);
    g.add(this.mesh(new THREE.BoxGeometry(2.6, 1.6, 2), edge, 0, 0.2, -47)); // barrel clamp
    // forend (moves)
    const fe = this.mesh(new RoundedBoxGeometry(4.4, 4.2, 15, 2, 1.1), wood, 0, -1.1, 0);
    this.forend.add(fe);
    for (let i = 0; i < 6; i++) this.forend.add(this.mesh(new THREE.BoxGeometry(4.6, 0.45, 0.7), woodD, 0, -2.9, -5.5 + i * 2.2));
    this.forend.position.set(0, 0, -24);
    g.add(this.forend);
    // trigger guard + trigger
    const tg = this.mesh(torusGeo(1.7, 0.32, 6, 16, Math.PI), metal, 0, -2.7, 4.2);
    tg.rotation.set(Math.PI, Math.PI / 2, 0);
    g.add(tg);
    g.add(this.mesh(new THREE.BoxGeometry(0.4, 1.8, 0.5), edge, 0, -3.2, 4));
    // stock: side profile (z, y) extruded across X
    const prof = new THREE.Shape();
    const P: [number, number][] = [[8, 2.4], [20, 1.4], [34, 0.6], [38, 1.2], [39, -9.5], [36, -11.5], [18, -6.2], [12, -5.2], [8, -2.7]];
    prof.moveTo(P[0][0], P[0][1]);
    for (const [z, y] of P.slice(1)) prof.lineTo(z, y);
    prof.closePath();
    const sg = new THREE.ExtrudeGeometry(prof, { depth: 3.4, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 2, curveSegments: 1 });
    // shape (x, y) = (z, y) → rotate so shape x runs along +Z
    sg.rotateY(-Math.PI / 2);
    sg.translate(1.7, 0, 0);
    const stock = new THREE.Mesh(this.geo(sg), wood);
    g.add(stock);
    // hands: left under the forend (moves with it), right on the wrist of the stock;
    // forearms + sleeves run down / back out of the view
    const lh = this.mesh(new RoundedBoxGeometry(5.6, 4.8, 9.5, 3, 1.9), skin, -0.4, -3.9, -0.5);
    this.forend.add(lh);
    this.limb(this.forend, new THREE.Vector3(-1.5, -5.5, 2), new THREE.Vector3(-11, -19, 16), 2.9, skin);
    this.limb(this.forend, new THREE.Vector3(-9, -16, 13), new THREE.Vector3(-20, -34, 32), 4.6, sleeve);
    const rh = this.mesh(new RoundedBoxGeometry(5.2, 6.4, 7.5, 3, 1.9), skin, 0.6, -4.6, 9.5);
    rh.rotation.x = -0.35;
    g.add(rh);
    this.limb(g, new THREE.Vector3(1.5, -6.5, 12), new THREE.Vector3(9, -17, 26), 3, skin);
    this.limb(g, new THREE.Vector3(7.5, -15, 23), new THREE.Vector3(16, -30, 40), 4.7, sleeve);
    // flash at the muzzle
    this.flash.position.set(0, 1.4, -60);
    this.flash.scale.set(22, 22, 1);
    g.add(this.flash);
    this.flashLight.position.set(0, 0.2, -1);
  }

  /** A capsule (forearm / sleeve) between two points, added to `parent`. */
  private limb(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
    const d = b.clone().sub(a);
    const me = this.mesh(capsuleGeo(r, Math.max(0.1, d.length() - 2 * r), 5, 14), m);
    me.position.copy(a).add(b).multiplyScalar(0.5);
    me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    parent.add(me);
    return me;
  }

  // ── control ───────────────────────────────────────────────
  get busy(): boolean { return this.switchT < 2 || this.punchT >= 0; }
  get switching(): boolean { return this.switchT < 2; }

  /** Start switching to `w` (lower the current weapon, raise the new one). */
  switchTo(w: Weapon) {
    if (w === this.target) return;
    this.target = w;
    if (this.shown === 'none') { this.shown = w; this.applyVisible(); this.switchT = 1; }   // nothing to lower: raise
    else if (this.switchT >= 1) this.switchT = this.switchT >= 2 ? 0 : 2 - this.switchT;  // lower from the current height
    // (already lowering: keep going, the new target is swapped in at the bottom)
    this.punchT = -1; this.recoilT = -1; this.pumpT = -1;
  }
  setImmediate(w: Weapon) { this.target = this.shown = w; this.switchT = 2; this.applyVisible(); }

  punch() { this.punchT = 0; }
  fire() { this.recoilT = 0; this.flashT = 0; this.pumpT = -0.28; this.flash.material.rotation = Math.random() * Math.PI; }
  get isPumping() { return this.pumpT >= 0 && this.pumpT < 0.42; }

  private applyVisible() {
    this.fists.visible = this.shown === 'fists';
    this.gun.visible = this.shown === 'shotgun';
  }

  setAspect(a: number) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Advance animations. `bob`: walker head bob (cm); `look`: mouse delta this frame (px). */
  update(dt: number, bob: { up: number; side: number }, moving: number, look: { dx: number; dy: number }) {
    this.time += dt;
    // switch: 0→1 lower the shown weapon, then swap, 1→2 raise
    if (this.switchT < 2) {
      const before = this.switchT;
      this.switchT += dt / 0.2;
      if (before < 1 && this.switchT >= 1) { this.shown = this.target; this.applyVisible(); }
      if (this.switchT >= 2) this.switchT = 2;
    }
    const lower = this.switchT < 1 ? easeInOut(this.switchT) : this.switchT < 2 ? 1 - easeOut(this.switchT - 1) : 0;
    // sway (lags the look direction)
    this.swayX += (THREE.MathUtils.clamp(-look.dx * 0.035, -2.5, 2.5) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (THREE.MathUtils.clamp(look.dy * 0.035, -2.5, 2.5) - this.swayY) * Math.min(1, dt * 10);
    const breathe = Math.sin(this.time * 1.7) * 0.28;
    const bx = bob.side * 0.9 * (0.4 + moving), by = bob.up * 0.7 + breathe;
    this.holder.position.set(this.swayX + bx, this.swayY + by - lower * 26, lower * 4);
    this.holder.rotation.set(-lower * 0.5, 0, lower * 0.15);

    if (this.shown === 'fists') this.poseFists(dt);
    else if (this.shown === 'shotgun') this.poseGun(dt);
  }

  private poseFists(dt: number) {
    // guard pose
    const R = { x: 15, y: -16.5, z: -44, rx: 0.5, ry: 0.3, rz: -0.12 };
    const Lg = { x: -16, y: -15.5, z: -47, rx: 0.48, ry: -0.32, rz: 0.14 };
    let k = 0, back = 0;
    if (this.punchT >= 0) {
      this.punchT += dt;
      const t = this.punchT;
      if (t < PUNCH_HIT_AT) k = easeOut(t / PUNCH_HIT_AT);
      else if (t < PUNCH_HIT_AT + 0.04) k = 1;
      else k = 1 - easeInOut(clamp01((t - PUNCH_HIT_AT - 0.04) / (PUNCH_TIME - PUNCH_HIT_AT - 0.04)));
      back = Math.sin(clamp01(t / PUNCH_TIME) * Math.PI);
      if (t >= PUNCH_TIME) this.punchT = -1;
    }
    const lerp = THREE.MathUtils.lerp;
    this.armR.position.set(lerp(R.x, 3, k), lerp(R.y, -7, k), lerp(R.z, -68, k));
    this.armR.rotation.set(lerp(R.rx, 0.16, k), lerp(R.ry, 0.08, k), lerp(R.rz, -0.95, k));
    this.armL.position.set(Lg.x - back * 1.5, Lg.y - back * 1.2, Lg.z + back * 4);
    this.armL.rotation.set(Lg.rx + back * 0.1, Lg.ry, Lg.rz);
  }

  private poseGun(dt: number) {
    let kick = 0;
    if (this.recoilT >= 0) {
      this.recoilT += dt;
      const t = this.recoilT;
      kick = t < 0.04 ? easeOut(t / 0.04) : Math.max(0, 1 - easeInOut(clamp01((t - 0.04) / 0.32)));
      if (t > 0.5) this.recoilT = -1;
    }
    let pump = 0;
    if (this.pumpT > -1) {
      this.pumpT += dt;
      const t = this.pumpT;
      if (t >= 0) {
        pump = t < 0.17 ? easeInOut(t / 0.17) : t < 0.2 ? 1 : 1 - easeInOut(clamp01((t - 0.2) / 0.17));
        if (t > 0.42) this.pumpT = -1;
      }
    }
    this.forend.position.z = -24 + pump * 7.5;
    this.gun.position.set(11.5, -12.5 + kick * 1.8 - pump * 0.8, -31 + kick * 8);
    this.gun.rotation.set(0.05 + kick * 0.26 - pump * 0.06, 0.075 + pump * 0.06, 0.04 - pump * 0.08);
    // flash: ~50 ms
    if (this.flashT >= 0) {
      this.flashT += dt;
      const on = this.flashT < 0.055;
      this.flash.visible = on;
      const s = 18 + Math.random() * 10;
      this.flash.scale.set(s, s, 1);
      this.flashLight.intensity = on ? 5 * (1 - this.flashT / 0.055) : 0;
      if (!on) this.flashT = -1;
    } else { this.flash.visible = false; this.flashLight.intensity = 0; }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.flashTex.dispose();
    this.scene.clear();
  }
}
