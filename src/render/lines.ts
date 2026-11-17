// Screen-space fat lines (constant pixel width whatever the zoom) — the
// "vector drawing" look. Every LineMaterial created here is tracked so
// its resolution follows the canvas size.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const materials = new Set<LineMaterial>();
const resolution = new THREE.Vector2(1, 1);

export function setLineResolution(w: number, h: number) {
  resolution.set(w, h);
  for (const m of materials) m.resolution.set(w, h);
}

export interface LineOpts {
  color: string;
  /** CSS px */
  width: number;
  opacity?: number;
  dashed?: boolean;
  dashSize?: number; // world units (cm)
  gapSize?: number;
  depthTest?: boolean;
  /** Pull lines slightly towards the camera so they win over coplanar faces. */
  renderOrder?: number;
}

export function makeLineMaterial(o: LineOpts): LineMaterial {
  const m = new LineMaterial({
    color: new THREE.Color(o.color).getHex(),
    linewidth: o.width * (window.devicePixelRatio > 1 ? 1 : 1),
    transparent: (o.opacity ?? 1) < 1 || !!o.dashed,
    opacity: o.opacity ?? 1,
    dashed: !!o.dashed,
    dashSize: o.dashSize ?? 2,
    gapSize: o.gapSize ?? 1.5,
    depthTest: o.depthTest ?? true,
    worldUnits: false,
  });
  m.resolution.copy(resolution);
  materials.add(m);
  return m;
}

export function disposeLineMaterial(m: LineMaterial) {
  materials.delete(m);
  m.dispose();
}

/** `positions` = flat array of segment pairs [x1,y1,z1, x2,y2,z2, ...] in world cm. */
export function makeLines(positions: number[] | Float32Array, o: LineOpts): LineSegments2 {
  const g = new LineSegmentsGeometry();
  g.setPositions(positions instanceof Float32Array ? positions : new Float32Array(positions));
  const line = new LineSegments2(g, makeLineMaterial(o));
  if (o.dashed) line.computeLineDistances();
  line.renderOrder = o.renderOrder ?? 2;
  return line;
}

/** Dispose geometry + tracked material of a fat line (or any object tree containing them). */
export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((c: any) => {
    c.geometry?.dispose?.();
    const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    for (const m of mats) {
      if (m instanceof LineMaterial) disposeLineMaterial(m);
      else m.dispose?.();
    }
  });
}

export { LineSegments2, LineMaterial };
