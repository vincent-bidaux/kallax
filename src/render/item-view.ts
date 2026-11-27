// Scene representation of one item (Kallax frame or custom block).
//
//   group   (pivot at the bottom centre of the world AABB, rotated about Z)
//   └ content (offset by −local size / 2 so local [0,w]×[0,d]×[0,h] is centred)
//       ├ face     solid faces (hidden-line removal / lighting / shadows) — pickable
//       ├ prepass  depth-only copy of the faces (transparency mode)
//       ├ outer    outer silhouette edges
//       ├ inner    cell-opening edges (Kallax)
//       ├ fit      BRANÄS basket edges (Kallax with baskets)
//       └ hidden   every edge, dashed, drawn only where occluded (transparency)
import * as THREE from 'three';
import { LineSegments2, LineMaterial } from './lines';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { acquireGeometry, geometryKey, releaseGeometry, type ItemGeometry, type WallHole } from './item-geometry';
import { MaterialLibrary, RO, faceSetOf, type VisualState } from './materials';
import { itemBox, localSize, worldSize } from '../core/kallax';
import { effectiveFinish, kallaxLegsColor } from '../core/finishes';
import { EKET_LEG_BY_ID, effectiveEketColor } from '../core/eket';
import { store } from '../core/store';
import { colorOf, type ObjectColor } from '../core/objects';
import { SIL_KEY, type SilhouetteEdges } from './furniture-chairs';
import type { Item } from '../core/types';

export class ItemView {
  readonly group = new THREE.Group();
  readonly content = new THREE.Group();
  readonly box = new THREE.Box3();
  item: Item;
  geo: ItemGeometry;
  readonly face: THREE.Mesh;
  readonly prepass: THREE.Mesh;
  readonly outer: LineSegments2;
  readonly inner: LineSegments2;
  readonly fit: LineSegments2;
  readonly hidden: LineSegments2;
  /** Revolved parts (round beams, lamps, pots): silhouette generators, rebuilt when the view changes. */
  readonly sil: LineSegments2;
  private silGeo = new LineSegmentsGeometry();
  private silKey = '';
  state: VisualState = 'normal';
  private transformKey = '';
  /** Finish / basket colours the current materials were picked for ('' = theme colours). */
  private matKey = '';

  /** Wall openings the current geometry was built with (walls only). */
  private holes: WallHole[] | undefined;

  constructor(item: Item, readonly isGhost = false, holes?: WallHole[]) {
    this.item = item;
    this.holes = holes;
    this.geo = acquireGeometry(item, holes);
    this.face = new THREE.Mesh(this.geo.face);
    this.prepass = new THREE.Mesh(this.geo.face);
    this.outer = new LineSegments2(this.geo.outer);
    this.inner = new LineSegments2(this.geo.inner ?? this.geo.outer);
    this.fit = new LineSegments2(this.geo.basket ?? this.geo.outer);
    this.hidden = new LineSegments2(this.geo.all);
    // The default materials created by the constructors are replaced right away.
    for (const o of [this.face, this.prepass, this.outer, this.inner, this.fit, this.hidden]) {
      (o.material as THREE.Material).dispose();
      this.content.add(o);
    }
    this.inner.visible = !!this.geo.inner;
    this.fit.visible = !!this.geo.basket;
    this.sil = new LineSegments2(this.silGeo);
    (this.sil.material as THREE.Material).dispose();
    this.sil.visible = false;
    this.content.add(this.sil);
    this.group.add(this.content);
    if (!isGhost) {
      this.face.userData.itemId = item.id;
      this.group.userData.itemId = item.id;
      this.face.castShadow = true;
      this.face.receiveShadow = true;
    }
    this.group.name = isGhost ? 'ghost' : `item:${item.id}`;
    this.setItem(item, holes);
  }

  get geoKey(): string { return this.geo.key; }

