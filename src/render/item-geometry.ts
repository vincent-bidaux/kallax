// Shared, ref-counted geometry for item meshes: one entry per Kallax
// configuration (cols×rows) or block size. Local space: the item occupies
// [0,w] × [0,d] × [0,h] (unrotated), front opening at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { KALLAX, kallaxOuter, localSize, validInserts } from '../core/kallax';
import type { InsertType } from '../core/types';
import type { Item, Size3 } from '../core/types';

export interface CylinderInfo {
  /** Axis end points (local, content space) and radius. */
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

export interface ItemGeometry {
  /** Set for round beams: silhouette generators are view-dependent. */
  cylinder?: CylinderInfo;
  key: string;
  size: Size3;
  /** Face mesh (solid, used for hidden-line removal / lighting / shadows). */
  face: THREE.BufferGeometry;
  /** Outer silhouette edges (front rect, back rect, 4 depth edges). */
  outer: LineSegmentsGeometry;
  /** Cell openings (Kallax only). */
  inner: LineSegmentsGeometry | null;
  /** BRANÄS basket edges (Kallax with baskets), drawn apart so they can take the rattan tone. */
  basket: LineSegmentsGeometry | null;
  /** Every edge, with line distances (for dashed hidden edges). */
  all: LineSegmentsGeometry;
  refs: number;
}

const cache = new Map<string, ItemGeometry>();

export function geometryKey(item: Item): string {
  if (item.kind === 'kallax') {
    const ins = validInserts(item).map(([c, r, t]) => `${c}.${r}${t[0]}`).join('');
    return `k${item.cols}x${item.rows}${item.legs ? 'L' : ''}${ins ? ':' + ins : ''}`;
  }
  const s = item.size;
  if (item.shape === 'cylinder') return `c${item.axis ?? 'x'}${s.w}x${s.d}x${s.h}`;
  if (item.shape === 'wall') return `w${s.w}x${s.h}`;
  if (item.shape === 'window') return `win${s.w}x${s.d}x${s.h}`;
  return `b${s.w}x${s.d}x${s.h}`;
}

export function acquireGeometry(item: Item): ItemGeometry {
  const key = geometryKey(item);
  let g = cache.get(key);
  if (!g) {
    g = item.kind === 'kallax' ? buildKallax(key, item.cols, item.rows, !!item.legs, validInserts(item))
      : item.shape === 'cylinder' ? buildCylinder(key, localSize(item), item.axis ?? 'x')
      : item.shape === 'wall' ? buildWall(key, localSize(item))
      : item.shape === 'window' ? buildWindow(key, localSize(item))
      : buildBlock(key, localSize(item));
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
  g.basket?.dispose();
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

/** 12 edges of an axis-aligned box. */
function pushBox(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (const y of [y0, y1]) {
    pushSeg(out, x0, y, z0, x1, y, z0); pushSeg(out, x1, y, z0, x1, y, z1);
    pushSeg(out, x1, y, z1, x0, y, z1); pushSeg(out, x0, y, z1, x0, y, z0);
  }
  pushSeg(out, x0, y0, z0, x0, y1, z0); pushSeg(out, x1, y0, z0, x1, y1, z0);
  pushSeg(out, x1, y0, z1, x1, y1, z1); pushSeg(out, x0, y0, z1, x0, y1, z1);
}
function boxGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g.toNonIndexed();
}

/**
 * Cell fitting geometry inside the opening [x0,x1] × [z0,z1] (front at y = 0).
 * door / drawers: fronts flush with the frame; basket: box set slightly back;
 * shelf: horizontal plank at mid-height through the depth.
 */
function insertGeometry(t: InsertType, x0: number, z0: number, x1: number, z1: number, D: number) {
  const g = 0.25;                 // reveal gap around fronts
  const boxes: [number, number, number, number, number, number][] = [];
  const edges: number[] = [];
  const front = (a: number, b: number, c: number, d: number, y0: number, y1: number) => {
    boxes.push([a, y0, b, c, y1, d]);
    pushRect(edges, a, b, c, d, y0);
  };
  const cx = (x0 + x1) / 2;
  if (t === 'door') {
    front(x0 + g, z0 + g, x1 - g, z1 - g, 0.3, 2);
    // knob on the right, mid-height (opening side)
    const kx = x1 - 3.2, kz = (z0 + z1) / 2;
    pushRect(edges, kx - 0.6, kz - 2.2, kx + 0.6, kz + 2.2, 0.15);
  } else if (t === 'drawers') {
    const zm = (z0 + z1) / 2;
    for (const [a, b] of [[z0 + g, zm - g / 2], [zm + g / 2, z1 - g]] as const) {
      front(x0 + g, a, x1 - g, b, 0.3, 2);
      // finger-pull slot near the top edge
      const sz = b - 3.4;
      pushRect(edges, cx - 4.5, sz - 0.7, cx + 4.5, sz + 0.7, 0.15);
    }
  } else if (t === 'basket') {
    const inset = 0.6, y0 = 1.2, top = z1 - 1.5;
    boxes.push([x0 + inset, y0, z0 + 0.2, x1 - inset, Math.min(D - 0.5, y0 + 37), top]);
    pushRect(edges, x0 + inset, z0 + 0.2, x1 - inset, top, y0);
    pushSeg(edges, x0 + inset, y0, top, x0 + inset, y0 + 6, top);
    pushSeg(edges, x1 - inset, y0, top, x1 - inset, y0 + 6, top);
    // cut-out handle
    const hz = top - 4.5;
    pushRect(edges, cx - 5, hz - 1.4, cx + 5, hz + 1.4, y0 - 0.05);
  } else {
    const t2 = 0.8, zm = (z0 + z1) / 2;
    boxes.push([x0, 1.5, zm - t2, x1, D - 1.5, zm + t2]);
    pushRect(edges, x0, zm - t2, x1, zm + t2, 1.5);
    pushSeg(edges, x0, 1.5, zm + t2, x0, D - 1.5, zm + t2);
    pushSeg(edges, x1, 1.5, zm + t2, x1, D - 1.5, zm + t2);
    pushRect(edges, x0, zm - t2, x1, zm + t2, D - 1.5);
  }
  return { faces: boxes.map(b => boxGeo(...b)), edges };
}

/**
 * KALLAX underframe ("piètement" / "support"): black metal frame with 4 legs,
 * KALLAX.legs high. Boxes in local space under the frame: z ∈ [0, L].
 */
function underframe(W: number, D: number, L: number) {
  const post = 3, rail = 3, inset = 1.5;
  const boxes: [number, number, number, number, number, number][] = [];
  const xs = [inset, W - inset - post], ys = [inset, D - inset - post];
  for (const x of xs) for (const y of ys) boxes.push([x, y, 0, x + post, y + post, L - rail]);
  // top rails (front, back, left, right)
  boxes.push([inset, inset, L - rail, W - inset, inset + post, L]);
  boxes.push([inset, D - inset - post, L - rail, W - inset, D - inset, L]);
  boxes.push([inset, inset + post, L - rail, inset + post, D - inset - post, L]);
  boxes.push([W - inset - post, inset + post, L - rail, W - inset, D - inset - post, L]);
  const edges: number[] = [];
  for (const b of boxes) pushBox(edges, ...b);
  return { faces: boxes.map(b => boxGeo(...b)), edges };
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

function buildKallax(key: string, cols: number, rows: number, legs: boolean, inserts: [number, number, InsertType][] = []): ItemGeometry {
  const W = kallaxOuter(cols), H = kallaxOuter(rows), D = KALLAX.depth;
  const L = legs ? KALLAX.legs : 0;
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
  let face: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, steps: 1, curveSegments: 1 });
  face.rotateX(Math.PI / 2);
  face.translate(0, D, L);
  face.computeVertexNormals();
  let legEdges: number[] = [];
  const basketEdges: number[] = [];
  const extraFaces: THREE.BufferGeometry[] = [];
  const basketFaces: THREE.BufferGeometry[] = [];
  if (legs) {
    const u = underframe(W, D, L);
    legEdges = u.edges;
    extraFaces.push(...u.faces);
  }
  for (const [c, r, t] of inserts) {
    const i = c * rows + r; // kallaxCells order: column-major
    const cell = cells[i];
    if (!cell) continue;
    const f = insertGeometry(t, cell[0], cell[1] + L, cell[2], cell[3] + L, D);
    (t === 'basket' ? basketFaces : extraFaces).push(...f.faces);
    (t === 'basket' ? basketEdges : legEdges).push(...f.edges);
  }
  // Material groups (used by the "Couleurs des finitions" mode, ignored with a
  // single material): 0 = frame + wooden fittings + underframe, 1 = baskets.
  const strip = (p: THREE.BufferGeometry) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.clearGroups();
    return g;
  };
  if (extraFaces.length) face = mergeGeometries([face, ...extraFaces].map(strip)) ?? face;
  face.clearGroups();
  if (basketFaces.length) {
    const frameCount = face.getAttribute('position').count;
    const merged = mergeGeometries([strip(face), ...basketFaces.map(strip)]);
    if (merged) {
      face = merged;
      face.clearGroups();
      face.addGroup(0, frameCount, 0);
      face.addGroup(frameCount, face.getAttribute('position').count - frameCount, 1);
    }
  } else {
    face.addGroup(0, face.getAttribute('position').count, 0);
  }
  face.computeBoundingBox();
  face.computeBoundingSphere();

