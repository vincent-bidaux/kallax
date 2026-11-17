// Scene representation of one item (Kallax frame or custom block).
//
//   group   (pivot at the bottom centre of the world AABB, rotated about Z)
//   └ content (offset by −local size / 2 so local [0,w]×[0,d]×[0,h] is centred)
//       ├ face     solid faces (hidden-line removal / lighting / shadows) — pickable
//       ├ prepass  depth-only copy of the faces (transparency mode)
//       ├ outer    outer silhouette edges
//       ├ inner    cell-opening edges (Kallax)
//       └ hidden   every edge, dashed, drawn only where occluded (transparency)
import * as THREE from 'three';
import { LineSegments2, LineMaterial } from './lines';
import { acquireGeometry, geometryKey, releaseGeometry, type ItemGeometry } from './item-geometry';
import { MaterialLibrary, RO, type VisualState } from './materials';
import { itemBox, localSize, worldSize } from '../core/kallax';
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
  readonly hidden: LineSegments2;
  state: VisualState = 'normal';
  private transformKey = '';

  constructor(item: Item, readonly isGhost = false) {
    this.item = item;
    this.geo = acquireGeometry(item);
    this.face = new THREE.Mesh(this.geo.face);
    this.prepass = new THREE.Mesh(this.geo.face);
    this.outer = new LineSegments2(this.geo.outer);
    this.inner = new LineSegments2(this.geo.inner ?? this.geo.outer);
    this.hidden = new LineSegments2(this.geo.all);
    // The default materials created by the constructors are replaced right away.
    for (const o of [this.face, this.prepass, this.outer, this.inner, this.hidden]) {
      (o.material as THREE.Material).dispose();
      this.content.add(o);
    }
    this.inner.visible = !!this.geo.inner;
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
      this.hidden.geometry = this.geo.all;
      releaseGeometry(old);
    }
    if (!this.isGhost) this.face.userData.itemId = item.id;
    const p = item.position;
    const key = `${p.x},${p.y},${p.z},${item.rotation},${this.geo.key}`;
    if (key === this.transformKey) return;
    this.transformKey = key;
    const ws = worldSize(item), ls = localSize(item);
    this.group.position.set(p.x + ws.w / 2, p.y + ws.d / 2, p.z);
    this.group.rotation.set(0, 0, THREE.MathUtils.degToRad(item.rotation));
    this.content.position.set(-ls.w / 2, -ls.d / 2, 0);
    this.group.updateMatrixWorld(true);
    const b = itemBox(item);
    this.box.min.set(b.min.x, b.min.y, b.min.z);
    this.box.max.set(b.max.x, b.max.y, b.max.z);
  }

  /** Assign shared materials for the current state / mode. */
  applyMaterials(lib: MaterialLibrary, state: VisualState) {
    this.state = state;
    const transp = lib.mode.transparency;
    const faces = this.item.kind === 'block' ? lib.blockFace : lib.kallaxFace;
    this.face.material = faces[state];
    this.prepass.material = lib.prepass;
    this.outer.material = lib.lines[state].outer;
    this.inner.material = lib.lines[state].inner;
    this.hidden.material = lib.hidden;

    this.prepass.visible = transp;
    this.hidden.visible = transp;
    this.inner.visible = !!this.geo.inner;

    this.prepass.renderOrder = RO.prepass;
    this.face.renderOrder = RO.face;
    this.outer.renderOrder = RO.line;
    this.inner.renderOrder = RO.line;
    this.hidden.renderOrder = RO.hidden;
    // Selected / hovered edges win over neighbours' coincident edges.
    if (state !== 'normal') { this.outer.renderOrder = RO.line + 0.5; this.inner.renderOrder = RO.line + 0.5; }
  }

  applyGhostMaterials(lib: MaterialLibrary, valid: boolean) {
    const g = lib.ghost[valid ? 'ok' : 'bad'];
    this.face.material = g.face;
    this.prepass.material = g.prepass;
    this.outer.material = g.outer;
    this.inner.material = g.inner;
    this.hidden.material = g.hidden;
    this.prepass.visible = true;
    this.hidden.visible = true;
    this.inner.visible = !!this.geo.inner;
    this.prepass.renderOrder = RO.ghostPrepass;
    this.face.renderOrder = RO.ghostFace;
    this.outer.renderOrder = RO.ghostLine;
    this.inner.renderOrder = RO.ghostLine;
    this.hidden.renderOrder = RO.ghostHidden;
    this.face.castShadow = false;
  }

  dispose() {
    this.group.removeFromParent();
    releaseGeometry(this.geo);
  }
}

export type { LineMaterial };