  /**
   * Update from a (possibly new) item object; swaps geometry when the shape
   * (or, for a wall, the set of openings cut through it) changed.
   */
  setItem(item: Item, holes?: WallHole[]) {
    this.item = item;
    this.holes = holes;
    if (geometryKey(item, holes) !== this.geo.key) {
      const old = this.geo;
      this.geo = acquireGeometry(item, holes);
      this.face.geometry = this.geo.face;
      this.prepass.geometry = this.geo.face;
      this.outer.geometry = this.geo.outer;
      this.inner.geometry = this.geo.inner ?? this.geo.outer;
      this.inner.visible = !!this.geo.inner;
      this.fit.geometry = this.geo.basket ?? this.geo.outer;
      this.fit.visible = !!this.geo.basket;
      this.hidden.geometry = this.geo.all;
      releaseGeometry(old);
    }
    if (!this.isGhost) this.face.userData.itemId = item.id;
    const p = item.position;
    const tx = item.tilt?.x ?? 0, ty = item.tilt?.y ?? 0;
    const key = `${p.x},${p.y},${p.z},${item.rotation},${tx},${ty},${this.geo.key}`;
    if (key === this.transformKey) return;
    this.transformKey = key;
    const ws = worldSize(item), ls = localSize(item);
    // pivot at the centre of the world AABB; R = Rz·Ry·Rx (Euler order 'ZYX')
    this.group.position.set(p.x + ws.w / 2, p.y + ws.d / 2, p.z + ws.h / 2);
    const r = THREE.MathUtils.degToRad;
    this.group.rotation.set(r(tx), r(ty), r(item.rotation), 'ZYX');
    this.content.position.set(-ls.w / 2, -ls.d / 2, -ls.h / 2);
    this.group.updateMatrixWorld(true);
    const b = itemBox(item);
    this.box.min.set(b.min.x, b.min.y, b.min.z);
    this.box.max.set(b.max.x, b.max.y, b.max.z);
  }

  /**
   * View-dependent contour lines:
   * - revolved parts (frusta: cylinders / cones): on each frustum the two
   *   generators where the surface turns away from the viewer;
   * - smooth meshes (moulded shells, cushions: `face.userData[SIL_KEY]`): the
   *   candidate edges whose two adjacent faces lie on either side of the view
   *   direction (one front-facing, one back-facing).
   * `projDir` = world projection direction (towards the scene) for parallel
   * projections; `camPos` for perspective (direction to each part / edge).
   * Everything is computed in the item's content space and only when the view
   * (seen from the item) changed.
   *
   * Frustum a → b (axis u, length L), radii ra → rb, Δr = rb − ra. The surface
   * normal at radial direction e is ∝ L·e − Δr·u, so the contour satisfies
   * e·v = Δr (u·v) / L. With p̂ = the view direction's component ⟂ u and
   * q̂ = u × p̂: e = c·p̂ ± √(1 − c²)·q̂, c = Δr (u·v) / (L |v⊥|). For a
   * cylinder c = 0 → e = ±q̂ = ±normalize(u × v). |c| ≥ 1: the cone is seen
   * from inside its apex angle (only the circles show).
   */
  updateSilhouette(projDir: THREE.Vector3, camPos: THREE.Vector3 | null) {
    const parts = this.geo.frusta;
    const mesh = this.geo.face.userData[SIL_KEY] as SilhouetteEdges | undefined;
    if (!parts?.length && !mesh) { this.sil.visible = false; return; }
    // view as seen from the item (content space)
    const camL = camPos ? this.content.worldToLocal(camPos.clone()) : null;
    const dirL = camPos ? null : projDir.clone().applyQuaternion(this.group.quaternion.clone().invert()).normalize();
    const key = (camL ? `p${camL.x.toFixed(1)},${camL.y.toFixed(1)},${camL.z.toFixed(1)}` : `o${dirL!.x.toFixed(4)},${dirL!.y.toFixed(4)},${dirL!.z.toFixed(4)}`) + '|' + this.geo.key;
    if (key === this.silKey) return;
    this.silKey = key;
    const pos: number[] = [];
    const u = new THREE.Vector3(), v = new THREE.Vector3(), pp = new THREE.Vector3(), q = new THREE.Vector3(), e = new THREE.Vector3();
    for (const f of parts ?? []) {
      if (camL) v.copy(f.a).lerp(f.b, 0.5).sub(camL); else v.copy(dirL!);
      v.normalize();
      u.copy(f.b).sub(f.a);
      const L = u.length();
      if (L < 1e-6) continue;
      u.divideScalar(L);
      const vu = v.dot(u);
      pp.copy(v).addScaledVector(u, -vu);
      const vp = pp.length();
      if (vp < 1e-4) continue; // looking down the axis: circles only
      pp.divideScalar(vp);
      q.copy(u).cross(pp);
      const c = ((f.rb - f.ra) * vu) / (L * vp);
      if (Math.abs(c) >= 1) continue;
      const sn = Math.sqrt(1 - c * c);
      for (const sg of [1, -1]) {
        e.copy(pp).multiplyScalar(c).addScaledVector(q, sg * sn);
        pos.push(f.a.x + e.x * f.ra, f.a.y + e.y * f.ra, f.a.z + e.z * f.ra, f.b.x + e.x * f.rb, f.b.y + e.y * f.rb, f.b.z + e.z * f.rb);
      }
    }
    if (mesh?.tri.length) {
      // smooth contour: zero crossings of the interpolated n·v on each triangle
      const T = mesh.tri, N = mesh.nrm;
      const g = [0, 0, 0];
      let vx = dirL?.x ?? 0, vy = dirL?.y ?? 0, vz = dirL?.z ?? 0;
      for (let t = 0, n = T.length / 9; t < n; t++) {
        const o = t * 9;
        let neg = 0;
        for (let k = 0; k < 3; k++) {
          const q = o + k * 3;
          if (camL) { vx = T[q] - camL.x; vy = T[q + 1] - camL.y; vz = T[q + 2] - camL.z; }
          g[k] = N[q] * vx + N[q + 1] * vy + N[q + 2] * vz;
          if (g[k] < 0) neg++;
        }
        if (neg === 0 || neg === 3) continue;
        for (let k = 0; k < 3; k++) {
          const a = k, b = (k + 1) % 3;
          if ((g[a] < 0) === (g[b] < 0)) continue;
          const s = g[a] / (g[a] - g[b]);
          const qa = o + a * 3, qb = o + b * 3;
          pos.push(T[qa] + (T[qb] - T[qa]) * s, T[qa + 1] + (T[qb + 1] - T[qa + 1]) * s, T[qa + 2] + (T[qb + 2] - T[qa + 2]) * s);
        }
      }
    }
    if (!pos.length) { this.sil.visible = false; return; }
    this.sil.visible = true;
    this.silGeo.dispose();
    this.silGeo = new LineSegmentsGeometry();
    this.silGeo.setPositions(pos);
    this.silGeo.computeBoundingSphere();
    this.sil.geometry = this.silGeo;
  }