  const outer: number[] = [];
  pushTube(outer, 0, L, W, H + L, D);
  const inner: number[] = [];
  for (const [x0, z0, x1, z1] of cells) pushTube(inner, x0, z0 + L, x1, z1 + L, D);
  inner.push(...legEdges);

  return {
    key,
    size: { w: W, d: D, h: H + L },
    face,
    outer: lineGeo(outer),
    inner: lineGeo(inner),
    basket: basketEdges.length ? lineGeo(basketEdges) : null,
    all: lineGeo([...outer, ...inner, ...basketEdges], true),
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
    basket: null,
    all: lineGeo(outer, true),
    refs: 0,
  };
}

const CYL_SEGMENTS = 64;

/** Round beam: faces + the two end circles. Silhouette lines are added per view (ItemView). */
function buildCylinder(key: string, s: Size3, axis: 'x' | 'z'): ItemGeometry {
  const w = Math.max(s.w, 0.1), d = Math.max(s.d, 0.1), h = Math.max(s.h, 0.1);
  const r = axis === 'x' ? Math.min(d, h) / 2 : Math.min(w, d) / 2;
  const len = axis === 'x' ? w : h;
  const face = new THREE.CylinderGeometry(r, r, len, CYL_SEGMENTS, 1, false);
  // CylinderGeometry runs along +Y; orient it along X or Z, then move into [0,w]×[0,d]×[0,h].
  if (axis === 'x') face.rotateZ(-Math.PI / 2); else face.rotateX(Math.PI / 2);
  face.translate(w / 2, d / 2, h / 2);
  face.computeVertexNormals();
  face.computeBoundingSphere();

  const a = axis === 'x' ? new THREE.Vector3(0, d / 2, h / 2) : new THREE.Vector3(w / 2, d / 2, 0);
  const b = axis === 'x' ? new THREE.Vector3(w, d / 2, h / 2) : new THREE.Vector3(w / 2, d / 2, h);
  const circles: number[] = [];
  for (const c of [a, b]) {
    for (let i = 0; i < CYL_SEGMENTS; i++) {
      const t0 = (i / CYL_SEGMENTS) * Math.PI * 2, t1 = ((i + 1) / CYL_SEGMENTS) * Math.PI * 2;
      if (axis === 'x') pushSeg(circles, c.x, c.y + r * Math.cos(t0), c.z + r * Math.sin(t0), c.x, c.y + r * Math.cos(t1), c.z + r * Math.sin(t1));
      else pushSeg(circles, c.x + r * Math.cos(t0), c.y + r * Math.sin(t0), c.z, c.x + r * Math.cos(t1), c.y + r * Math.sin(t1), c.z);
    }
  }
  return {
    key,
    size: { w, d, h },
    face,
    outer: lineGeo(circles),
    inner: null,
    basket: null,
    all: lineGeo(circles, true),
    cylinder: { a, b, r },
    refs: 0,
  };
}

