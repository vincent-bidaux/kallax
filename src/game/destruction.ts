// ─────────────────────────────────────────────────────────────
// Game mode — destruction: item health, piece detachment, lightweight debris
// physics, falling stacks, completion.
//
//   · fists: an item takes 3 hits (4 for big ones); each hit but the last
//     knocks off the ~20 % of its pieces nearest to the impact with small
//     impulses, the last one bursts every remaining piece;
//   · shotgun: one shot destroys the item, every piece blown outwards from
//     the hit point;
//   · debris: oriented boxes (position, velocity, quaternion, angular
//     velocity), gravity 9.81 m/s², bounce + friction on the floor and on the
//     tops of the remaining items, pushed out of walls / items sideways,
//     settle flat, sleep when slow, fade out and vanish after 6–10 s; at most
//     400 pieces (the oldest go first); landing sounds by impact speed;
//   · items resting on a destroyed item fall (gravity) until they rest on the
//     floor or another item, with their colliders.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { Collider } from './world';
import { contact } from './world';
import type { BuiltScene, GameItem, Piece } from './scene-build';
import { obbOf } from './scene-build';
import { obbFootprintOverlap } from '../core/obb';
import type { Effects } from './fx';
import type { GameAudio } from './audio';

const G = 981;
const MAX_DEBRIS = 400;

interface Debris {
  mesh: THREE.Mesh;
  piece: Piece;
  item: GameItem;
  v: THREE.Vector3;
  w: THREE.Vector3;
  age: number;
  life: number;
  sleeping: boolean;
  onGround: boolean;
  /** Item whose top it rests on (null = floor). */
  restOn: string | null;
  still: number;
  fadeMat: THREE.Material | null;
  lastSound: number;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _axis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const Z = new THREE.Vector3(0, 0, 1);

export interface HitInfo {
  point: THREE.Vector3;
  dir: THREE.Vector3;
  weapon: 'fists' | 'shotgun';
}

export class Destruction {
  readonly debris: Debris[] = [];
  readonly root = new THREE.Group();
  stats = { detached: 0, destroyedItems: 0, removed: 0, landed: 0, falls: 0 };
  /** Stereo pan of a world point (set by the game). */
  panOf: (p: THREE.Vector3) => number = () => 0;
  onItemDestroyed: (g: GameItem) => void = () => {};

  constructor(private s: BuiltScene, private colliders: Collider[], private fx: Effects, private audio: GameAudio) {
    this.root.name = 'debris';
  }

  completion(): number {
    if (this.s.totalVolume <= 0) return 1;
    let d = 0;
    for (const g of this.s.items) if (g.destructible) d += g.destroyed ? g.volume : g.destroyedVol;
    return Math.min(1, d / this.s.totalVolume);
  }

  get remaining(): number { return this.s.items.filter(g => g.destructible && !g.destroyed).length; }
  get destroyedCount(): number { return this.s.items.filter(g => g.destructible && g.destroyed).length; }

  // ── damage ─────────────────────────────────────────────────
  damage(g: GameItem, hit: HitInfo): { destroyed: boolean; detached: number } {
    if (!g.destructible || g.destroyed) return { destroyed: false, detached: 0 };
    this.breakApart(g);
    g.hits++;
    const alive = g.pieces.map((_, i) => i).filter(i => g.attached[i]);
    let list: number[];
    const final = hit.weapon === 'shotgun' || g.hits >= g.hitsNeeded;
    if (final) list = alive;
    else {
      // the pieces nearest to the impact
      const wp = alive.map(i => ({ i, d: this.pieceWorld(g, i).distanceToSquared(hit.point) })).sort((a, b) => a.d - b.d);
      const n = Math.max(1, Math.min(alive.length - 1, Math.round(g.pieces.length * 0.2)));
      list = wp.slice(0, n).map(e => e.i);
    }
    const strength = hit.weapon === 'shotgun' ? 1 : final ? 0.7 : 0.35;
    for (const i of list) this.detach(g, i, hit, strength);
    const size = Math.min(1, Math.cbrt(g.volume) / 60);
    const snd = this.dominantSound(g);
    this.audio.woodBreak(final ? Math.max(0.5, size) : size * 0.5, snd);
    if (g.attached.every(a => !a)) this.finish(g, hit.point);
    return { destroyed: g.destroyed, detached: list.length };
  }

