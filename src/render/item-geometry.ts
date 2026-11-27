// Shared, ref-counted geometry for item meshes: one entry per Kallax
// configuration (cols×rows) or block size. Local space: the item occupies
// [0,w] × [0,d] × [0,h] (unrotated), front opening at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { KALLAX, kallaxOuter, localSize, validInserts } from '../core/kallax';
import type { InsertType } from '../core/types';
import type { Item, Size3 } from '../core/types';
import { buildChair } from './furniture-chairs';
import { buildDesk } from './furniture-desks';
import { buildFrame, buildTable, buildTv } from './furniture-params';
import { buildBed, buildLamp, buildPlant } from './furniture-objects';
import { buildHuman } from './furniture-human';
import { buildEket } from './eket-geometry';
import { EKET_LEG_BY_ID, eketDef } from '../core/eket';

/**
 * A solid of revolution part (cylinder when ra === rb, cone frustum otherwise):
 * axis end points (local, content space) and the radius at each end.
 */
export interface Frustum {
  a: THREE.Vector3;
  b: THREE.Vector3;
  ra: number;
  rb: number;
}

/** Wall opening in the wall's local plane: [x0, z0, x1, z1] (cm, clipped to the wall). */
export type WallHole = [number, number, number, number];

export interface ItemGeometry {
  /** Revolved parts (round beams, lamps, plant pots): silhouette generators are view-dependent. */
  frusta?: Frustum[];
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

/**
 * Cache key of an item's geometry. Walls also depend on the openings cut
 * through them (`holes`, computed by the viewport from the other items).
 */
export function geometryKey(item: Item, holes?: WallHole[]): string {
  if (item.kind === 'kallax') {
    const ins = validInserts(item).map(([c, r, t]) => `${c}.${r}${t[0]}`).join('');
    return `k${item.cols}x${item.rows}${item.legs ? 'L' : ''}${ins ? ':' + ins : ''}`;
  }
  if (item.kind === 'eket') return `eket:${eketDef(item.variant).id}${item.legs ? ':' + item.legs : ''}`; // colour = material, not geometry
  const s = item.size;
  switch (item.shape) {
    case 'cylinder': return `c${item.axis ?? 'x'}${s.w}x${s.d}x${s.h}`;
    case 'wall': return `w${s.w}x${s.h}${holes?.length ? '|' + holes.map(h => h.join(',')).join(';') : ''}`;
    case 'window': return `win${s.w}x${s.d}x${s.h}`;
    case 'door': return `door${s.w}x${s.d}x${s.h}${item.mirror ? 'M' : ''}`;
    case 'radiator': return `rad${s.w}x${s.d}x${s.h}`;
    case 'bed': return `bed${s.w}x${s.d}x${s.h}`;
    case 'lamp': return `lamp:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`;
    case 'plant': return `plant:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`;
    case 'desk': return `desk:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`;
    case 'chair': return `chair:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`; // colour = material, not geometry
    case 'tv': return `tv:${item.variant ?? ''}:${item.opts?.inch ?? ''}:${s.w}x${s.d}x${s.h}`;
    case 'table': return `table:${item.variant ?? ''}:${item.opts?.top ?? ''}:${item.opts?.leg ?? ''}:${item.opts?.round ? 'R' : ''}:${s.w}x${s.d}x${s.h}`;
    case 'frame': return `frame:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`;
    case 'human': return `human:${item.variant ?? ''}:${s.w}x${s.d}x${s.h}`; // colour = material, not geometry
    default: return `b${s.w}x${s.d}x${s.h}`; // box, square beam, skirting
  }
}

function buildFor(key: string, item: Item, holes?: WallHole[]): ItemGeometry {
  if (item.kind === 'kallax') return buildKallax(key, item.cols, item.rows, !!item.legs, validInserts(item));
  if (item.kind === 'eket') return buildEket(key, eketDef(item.variant).id, item.legs && EKET_LEG_BY_ID[item.legs] ? item.legs : undefined);
  const s = localSize(item);
  switch (item.shape) {
    case 'cylinder': return buildCylinder(key, s, item.axis ?? 'x');
    case 'wall': return buildWall(key, s, holes ?? []);
    case 'window': return buildWindow(key, s);
    case 'door': return buildDoor(key, s, !!item.mirror);
    case 'radiator': return buildRadiator(key, s);
    case 'bed': return buildBed(key, s);
    case 'lamp': return buildLamp(key, s, item.variant);
    case 'plant': return buildPlant(key, s, item.variant);
    case 'desk': return buildDesk(key, s, item.variant);
    case 'chair': return buildChair(key, s, item.variant);
    case 'tv': return buildTv(key, s, item.variant, item.opts);
    case 'table': return buildTable(key, s, item.variant, item.opts);
    case 'frame': return buildFrame(key, s, item.variant);
    case 'human': return buildHuman(key, s, item.variant);
    default: return buildBlock(key, s);
  }
}

export function acquireGeometry(item: Item, holes?: WallHole[]): ItemGeometry {
  const key = geometryKey(item, holes);
  let g = cache.get(key);
  if (!g) {
    g = buildFor(key, item, holes);
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
export function pushSeg(out: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  out.push(ax, ay, az, bx, by, bz);
}
export function pushRect(out: number[], x0: number, z0: number, x1: number, z1: number, y: number) {
  pushSeg(out, x0, y, z0, x1, y, z0);
  pushSeg(out, x1, y, z0, x1, y, z1);
  pushSeg(out, x1, y, z1, x0, y, z1);
  pushSeg(out, x0, y, z1, x0, y, z0);
}
/** Front rect, back rect and the 4 depth edges of an axis-aligned "tube" along Y. */
export function pushTube(out: number[], x0: number, z0: number, x1: number, z1: number, d: number) {
  pushRect(out, x0, z0, x1, z1, 0);
  pushRect(out, x0, z0, x1, z1, d);
  pushSeg(out, x0, 0, z0, x0, d, z0);
  pushSeg(out, x1, 0, z0, x1, d, z0);
  pushSeg(out, x1, 0, z1, x1, d, z1);
  pushSeg(out, x0, 0, z1, x0, d, z1);
}

/** 12 edges of an axis-aligned box. */
export function pushBox(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (const y of [y0, y1]) {
    pushSeg(out, x0, y, z0, x1, y, z0); pushSeg(out, x1, y, z0, x1, y, z1);
    pushSeg(out, x1, y, z1, x0, y, z1); pushSeg(out, x0, y, z1, x0, y, z0);
  }
  pushSeg(out, x0, y0, z0, x0, y1, z0); pushSeg(out, x1, y0, z0, x1, y1, z0);
  pushSeg(out, x1, y0, z1, x1, y1, z1); pushSeg(out, x0, y0, z1, x0, y1, z1);
}
export function boxGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
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

export function lineGeo(positions: number[], withDistances = false): LineSegmentsGeometry {
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
  let underFaces: THREE.BufferGeometry[] = [];
  if (legs) {
    const u = underframe(W, D, L);
    legEdges = u.edges;
    underFaces = u.faces;
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
  // single material): 0 = frame + wooden fittings, 1 = baskets, 2 = underframe.
  const strip = (p: THREE.BufferGeometry) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.clearGroups();
    return g;
  };
  const parts = [[face, ...extraFaces], basketFaces, underFaces].map(l => l.map(strip));
  const counts = parts.map(l => l.reduce((n, g) => n + g.getAttribute('position').count, 0));
  face = (parts.flat().length > 1 ? mergeGeometries(parts.flat()) : parts[0][0]) ?? face;
  face.clearGroups();
  let start = 0;
  counts.forEach((n, i) => { if (n) face.addGroup(start, n, i); start += n; });
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

export function buildBlock(key: string, s: Size3): ItemGeometry {
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

/** Circle of radius r around `c`, in the plane perpendicular to the unit axis `u`. */
export function pushCircle(out: number[], c: THREE.Vector3, u: THREE.Vector3, r: number, seg = CYL_SEGMENTS) {
  const e1 = Math.abs(u.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(u).normalize() : new THREE.Vector3(1, 0, 0).cross(u).normalize();
  const e2 = u.clone().cross(e1);
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
    pushSeg(out,
      c.x + r * (Math.cos(t0) * e1.x + Math.sin(t0) * e2.x), c.y + r * (Math.cos(t0) * e1.y + Math.sin(t0) * e2.y), c.z + r * (Math.cos(t0) * e1.z + Math.sin(t0) * e2.z),
      c.x + r * (Math.cos(t1) * e1.x + Math.sin(t1) * e2.x), c.y + r * (Math.cos(t1) * e1.y + Math.sin(t1) * e2.y), c.z + r * (Math.cos(t1) * e1.z + Math.sin(t1) * e2.z));
  }
}

/** Closed frustum mesh along local Z (vertical revolved parts), base at z0 (radius r0), top at z1 (radius r1). */
export function frustumZ(cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, seg = 48): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, false);
  g.rotateX(Math.PI / 2); // +Y (top) → +Z
  g.translate(cx, cy, (z0 + z1) / 2);
  return g;
}

/** Keep position + normal only and merge (non-indexed) so heterogeneous parts can be combined. */
export function mergeFaces(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map(p => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.clearGroups();
    return g;
  });
  const m = (list.length === 1 ? list[0] : mergeGeometries(list)) ?? list[0];
  m.clearGroups();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

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
  const u = b.clone().sub(a).normalize();
  const circles: number[] = [];
  for (const c of [a, b]) pushCircle(circles, c, u, r);
  return {
    key,
    size: { w, d, h },
    face,
    outer: lineGeo(circles),
    inner: null,
    basket: null,
    all: lineGeo(circles, true),
    frusta: [{ a, b, ra: r, rb: r }],
    refs: 0,
  };
}

/**
 * Wall: an opaque plane (no thickness) in the local XZ plane at y = 0, minus
 * the openings (doors / windows) cut through it. The rectangle is split on a
 * grid made of the hole edges; every cell outside the holes becomes a quad
 * (robust even when a hole touches or crosses the wall border, e.g. a door at
 * floor level). Triangles in both windings so it masks from either side with
 * single-sided materials. Edges = boundary of the remaining region (outer
 * contour + hole outlines), collinear pieces merged.
 */
function buildWall(key: string, s: Size3, holes: WallHole[]): ItemGeometry {
  const w = Math.max(s.w, 1), h = Math.max(s.h, 1);
  const uniq = (v: number[]) => [...new Set(v.map(x => Math.round(x * 100) / 100))].sort((p, q) => p - q);
  const xs = uniq([0, w, ...holes.flatMap(r => [r[0], r[2]])].filter(x => x >= 0 && x <= w));
  const zs = uniq([0, h, ...holes.flatMap(r => [r[1], r[3]])].filter(z => z >= 0 && z <= h));
  const nx = xs.length - 1, nz = zs.length - 1;
  const filled = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    return !holes.some(r => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]);
  };
  const pos: number[] = [];
  const hSegs = new Map<number, [number, number][]>(); // z → x runs
  const vSegs = new Map<number, [number, number][]>(); // x → z runs
  const add = (m: Map<number, [number, number][]>, k: number, a: number, b: number) => {
    const l = m.get(k); if (l) l.push([a, b]); else m.set(k, [[a, b]]);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!filled(i, j)) continue;
      const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      pos.push(
        x0, 0, z0, x1, 0, z0, x1, 0, z1,  x0, 0, z0, x1, 0, z1, x0, 0, z1,   // facing −Y
        x0, 0, z0, x1, 0, z1, x1, 0, z0,  x0, 0, z0, x0, 0, z1, x1, 0, z1,   // facing +Y
      );
      if (!filled(i - 1, j)) add(vSegs, x0, z0, z1);
      if (!filled(i + 1, j)) add(vSegs, x1, z0, z1);
      if (!filled(i, j - 1)) add(hSegs, z0, x0, x1);
      if (!filled(i, j + 1)) add(hSegs, z1, x0, x1);
    }
  }
  const merge = (runs: [number, number][]) => {
    runs.sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
    }
    return out;
  };
  const outer: number[] = [];
  for (const [z, runs] of hSegs) for (const [a, b] of merge(runs)) pushSeg(outer, a, 0, z, b, 0, z);
  for (const [x, runs] of vSegs) for (const [a, b] of merge(runs)) pushSeg(outer, x, 0, a, x, 0, b);

  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const uv = new Float32Array(pos.length / 3 * 2);
  for (let i = 0, k = 0; i < pos.length; i += 3, k += 2) { uv[k] = pos[i] / 100; uv[k + 1] = pos[i + 2] / 100; }
  face.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  face.computeVertexNormals();
  face.computeBoundingBox();
  face.computeBoundingSphere();
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

