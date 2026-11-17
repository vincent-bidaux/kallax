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
import { effectiveFinish } from '../core/finishes';
import { store } from '../core/store';
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
   * Silhouette generators of the revolved parts: on each frustum (cylinder or
   * cone) the two lines where the surface turns away from the viewer.
   * `projDir` = world projection direction (towards the scene) for parallel
   * projections; `camPos` for perspective (direction to each part's centre).
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
    if (!parts?.length) { this.sil.visible = false; return; }
    const inv = this.group.quaternion.clone().invert();
    const pos: number[] = [];
    const u = new THREE.Vector3(), v = new THREE.Vector3(), pp = new THREE.Vector3(), q = new THREE.Vector3(), e = new THREE.Vector3();
    for (const f of parts) {
      if (camPos) {
        const centreW = this.content.localToWorld(f.a.clone().lerp(f.b, 0.5));
        v.copy(centreW).sub(camPos).applyQuaternion(inv);
      } else v.copy(projDir).applyQuaternion(inv);
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
    if (!pos.length) { this.sil.visible = false; return; }
    this.sil.visible = true;
    const key = pos.map(x => x.toFixed(2)).join(',') + '|' + this.geo.key;
    if (key === this.silKey) return;
    this.silKey = key;
    this.silGeo.dispose();
    this.silGeo = new LineSegmentsGeometry();
    this.silGeo.setPositions(pos);
    this.silGeo.computeBoundingSphere();
    this.sil.geometry = this.silGeo;
  }

  /** Finish colours wanted for this item with `lib` ('' = plain theme colours). */
  private finishKey(lib: MaterialLibrary): string {
    const set = faceSetOf(this.item);
    if (!lib.mode.finishColors || this.item.kind !== 'kallax') return set;
    return `${set}|${effectiveFinish(this.item, store.doc.finish)}|${store.doc.basket ?? 'naturel'}`;
  }

  /** True when the item's finish (or the document's global finish / basket) changed since the last applyMaterials. */
  needsMaterials(lib: MaterialLibrary): boolean { return this.finishKey(lib) !== this.matKey; }

  /** Assign shared materials for the current state / mode. */
  applyMaterials(lib: MaterialLibrary, state: VisualState) {
    this.state = state;
    const transp = lib.mode.transparency;
    this.matKey = this.finishKey(lib);
    const lines = lib.lines[state];
    if (lib.mode.finishColors && this.item.kind === 'kallax') {
      // Frame (+ wooden fittings) in the finish colour, BRANÄS baskets in rattan (geometry group 1).
      const fin = lib.kallaxFinish(effectiveFinish(this.item, store.doc.finish));
      const bsk = lib.basket(store.doc.basket);
      this.face.material = [fin.face[state], bsk.face[state]];
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
    this.sil.material = lines.outer;
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