  private dominantSound(g: GameItem): 'wood' | 'metal' | 'soft' {
    const v = { wood: 0, metal: 0, soft: 0 };
    for (const p of g.pieces) v[p.snd] += p.vol;
    return v.soft > v.wood && v.soft > v.metal ? 'soft' : v.metal > v.wood ? 'metal' : 'wood';
  }

  /** Swap the merged intact meshes for the individual piece meshes. */
  breakApart(g: GameItem) {
    if (g.broken) return;
    g.broken = true;
    if (g.intact) {
      g.intact.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      g.intact.removeFromParent();
      g.intact = null;
    }
    g.pieces.forEach((p, i) => {
      if (!g.attached[i]) return;
      const m = new THREE.Mesh(p.geo, p.mat);
      m.position.copy(p.c);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.itemId = g.id; m.userData.piece = i;
      g.content.add(m);
      g.meshes[i] = m;
    });
    g.content.updateMatrixWorld(true);
  }

  private pieceWorld(g: GameItem, i: number): THREE.Vector3 {
    return g.content.localToWorld(g.pieces[i].c.clone());
  }

  private detach(g: GameItem, i: number, hit: HitInfo, strength: number) {
    const m = g.meshes[i];
    if (!m || !g.attached[i]) return;
    g.attached[i] = false;
    g.meshes[i] = null;
    g.destroyedVol += g.pieces[i].vol;
    this.root.attach(m);           // keeps the world transform
    m.userData.debris = true;
    const p = m.position;
    const away = _v.subVectors(p, hit.point);
    const dist = Math.max(1, away.length());
    away.divideScalar(dist);
    const v = new THREE.Vector3();
    if (hit.weapon === 'shotgun') {
      const k = Math.max(0.35, 1 - dist / 260);
      v.copy(away).multiplyScalar((380 + Math.random() * 520) * k).addScaledVector(hit.dir, 260 * k);
      v.z += 120 + Math.random() * 260;
    } else {
      v.copy(away).multiplyScalar((60 + Math.random() * 140) * (0.6 + strength)).addScaledVector(hit.dir, 140 + 200 * strength);
      v.z += 40 + Math.random() * 120;
    }
    v.x += (Math.random() - 0.5) * 60; v.y += (Math.random() - 0.5) * 60;
    const spin = hit.weapon === 'shotgun' ? 14 : 6;
    const w = new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    // light pieces fly further
    const mass = Math.cbrt(Math.max(1, g.pieces[i].vol));
    v.multiplyScalar(THREE.MathUtils.clamp(14 / mass, 0.55, 1.5));
    this.addDebris({ mesh: m, piece: g.pieces[i], item: g, v, w, age: 0, life: 6 + Math.random() * 4, sleeping: false, onGround: false, restOn: null, still: 0, fadeMat: null, lastSound: -1 });
    this.stats.detached++;
  }

  private addDebris(d: Debris) {
    if (this.debris.length >= MAX_DEBRIS) {
      // retire the oldest (prefer sleeping ones)
      let k = this.debris.findIndex(x => x.sleeping && x.age < x.life - 0.4);
      if (k < 0) k = 0;
      const o = this.debris[k];
      o.life = Math.min(o.life, o.age + 0.4);
      if (this.debris.length >= MAX_DEBRIS + 40) this.removeDebris(k);
    }
    this.debris.push(d);
  }

  private finish(g: GameItem, at: THREE.Vector3) {
    g.destroyed = true;
    this.stats.destroyedItems++;
    // colliders go
    for (let k = this.colliders.length - 1; k >= 0; k--) if (this.colliders[k].item === g.id) this.colliders.splice(k, 1);
    const o = obbOf(g);
    const col = (g.pieces[0]?.mat as THREE.MeshStandardMaterial)?.color ?? new THREE.Color('#bba');
    this.fx.burst(new THREE.Vector3(o.c.x, o.c.y, o.c.z).lerp(at, 0.3), Math.max(o.h.x, o.h.y, o.h.z), col);
    this.onItemDestroyed(g);
  }