// ── house & objects ──────────────────────────────────────────────────────

/** Horizontal rectangle (x, y) at height z. */
export function pushRectXY(out: number[], x0: number, y0: number, x1: number, y1: number, z: number) {
  pushSeg(out, x0, y0, z, x1, y0, z);
  pushSeg(out, x1, y0, z, x1, y1, z);
  pushSeg(out, x1, y1, z, x0, y1, z);
  pushSeg(out, x0, y1, z, x0, y0, z);
}
/** Horizontal rounded rectangle at height z (corner radius r). */
export function pushRoundRectXY(out: number[], x0: number, y0: number, x1: number, y1: number, z: number, r: number, seg = 5) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    pushSeg(out, p[0], p[1], z, q[0], q[1], z);
  }
}
export type BoxSpec = [number, number, number, number, number, number];

/**
 * Door leaf: slab w × d × h with a subtle panel moulding line on both faces
 * and a lever handle (rose + spindle + 12 cm lever) on both faces, ~105 cm
 * high, 7 cm from the edge on the opening side: right as seen from the front
 * (y = 0), left when mirrored. The lever points towards the hinge side.
 * The handle stands ~6 cm proud of the faces (outside the item box, like a real one).
 */
function buildDoor(key: string, s: Size3, mirror: boolean): ItemGeometry {
  const w = Math.max(s.w, 20), d = Math.max(s.d, 1), h = Math.max(s.h, 40);
  const boxes: BoxSpec[] = [];
  const outer: number[] = [];
  pushTube(outer, 0, 0, w, h, d);
  const inner: number[] = [];
  // panel moulding (inset rectangle on both faces)
  const mx = Math.min(11, w * 0.14), mb = Math.min(14, h * 0.08), mt = Math.min(11, h * 0.06);
  for (const y of [0, d]) {
    pushRect(inner, mx, mb, w - mx, h - mt, y);
    pushRect(inner, mx + 1.2, mb + 1.2, w - mx - 1.2, h - mt - 1.2, y);
  }
  // handle
  const hx = mirror ? 7 : w - 7;
  const hz = Math.min(105, h - 12);
  const toHinge = mirror ? 1 : -1;
  const handleEdges: number[] = [];
  for (const side of [-1, 1] as const) {
    const y0 = side < 0 ? 0 : d;                       // face plane
    const yo = (t: number) => y0 + side * t;           // offset outwards
    const span = (a: number, b: number): [number, number] => { const p = yo(a), q = yo(b); return [Math.min(p, q), Math.max(p, q)]; };
    // rose (square plate)
    const [ry0, ry1] = span(0, 0.9);
    boxes.push([hx - 2.6, ry0, hz - 2.6, hx + 2.6, ry1, hz + 2.6]);
    // keyhole escutcheon below
    const [ky0, ky1] = span(0, 0.6);
    boxes.push([hx - 1.4, ky0, hz - 8.5, hx + 1.4, ky1, hz - 5.5]);
    // spindle
    const [sy0, sy1] = span(0.9, 5);
    boxes.push([hx - 0.8, sy0, hz - 0.8, hx + 0.8, sy1, hz + 0.8]);
    // lever (horizontal, towards the hinge side)
    const [ly0, ly1] = span(4, 5.8);
    const lx0 = hx - toHinge * 1, lx1 = hx + toHinge * 12;
    boxes.push([Math.min(lx0, lx1), ly0, hz - 0.9, Math.max(lx0, lx1), ly1, hz + 0.9]);
  }
  for (const b of boxes) pushBox(handleEdges, ...b);
  inner.push(...handleEdges);
  const face = mergeFaces([boxGeo(0, 0, 0, w, d, h), ...boxes.map(b => boxGeo(...b))]);
  return { key, size: { w, d, h }, face, outer: lineGeo(outer), inner: lineGeo(inner), basket: null, all: lineGeo([...outer, ...inner], true), refs: 0 };
}