/**
 * Wall: an opaque plane (no thickness) in the local XZ plane at y = 0.
 * Triangles in both windings so it masks from either side with single-sided materials.
 */
function buildWall(key: string, s: Size3): ItemGeometry {
  const w = Math.max(s.w, 1), h = Math.max(s.h, 1);
  const pos = new Float32Array([
    0, 0, 0, w, 0, 0, w, 0, h,  0, 0, 0, w, 0, h, 0, 0, h,   // facing −Y
    0, 0, 0, w, 0, h, w, 0, 0,  0, 0, 0, 0, 0, h, w, 0, h,   // facing +Y
  ]);
  const uv = new Float32Array([
    0, 0, w, 0, w, h,  0, 0, w, h, 0, h,
    0, 0, w, h, w, 0,  0, 0, 0, h, w, h,
  ].map(v => v / 100));
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  face.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  face.computeVertexNormals();
  face.computeBoundingSphere();
  const outer: number[] = [];
  pushRect(outer, 0, 0, w, h, 0);
  return { key, size: { w, d: 0, h }, face, outer: lineGeo(outer), inner: null, basket: null, all: lineGeo(outer, true), refs: 0 };
}

/**
 * Window: frame (dormant + sashes, ~6 cm) with one or two glazed openings
 * (2 casements from 70 cm wide), extruded through the frame depth. Glass is
 * suggested by the classic pair of short diagonal reflection strokes.
 */
