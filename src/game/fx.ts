// ─────────────────────────────────────────────────────────────
// Game mode — impact effects: pooled particles (additive sparks, alpha-blended
// dust puffs and wood splinters, one Points draw call each) and bullet-hole /
// scuff decals (shared quad, ring buffer, parented to what was hit so they
// follow a flying piece). World units: cm.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { holeTexture, puffTexture } from './textures';

// Billboards: 4 vertices per particle sharing its centre; the corner offset
// (aCorner, ±1) is applied in view space, size = world diameter (cm).
const VERT = /* glsl */`
  attribute vec2 aCorner;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    mv.xy += aCorner * aSize * 0.5;
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
    vUv = aCorner * 0.5 + 0.5;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
    #include <colorspace_fragment>
  }`;

class Particles {
  readonly points: THREE.Mesh;
  private n: number;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array; private grow: Float32Array; private size0: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private baseAlpha: Float32Array;
  private next = 0;
  private qPos: Float32Array; private qCol: Float32Array; private qSize: Float32Array; private qAlpha: Float32Array;
  readonly mat: THREE.ShaderMaterial;
  alive = 0;

  constructor(n: number, tex: THREE.Texture, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grow = new Float32Array(n); this.size0 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.qPos = new Float32Array(n * 12); this.qCol = new Float32Array(n * 12); this.qSize = new Float32Array(n * 4); this.qAlpha = new Float32Array(n * 4);
    const corner = new Float32Array(n * 8), idx: number[] = [];
    for (let i = 0; i < n; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.qPos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.qCol, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.qSize, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.qAlpha, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Mesh(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, o: { grow?: number; grav?: number; drag?: number; alpha?: number } = {}) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = 0; this.max[i] = life;
    this.grow[i] = o.grow ?? 0; this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0;
    this.alpha[i] = o.alpha ?? 1;
    this.baseAlpha[i] = o.alpha ?? 1;
  }

  update(dt: number) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.max[i] <= 0) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.max[i];
      if (t >= 1) { this.max[i] = 0; this.alpha[i] = 0; this.size[i] = 0; continue; }
      alive++;
      const k = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] *= dr; this.vel[k + 2] = this.vel[k + 2] * dr - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 2] < 0.3) { this.pos[k + 2] = 0.3; this.vel[k + 2] *= -0.3; this.vel[k] *= 0.6; this.vel[k + 1] *= 0.6; }
      this.size[i] = this.size0[i] * (1 + this.grow[i] * t);
      this.alpha[i] = this.baseAlpha[i] * (1 - t) * (1 - t);
    }
    this.alive = alive;
    // expand to the 4 quad vertices
    for (let i = 0; i < this.n; i++) {
      const sz = this.size[i], al = this.alpha[i];
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        this.qPos[v * 3] = this.pos[i * 3]; this.qPos[v * 3 + 1] = this.pos[i * 3 + 1]; this.qPos[v * 3 + 2] = this.pos[i * 3 + 2];
        this.qCol[v * 3] = this.col[i * 3]; this.qCol[v * 3 + 1] = this.col[i * 3 + 1]; this.qCol[v * 3 + 2] = this.col[i * 3 + 2];
        this.qSize[v] = sz; this.qAlpha[v] = al;
      }
    }
    const g = this.points.geometry;
    for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) (g.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.max.fill(0); this.alpha.fill(0); this.size.fill(0); this.alive = 0; }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

const _v = new THREE.Vector3(), _c = new THREE.Color();

export class Effects {
  readonly group = new THREE.Group();
  private puffTex = puffTexture();
  private holeTex = holeTexture();
  private sparks = new Particles(600, this.puffTex, true);
  private dust = new Particles(900, this.puffTex, false);
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private decalMat = new THREE.MeshBasicMaterial({ map: this.holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private decals: THREE.Mesh[] = [];
  stats = { decals: 0, sparks: 0, dust: 0 };

  constructor() {
    this.group.add(this.sparks.points, this.dust.points);
    this.group.name = 'fx';
  }


  /** Bullet / punch impact on a surface: sparks, splinters in the surface colour, dust. */
  impact(p: THREE.Vector3, n: THREE.Vector3, color: THREE.Color | null, strength = 1, metal = false) {
    const ns = Math.round((metal ? 10 : 5) * strength);
    for (let i = 0; i < ns; i++) {
      _v.copy(n).multiplyScalar(150 + Math.random() * 250).add(rndVec(220));
      this.sparks.emit(p, _v, _c.setRGB(1, 0.75 + Math.random() * 0.2, 0.4), 1.4 + Math.random() * 1.2, 0.12 + Math.random() * 0.2, { grav: 500, drag: 2 });
    }
    this.stats.sparks += ns;
    const base = color ?? _c.set('#9c8c78');
    const nd = Math.round(4 * strength);
    for (let i = 0; i < nd; i++) {
      _v.copy(n).multiplyScalar(30 + Math.random() * 60).add(rndVec(25));
      const c = new THREE.Color().copy(base).lerp(new THREE.Color('#d8d2c8'), 0.45);
      this.dust.emit(p, _v, c, 9 + Math.random() * 8, 0.7 + Math.random() * 0.6, { grow: 2.2, grav: -6, drag: 2.5, alpha: 0.42 });
    }
    // splinters: small specks in the surface colour, falling
    const nsp = Math.round(6 * strength);
    for (let i = 0; i < nsp; i++) {
      _v.copy(n).multiplyScalar(120 + Math.random() * 200).add(rndVec(160));
      _v.z += 80;
      this.dust.emit(p, _v, base, 1.2 + Math.random() * 1.4, 0.6 + Math.random() * 0.5, { grav: 900, drag: 0.6, alpha: 1 });
    }
    this.stats.dust += nd + nsp;
  }

  /** Dust cloud where an item bursts (centre, radius). */
  burst(c: THREE.Vector3, r: number, color: THREE.Color) {
    const n = Math.min(26, 8 + Math.round(r / 6));
    for (let i = 0; i < n; i++) {
      const p = c.clone().add(rndVec(r * 0.6));
      _v.copy(rndVec(60)); _v.z = Math.abs(_v.z) * 0.6;
      const col = new THREE.Color().copy(color).lerp(new THREE.Color('#d6d0c6'), 0.55);
      this.dust.emit(p, _v, col, 16 + Math.random() * 20, 1.1 + Math.random() * 0.9, { grow: 2.5, grav: -4, drag: 1.8, alpha: 0.35 });
    }
    this.stats.dust += n;
  }

  /** Decal on `target` at world point p, facing world normal n. */
  decal(target: THREE.Object3D, p: THREE.Vector3, n: THREE.Vector3, size: number) {
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.scale.set(size, size, 1);
    d.position.copy(p).addScaledVector(n, 0.12);
    d.lookAt(_v.copy(d.position).add(n));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.renderOrder = 4;
    d.userData.decal = true;
    target.attach(d);
    this.decals.push(d);
    this.stats.decals++;
    if (this.decals.length > 160) this.decals.shift()!.removeFromParent();
  }

  update(dt: number) { this.sparks.update(dt); this.dust.update(dt); }

  clear() {
    for (const d of this.decals) d.removeFromParent();
    this.decals = [];
    this.sparks.clear(); this.dust.clear();
  }

  get particles() { return this.sparks.alive + this.dust.alive; }

  dispose() {
    this.clear();
    this.sparks.dispose(); this.dust.dispose();
    this.decalGeo.dispose(); this.decalMat.dispose();
    this.puffTex.dispose(); this.holeTex.dispose();
    this.group.removeFromParent();
  }
}

function rndVec(s: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
}