/** Panel radiator: box with vertical channels every ~5 cm on both faces and a convector grille on top. */
function buildRadiator(key: string, s: Size3): ItemGeometry {
  const w = Math.max(s.w, 5), d = Math.max(s.d, 1), h = Math.max(s.h, 5);
  const outer: number[] = [];
  pushTube(outer, 0, 0, w, h, d);
  const inner: number[] = [];
  const m = Math.min(2, w / 6);
  const n = Math.max(2, Math.round((w - 2 * m) / 5));
  const pitch = (w - 2 * m) / n;
  const z0 = Math.min(3, h * 0.08), z1 = h - Math.min(3, h * 0.08);
  for (let k = 0; k <= n; k++) {
    const x = m + k * pitch;
    pushSeg(inner, x, 0, z0, x, 0, z1);
    pushSeg(inner, x, d, z0, x, d, z1);
  }
  // top grille: inset frame + slats
  const gi = Math.min(1.5, d / 4);
  pushRectXY(inner, gi, gi, w - gi, d - gi, h);
  if (d - 2 * gi > 3) pushSeg(inner, gi, d / 2, h, w - gi, d / 2, h);
  const face = boxGeo(0, 0, 0, w, d, h);
  face.computeBoundingSphere();
  return { key, size: { w, d, h }, face, outer: lineGeo(outer), inner: lineGeo(inner), basket: null, all: lineGeo([...outer, ...inner], true), refs: 0 };
}