function buildWindow(key: string, s: Size3): ItemGeometry {
  const w = Math.max(s.w, 20), d = Math.max(s.d, 1), h = Math.max(s.h, 20);
  const f = Math.min(6, w / 6, h / 6);
  const two = w >= 70;
  const m = two ? Math.min(7, w / 10) : 0;
  const panes: [number, number, number, number][] = two
    ? [[f, f, (w - m) / 2, h - f], [(w + m) / 2, f, w - f, h - f]]
    : [[f, f, w - f, h - f]];
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(w, h); shape.lineTo(0, h); shape.closePath();
  for (const [x0, z0, x1, z1] of panes) {
    const hole = new THREE.Path();
    hole.moveTo(x0, z0); hole.lineTo(x0, z1); hole.lineTo(x1, z1); hole.lineTo(x1, z0); hole.closePath();
    shape.holes.push(hole);
  }
  const face = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1, curveSegments: 1 });
  face.rotateX(Math.PI / 2);
  face.translate(0, d, 0);
  face.computeVertexNormals();
  face.computeBoundingSphere();

  const outer: number[] = [];
  pushTube(outer, 0, 0, w, h, d);
  const inner: number[] = [];
  const gy = d / 2; // glass plane
  for (const [x0, z0, x1, z1] of panes) {
    pushTube(inner, x0, z0, x1, z1, d);
    // glazing: rebate line + reflection strokes
    pushRect(inner, x0 + 1, z0 + 1, x1 - 1, z1 - 1, gy);
    const pw = x1 - x0, ph = z1 - z0, k = Math.min(pw, ph);
    const cx = x0 + pw * 0.3, cz = z0 + ph * 0.62;
    pushSeg(inner, cx, gy, cz, cx + k * 0.18, gy, cz + k * 0.18);
    pushSeg(inner, cx + k * 0.08, gy, cz - k * 0.06, cx + k * 0.3, gy, cz + k * 0.16);
  }
  return { key, size: { w, d, h }, face, outer: lineGeo(outer), inner: lineGeo(inner), basket: null, all: lineGeo([...outer, ...inner], true), refs: 0 };
}