  // ── simulation ─────────────────────────────────────────────
  update(dt: number, now: number) {
    this.updateFalls(dt);
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.age += dt;
      if (d.age >= d.life) { this.removeDebris(k); continue; }
      if (d.age > d.life - 1) this.fade(d, (d.life - d.age) / 1);
      if (d.sleeping) {
        if (d.restOn) { const s = this.s.byId.get(d.restOn); if (!s || s.destroyed || s.falling) { d.sleeping = false; d.onGround = false; } }
        if (d.sleeping) continue;
      }
      this.integrate(d, Math.min(dt, 1 / 30), now);
    }
  }

  private integrate(d: Debris, dt: number, now: number) {
    const m = d.mesh;
    d.v.z -= G * dt;
    m.position.addScaledVector(d.v, dt);
    // orientation: q += ½ ω q dt
    const wl = d.w.length();
    if (wl > 1e-4) { _q.setFromAxisAngle(_v.copy(d.w).divideScalar(wl), wl * dt); m.quaternion.premultiply(_q).normalize(); }
    _m.makeRotationFromQuaternion(m.quaternion);
    const e = _m.elements;
    const h = d.piece.half;
    // world half extents of the rotated box
    const ex = Math.abs(e[0]) * h.x + Math.abs(e[4]) * h.y + Math.abs(e[8]) * h.z;
    const ey = Math.abs(e[1]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[9]) * h.z;
    const ez = Math.abs(e[2]) * h.x + Math.abs(e[6]) * h.y + Math.abs(e[10]) * h.z;
    const p = m.position;
    // supporting surface below: floor, or the top of a remaining item under the centre
    let floor = 0, restOn: string | null = null;
    const rh = Math.min(ex, ey, 6);
    for (const k of this.colliders) {
      if (k.z1 <= floor || k.z1 > p.z + 2) continue;
      if (k.hy < 1.5 || k.hx < 1.5) continue;        // walls are not shelves
      if (contact(k, p.x, p.y, 0.01) || insideFootprint(k, p.x, p.y)) { floor = k.z1; restOn = k.item; }
    }
    // sideways: out of walls / item boxes overlapping the piece's height
    const r = Math.max(2, Math.min(Math.max(ex, ey), 10));
    for (const k of this.colliders) {
      if (k.z1 <= p.z - ez + 1 || k.z0 >= p.z + ez - 1) continue;
      if (k.z1 <= floor + 0.5 && restOn === k.item) continue;
      const c = contact(k, p.x, p.y, r);
      if (!c) continue;
      p.x += c.nx * c.depth; p.y += c.ny * c.depth;
      const vn = d.v.x * c.nx + d.v.y * c.ny;
      if (vn < 0) {
        d.v.x -= 1.35 * vn * c.nx; d.v.y -= 1.35 * vn * c.ny;
        d.w.multiplyScalar(0.8);
        if (-vn > 120) this.sound(d, -vn * 0.7, now);
      }
    }
    void rh;
    d.onGround = false;
    if (p.z - ez <= floor) {
      p.z = floor + ez;
      d.restOn = restOn;
      const impact = -d.v.z;
      if (impact > 0) {
        if (impact > 70) this.sound(d, impact, now);
        d.v.z = impact > 45 ? impact * 0.26 : 0;
        d.v.x *= 0.78; d.v.y *= 0.78;
        // impacts turn linear speed into spin a little
        d.w.multiplyScalar(0.72);
        if (impact > 150) d.w.add(_v.set(d.v.y, -d.v.x, 0).multiplyScalar(0.004));
      }
      d.onGround = true;
      const fr = Math.max(0, 1 - 5.5 * dt);
      d.v.x *= fr; d.v.y *= fr;
      d.w.multiplyScalar(Math.max(0, 1 - 4 * dt));
      const sp = Math.hypot(d.v.x, d.v.y, d.v.z);
      if (sp < 45) {
        // settle on its nearest flat face
        let best = 0, bv = 0;
        for (let a = 0; a < 3; a++) { _axis[a].set(e[a * 4], e[a * 4 + 1], e[a * 4 + 2]); const z = Math.abs(_axis[a].z); if (z > bv) { bv = z; best = a; } }
        const ax = _axis[best];
        _q2.setFromUnitVectors(_v2.copy(ax).multiplyScalar(Math.sign(ax.z) || 1), Z);
        _q.copy(_q2).multiply(m.quaternion);
        m.quaternion.slerp(_q, Math.min(1, dt * 7));
        d.w.multiplyScalar(Math.max(0, 1 - 8 * dt));
        if (sp < 6 && d.w.length() < 0.4 && bv > 0.995) { d.still += dt; if (d.still > 0.25) { d.sleeping = true; d.v.set(0, 0, 0); d.w.set(0, 0, 0); } }
        else d.still = 0;
      }
    }
  }

