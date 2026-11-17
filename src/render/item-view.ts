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
import { acquireGeometry, geometryKey, releaseGeometry, type ItemGeometry } from './item-geometry';
import { MaterialLibrary, RO, type VisualState } from './materials';
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
  /** Round beams: the two silhouette generators, rebuilt when the view changes. */
  readonly sil: LineSegments2;
  private silGeo = new LineSegmentsGeometry();
  private silKey = '';
  state: VisualState = 'normal';
  private transformKey = '';
  /** Finish / basket colours the current materials were picked for ('' = theme colours). */
  private matKey = '';

  constructor(item: Item, readonly isGhost = false) {
    this.item = item;
    this.geo = acquireGeometry(item);
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
    this.setItem(item);
  }

  get geoKey(): string { return this.geo.key; }

  /** Update from a (possibly new) item object; swaps geometry when the shape changed. */
  setItem(item: Item) {
    this.item = item;
    if (geometryKey(item) !== this.geo.key) {
      const old = this.geo;
      this.geo = acquireGeometry(item);
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
   * Cylinder silhouette: the generators where the surface turns away from the
   * viewer. `projDir` = world projection direction (towards the scene) for
   * parallel projections; `camPos` for perspective.
   */
  updateSilhouette(projDir: THREE.Vector3, camPos: THREE.Vector3 | null) {
    const c = this.geo.cylinder;
    if (!c) { this.sil.visible = false; return; }
    const inv = this.group.quaternion.clone().invert();
    let dir: THREE.Vector3;
    if (camPos) {
      const centreW = this.content.localToWorld(c.a.clone().lerp(c.b, 0.5));
      dir = centreW.sub(camPos).applyQuaternion(inv);
    } else dir = projDir.clone().applyQuaternion(inv);
    const axis = c.b.clone().sub(c.a).normalize();
    const side = axis.clone().cross(dir);
    if (side.lengthSq() < 1e-8) { this.sil.visible = false; return; } // looking down the axis: circles only
    side.normalize().multiplyScalar(c.r);
    const key = `${side.x.toFixed(3)},${side.y.toFixed(3)},${side.z.toFixed(3)}|${this.geo.key}`;
    this.sil.visible = true;
    if (key === this.silKey) return;
    this.silKey = key;
    const p1 = c.a.clone().add(side), p2 = c.b.clone().add(side);
    const q1 = c.a.clone().sub(side), q2 = c.b.clone().sub(side);
    this.silGeo.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, q1.x, q1.y, q1.z, q2.x, q2.y, q2.z]);
    this.silGeo.computeBoundingSphere();
  }

  /** Finish colours wanted for this item with `lib` ('' = plain theme colours). */
  private finishKey(lib: MaterialLibrary): string {
    if (!lib.mode.finishColors || this.item.kind !== 'kallax') return '';
    return `${effectiveFinish(this.item, store.doc.finish)}|${store.doc.basket ?? 'naturel'}`;
  }

  /** True when the item's finish (or the document's global finish / basket) changed since the last applyMaterials. */
  needsMaterials(lib: MaterialLibrary): boolean { return this.finishKey(lib) !== this.matKey; }

  /** Assign shared materials for the current state / mode. */
  applyMaterials(lib: MaterialLibrary, state: VisualState) {
    this.state = state;
    const transp = lib.mode.transparency;
    this.matKey = this.finishKey(lib);
    const lines = lib.lines[state];
    if (this.matKey && this.item.kind === 'kallax') {
      // Frame (+ wooden fittings) in the finish colour, BRANÄS baskets in rattan (geometry group 1).
      const fin = lib.kallaxFinish(effectiveFinish(this.item, store.doc.finish));
      const bsk = lib.basket(store.doc.basket);
      this.face.material = [fin.face[state], bsk.face[state]];
      this.outer.material = fin.lines[state].outer;
      this.inner.material = fin.lines[state].inner;
      this.fit.material = bsk.lines[state].inner;
    } else {
      this.face.material = (this.item.kind === 'block' ? lib.blockFace : lib.kallaxFace)[state];
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