  /** Object colour of a block item (IKEA chair colours…), when it has one. */
  private objectColor(): ObjectColor | undefined {
    const it = this.item;
    return it.kind === 'block' && it.shape ? colorOf(it.shape, it.variant, it.color) : undefined;
  }

  /** Finish colours wanted for this item with `lib` ('' = plain theme colours). */
  private finishKey(lib: MaterialLibrary): string {
    const set = faceSetOf(this.item);
    if (!lib.mode.finishColors) return set;
    if (this.item.kind === 'eket') return `${set}|e:${effectiveEketColor(this.item, store.doc.eketFinish)}|${this.item.legs ?? ''}`;
    if (this.item.kind !== 'kallax') {
      const c = this.objectColor();
      return c ? `${set}|o:${c.hex}|${c.hex2 ?? ''}` : set;
    }
    return `${set}|${effectiveFinish(this.item, store.doc.finish)}|${store.doc.basket ?? 'naturel'}|${kallaxLegsColor(this.item).id}`;
  }

  /** True when the item's finish / colour (or the document's global finish / basket) changed since the last applyMaterials. */
  needsMaterials(lib: MaterialLibrary): boolean { return this.finishKey(lib) !== this.matKey; }

  /** Assign shared materials for the current state / mode. */
  applyMaterials(lib: MaterialLibrary, state: VisualState) {
    this.state = state;
    const transp = lib.mode.transparency;
    this.matKey = this.finishKey(lib);
    const lines = lib.lines[state];
    let silLine = lines.outer;
    const oc = lib.mode.finishColors ? this.objectColor() : undefined;
    if (oc) {
      // Object colours: main parts in `hex` (geometry group 0), secondary parts
      // (legs, frame, base…) in `hex2` (group 1); edges in the main colour's tones.
      const main = lib.objectFinish(oc.hex);
      const sec = oc.hex2 ? lib.objectFinish(oc.hex2) : main;
      this.face.material = this.geo.face.groups.length > 1 ? [main.face[state], sec.face[state]] : main.face[state];
      this.outer.material = main.lines[state].outer;
      this.inner.material = main.lines[state].inner;
      this.fit.material = main.lines[state].inner;
      silLine = main.lines[state].outer;
    } else if (lib.mode.finishColors && this.item.kind === 'eket') {
      // carcass in the EKET colour (group 0), legs in their wood / metal tone (group 1)
      const fin = lib.eketFinish(effectiveEketColor(this.item, store.doc.eketFinish));
      const leg = this.item.legs && EKET_LEG_BY_ID[this.item.legs] ? lib.objectFinish(EKET_LEG_BY_ID[this.item.legs].hex) : fin;
      this.face.material = this.geo.face.groups.length > 1 ? [fin.face[state], leg.face[state]] : fin.face[state];
      this.outer.material = fin.lines[state].outer;
      this.inner.material = fin.lines[state].inner;
      this.fit.material = leg.lines[state].outer;
      silLine = leg.lines[state].outer;
    } else if (lib.mode.finishColors && this.item.kind === 'kallax') {
      // Frame (+ wooden fittings) in the finish colour, BRANÄS baskets in rattan (geometry group 1).
      const fin = lib.kallaxFinish(effectiveFinish(this.item, store.doc.finish));
      const bsk = lib.basket(store.doc.basket);
      const und = lib.objectFinish(kallaxLegsColor(this.item).hex);
      this.face.material = [fin.face[state], bsk.face[state], und.face[state]];
      this.outer.material = fin.lines[state].outer;
      this.inner.material = fin.lines[state].inner;
      this.fit.material = bsk.lines[state].inner;
    } else {
      this.face.material = lib.faceSet(faceSetOf(this.item))[state];
      this.outer.material = lines.outer;
      this.inner.material = lines.inner;
      this.fit.material = lines.inner;
    }
    this.prepass.material = lib.prepass;
    this.hidden.material = lib.hidden;
    this.sil.material = silLine;
    this.sil.renderOrder = state !== 'normal' ? RO.line + 0.5 : RO.line;

    this.prepass.visible = transp;
    this.hidden.visible = transp;
    this.inner.visible = !!this.geo.inner;
    this.fit.visible = !!this.geo.basket;

    this.prepass.renderOrder = RO.prepass;
    this.face.renderOrder = RO.face;
    this.outer.renderOrder = RO.line;
    this.inner.renderOrder = RO.line;
    this.fit.renderOrder = RO.line;
    this.hidden.renderOrder = RO.hidden;
    // Selected / hovered edges win over neighbours' coincident edges.
    if (state !== 'normal') { this.outer.renderOrder = RO.line + 0.5; this.inner.renderOrder = RO.line + 0.5; this.fit.renderOrder = RO.line + 0.5; }
  }

  applyGhostMaterials(lib: MaterialLibrary, valid: boolean) {
    const g = lib.ghost[valid ? 'ok' : 'bad'];
    this.face.material = g.face;
    this.prepass.material = g.prepass;
    this.outer.material = g.outer;
    this.inner.material = g.inner;
    this.fit.material = g.inner;
    this.hidden.material = g.hidden;
    this.sil.material = g.outer;
    this.sil.renderOrder = RO.ghostLine;
    this.prepass.visible = true;
    this.hidden.visible = true;
    this.inner.visible = !!this.geo.inner;
    this.fit.visible = !!this.geo.basket;
    this.prepass.renderOrder = RO.ghostPrepass;
    this.face.renderOrder = RO.ghostFace;
    this.outer.renderOrder = RO.ghostLine;
    this.inner.renderOrder = RO.ghostLine;
    this.fit.renderOrder = RO.ghostLine;
    this.hidden.renderOrder = RO.ghostHidden;
    this.face.castShadow = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.silGeo.dispose();
    releaseGeometry(this.geo);
  }
}

export type { LineMaterial };
