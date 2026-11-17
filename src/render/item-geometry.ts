// Shared, ref-counted geometry for item meshes: one entry per Kallax
// configuration (cols×rows) or block size. Local space: the item occupies
// [0,w] × [0,d] × [0,h] (unrotated), front opening at y = 0.
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { KALLAX, kallaxOuter, localSize } from '../core/kallax';
import type { Item, Size3 } from '../core/types';

export interface ItemGeometry {
  key: string;
  size: Size3;
  /** Face mesh (solid, used for hidden-line removal / lighting / shadows). */
  face: THREE.BufferGeometry;
  /** Outer silhouette edges (front rect, back rect, 4 depth edges). */
  outer: LineSegmentsGeometry;
  /** Cell openings (Kallax only). */
  inner: LineSegmentsGeometry | null;
  /** Every edge, with line distances (for dashed hidden edges). */
  all: LineSegmentsGeometry;
  refs: number;
}

const cache = new Map<string, ItemGeometry>();

export function geometryKey(item: Item): string {
  if (item.kind === 'kallax') return `k${item.cols}x${item.rows}`;
  const s = item.size;
  return `b${s.w}x${s.d}x${s.h}`;
}

export function acquireGeometry(item: Item): ItemGeometry {
  const key = geometryKey(item);
  let g = cache.get(key);
  if (!g) {
    g = item.kind === 'kallax' ? buildKallax(key, item.cols, item.rows) : buildBlock(key, localSize(item));
    cache.set(key, g);
  }
  g.refs++;
  return g;
}

export function releaseGeometry(g: ItemGeometry) {
  g.refs--;
  if (g.refs > 0) return;
  cache.delete(g.key);
  g.face.dispose();
  g.outer.dispose();
  g.inner?.dispose();
  g.all.dispose();
}

// ── edge helpers (x, z = front plane coords; y = depth) ──────────────────
function pushSeg(out: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  out.push(ax, ay, az, bx, by, bz);
}
function pushRect(out: number[], x0: number, z0: number, x1: number, z1: number, y: number) {
  pushSeg(out, x0, y, z0, x1, y, z0);
  pushSeg(out, x1, y, z0, x1, y, z1);
  pushSeg(out, x1, y, z1, x0, y, z1);
  pushSeg(out, x0, y, z1, x0, y, z0);
}
/** Front rect, back rect and the 4 depth edges of an axis-aligned "tube" along Y. */
function pushTube(out: number[], x0: number, z0: number, x1: number, z1: number, d: number) {
  pushRect(out, x0, z0, x1, z1, 0);
  pushRect(out, x0, z0, x1, z1, d);
  pushSeg(out, x0, 0, z0, x0, d, z0);
  pushSeg(out, x1, 0, z0, x1, d, z0);
  pushSeg(out, x1, 0, z1, x1, d, z1);
  pushSeg(out, x0, 0, z1, x0, d, z1);
}

function lineGeo(positions: number[], withDistances = false): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  g.setPositions(new Float32Array(positions));
  if (withDistances) {
    // Per-segment distances (each segment starts a fresh dash pattern, so
    // corners look tidy). Same layout as LineSegments2.computeLineDistances.
    const n = positions.length / 6;
    const dist = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      dist[2 * i] = 0;
      dist[2 * i + 1] = Math.hypot(positions[o + 3] - positions[o], positions[o + 4] - positions[o + 1], positions[o + 5] - positions[o + 2]);
    }
    const buf = new THREE.InstancedInterleavedBuffer(dist, 2, 1);
    g.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(buf, 1, 0));
    g.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(buf, 1, 1));
  }
  g.computeBoundingSphere();
  return g;
}

/** Cell opening rectangles (x0, z0, x1, z1) of a Kallax frame. */
export function kallaxCells(cols: number, rows: number): [number, number, number, number][] {
  const cells: [number, number, number, number][] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x0 = KALLAX.outerPanel + i * (KALLAX.cell + KALLAX.divider);
      const z0 = KALLAX.outerPanel + j * (KALLAX.cell + KALLAX.divider);
      cells.push([x0, z0, x0 + KALLAX.cell, z0 + KALLAX.cell]);
    }
  }
  return cells;
}

function buildKallax(key: string, cols: number, rows: number): ItemGeometry {
  const W = kallaxOuter(cols), H = kallaxOuter(rows), D = KALLAX.depth;
  const cells = kallaxCells(cols, rows);

  // Faces: the front outline with one hole per cell, extruded through the depth.
  // Shape space (u, v) = (x, z); extrusion along w. rotateX(+90°) maps
  // (u, v, w) → (u, −w, v); translating by +D puts the depth in [0, D].
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(W, 0); shape.lineTo(W, H); shape.lineTo(0, H); shape.closePath();
  for (const [x0, z0, x1, z1] of cells) {
    const hole = new THREE.Path();
    hole.moveTo(x0, z0); hole.lineTo(x0, z1); hole.lineTo(x1, z1); hole.lineTo(x1, z0); hole.closePath();
    shape.holes.push(hole);
  }
  const face = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, steps: 1, curveSegments: 1 });
  face.rotateX(Math.PI / 2);
  face.translate(0, D, 0);
  face.computeVertexNormals();
  face.computeBoundingBox();
  face.computeBoundingSphere();

  const outer: number[] = [];
  pushTube(outer, 0, 0, W, H, D);
  const inner: number[] = [];
  for (const [x0, z0, x1, z1] of cells) pushTube(inner, x0, z0, x1, z1, D);

  return {
    key,
    size: { w: W, d: D, h: H },
    face,
    outer: lineGeo(outer),
    inner: lineGeo(inner),
    all: lineGeo([...outer, ...inner], true),
    refs: 0,
  };
}

function buildBlock(key: string, s: Size3): ItemGeometry {
  const w = Math.max(s.w, 0.1), d = Math.max(s.d, 0.1), h = Math.max(s.h, 0.1);
  const face = new THREE.BoxGeometry(w, d, h);
  face.translate(w / 2, d / 2, h / 2);
  face.computeBoundingSphere();
  const outer: number[] = [];
  pushTube(outer, 0, 0, w, h, d);
  return {
    key,
    size: { w, d, h },
    face,
    outer: lineGeo(outer),
    inner: null,
    all: lineGeo(outer, true),
    refs: 0,
  };
}