  private sound(d: Debris, speed: number, now: number) {
    if (now - d.lastSound < 0.12) return;
    d.lastSound = now;
    this.stats.landed++;
    this.audio.debris(speed * Math.min(1.4, Math.cbrt(d.piece.vol) / 14 + 0.3), d.piece.snd, this.panOf(d.mesh.position));
  }

  private fade(d: Debris, k: number) {
    if (!d.fadeMat) {
      d.fadeMat = d.mesh.material instanceof THREE.Material ? d.mesh.material.clone() : null;
      if (d.fadeMat) { d.fadeMat.transparent = true; d.fadeMat.depthWrite = false; d.mesh.material = d.fadeMat; d.mesh.castShadow = false; }
    }
    if (d.fadeMat) d.fadeMat.opacity = Math.max(0, k);
    const s = 0.6 + 0.4 * Math.max(0, k);
    d.mesh.scale.setScalar(s);
  }

  private removeDebris(k: number) {
    const d = this.debris[k];
    d.mesh.removeFromParent();
    d.fadeMat?.dispose();
    this.debris.splice(k, 1);
    this.stats.removed++;
  }

  // ── falling stacks ─────────────────────────────────────────
  private top(o: GameItem) { return o.z1 + o.dz; }
  private bottom(g: GameItem) { return g.z0 + g.dz; }

  private updateFalls(dt: number) {
    for (const g of this.s.items) {
      if (!g.destructible || g.destroyed) continue;
      if (!g.falling) {
        if (!g.supporters.length) continue;
        const ok = g.supporters.some(id => {
          const s = this.s.byId.get(id);
          return !!s && !s.destroyed && !s.falling && Math.abs(this.top(s) - this.bottom(g)) < 2.5;
        });
        if (!ok) { g.falling = true; g.vz = 0; this.stats.falls++; }
        continue;
      }
      const b0 = this.bottom(g);
      g.vz -= G * dt;
      let dz = g.vz * dt;
      // landing surface: floor or the highest intact item top below
      let surf = 0;
      const sup: string[] = [];
      const A = obbOf(g);
      for (const o of this.s.items) {
        if (o === g || o.destroyed || o.falling || !this.supports(o)) continue;
        const t = this.top(o);
        if (t > b0 + 1 || t < surf - 0.01) continue;
        if (!obbFootprintOverlap(A, obbOf(o), 0.5)) continue;
        if (t > surf + 0.01) { surf = t; sup.length = 0; }
        sup.push(o.id);
      }
      if (b0 + dz <= surf) {
        dz = surf - b0;
        const impact = -g.vz;
        g.falling = false; g.vz = 0;
        g.supporters = surf > 0.5 ? sup : [];
        this.audio.itemLand(Math.min(1, Math.cbrt(g.volume) / 60) * Math.min(1, impact / 400));
        const o = obbOf(g);
        this.fx.burst(new THREE.Vector3(o.c.x, o.c.y, surf + 4), Math.max(o.h.x, o.h.y) * 0.8, new THREE.Color('#c9bba5'));
      }
      this.moveItem(g, dz);
    }
  }

  private supports(o: GameItem) {
    const s = o.src;
    return !(s.kind === 'block' && (s.shape === 'wall' || s.shape === 'door' || s.shape === 'window'));
  }

  private moveItem(g: GameItem, dz: number) {
    if (!dz) return;
    g.dz += dz;
    g.root.position.z += dz;
    g.root.updateMatrixWorld(true);
    for (const k of this.colliders) if (k.item === g.id) { k.z0 += dz; k.z1 += dz; }
  }

  clear() {
    for (let k = this.debris.length - 1; k >= 0; k--) this.removeDebris(k);
    this.root.clear();
  }
}

function insideFootprint(k: Collider, x: number, y: number): boolean {
  const dx = x - k.cx, dy = y - k.cy;
  const lx = dx * k.ux + dy * k.uy, ly = -dx * k.uy + dy * k.ux;
  return Math.abs(lx) <= k.hx && Math.abs(ly) <= k.hy;
}
