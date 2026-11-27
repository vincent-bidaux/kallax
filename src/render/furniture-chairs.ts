// ─────────────────────────────────────────────────────────────
// Chair geometry (real IKEA models). OWNED BY THE CHAIRS AGENT.
//
// Local space: the chair occupies [0,w] × [0,d] × [0,h], front at y = 0
// (facing −Y), Z up. Each model is built at its nominal IKEA size from a
// few primitives, then fitted exactly to the item size (so everything stays
// inside the item AABB):
//   - moulded / upholstered shells: a "spider" surface (spines from the seat
//     centre out to a superellipse seat outline, then a fillet and a wall whose
//     height / lean vary around the outline), offset by the shell thickness and
//     closed by a rounded rim — the same generator makes the GRÖNSTA scoop, the
//     GRÖNSTA / TOSSBERG tubs with armrests and the NORDMANSSKÄR shell;
//   - cushions: superellipsoids (DYVLINGE, Tallmyra pad);
//   - round legs / columns / bolster: frusta (exact view-dependent silhouettes);
//   - wooden members: tapered bars, extruded slabs, a curved lofted back rest.
//
// Edges: creases (dihedral > CREASE) and borders are drawn statically; smooth
// curved parts have no static edges but register their interior edges as
// silhouette candidates (face.userData[SIL_KEY]), turned into view-dependent
// contour lines by ItemView — a clean technical drawing from any angle.
//
// Material groups (used by the "finish colours" mode): 0 = main colour
// (shell / upholstery / wood), 1 = secondary colour (legs, frame, base, pad).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Size3 } from '../core/types';
import type { Frustum, ItemGeometry } from './item-geometry';

/** Key of the silhouette-candidate edges in `ItemGeometry.face.userData`. */
export const SIL_KEY = 'silEdges';
/**
 * Smooth meshes for view-dependent contours: triangles (9 floats each) with
 * their smooth vertex normals (9 floats each). The contour runs where the
 * interpolated n·v changes sign: one segment per straddling triangle, between
 * the zero crossings on its edges — continuous curves, no faceting noise.
 */
export interface SilhouetteEdges { tri: Float32Array; nrm: Float32Array }

type V3 = THREE.Vector3;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);
const DEG = Math.PI / 180;
/** Crease angle (deg): sharper dihedrals are drawn as edges, softer ones only as silhouettes. */
const CREASE = 32;
/** Crease angle for the free-form shells / cushions (designed smooth: only real folds become edges). */
const SMOOTH_CREASE = 70;

type Target = 'outer' | 'inner' | 'hidden' | 'none';

// ── part collector ───────────────────────────────────────────────────────
class Parts {
  faces: THREE.BufferGeometry[][] = [[], []];
  outer: number[] = [];
  inner: number[] = [];
  /** Lines drawn only as dashed hidden edges (shell rims, pillow outlines). */
  hidden: number[] = [];
  frusta: Frustum[] = [];
  silTri: number[] = [];
  silNrm: number[] = [];

  private push(t: Target, a: V3, b: V3) {
    if (t === 'none' || a.distanceToSquared(b) < 1e-8) return;
    (t === 'outer' ? this.outer : t === 'inner' ? this.inner : this.hidden).push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  polyline(pts: V3[], t: Target, closed = false) {
    for (let i = 0; i + 1 < pts.length; i++) this.push(t, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) this.push(t, pts[pts.length - 1], pts[0]);
  }

  circle(c: V3, n: V3, r: number, t: Target, seg = 28) {
    const u = n.clone().normalize();
    const e1 = (Math.abs(u.z) < 0.9 ? Z.clone().cross(u) : X.clone().cross(u)).normalize();
    const e2 = u.clone().cross(e1);
    const pts: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(c.clone().addScaledVector(e1, r * Math.cos(a)).addScaledVector(e2, r * Math.sin(a)));
    }
    this.polyline(pts, t, true);
  }

  /**
   * Add a (closed) mesh: creases and borders → static edges (`edges`),
   * smooth interior edges → silhouette candidates. Normals are creased.
   */
  mesh(g: THREE.BufferGeometry, group: 0 | 1, edges: Target = 'outer', sil = true, crease = CREASE) {
    fixWinding(g);
    const a = analyse(g, crease);
    for (let i = 0; i < a.stat.length; i += 6) this.push(edges, v3(a.stat[i], a.stat[i + 1], a.stat[i + 2]), v3(a.stat[i + 3], a.stat[i + 4], a.stat[i + 5]));
    const shaded = toCreasedNormals(g, crease * DEG);
    if (sil) {
      const p = shaded.getAttribute('position').array, n = shaded.getAttribute('normal').array;
      for (let i = 0; i < p.length; i++) { this.silTri.push(p[i]); this.silNrm.push(n[i]); }
    }
    this.faces[group].push(shaded);
  }

  /**
   * Round tube / cone frustum from a (radius ra) to b (radius rb), closed.
   * Its contour comes from the view-dependent frustum silhouettes.
   */
  tube(a: V3, b: V3, ra: number, rb: number, group: 0 | 1, circles: Target = 'outer', seg = 24, ends: 'both' | 'a' | 'b' | 'none' = 'both') {
    const dir = b.clone().sub(a);
    const L = dir.length();
    if (L < 1e-6) return;
    const g = new THREE.CylinderGeometry(rb, ra, L, seg, 1, false);
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().divideScalar(L)));
    g.translate(a.x, a.y, a.z);
    g.computeVertexNormals();
    this.faces[group].push(g);
    this.frusta.push({ a: a.clone(), b: b.clone(), ra, rb });
    // end circles circumscribe the mesh polygon (finer, never hidden inside it)
    const k = 1 / Math.cos(Math.PI / seg), cs = Math.max(32, seg * 2);
    if (ends === 'both' || ends === 'a') this.circle(a, dir, ra * k, circles, cs);
    if (ends === 'both' || ends === 'b') this.circle(b, dir, rb * k, circles, cs);
  }

  /** Round tube along a polyline whose corners are rounded with radius r (sled bases). */
  rodPath(pts: V3[], r: number, rad: number, group: 0 | 1) {
    const path = filletPath(pts, rad);
    for (let i = 0; i + 1 < path.length; i++) {
      const ends = path.length === 2 ? 'both' : i === 0 ? 'a' : i === path.length - 2 ? 'b' : 'none';
      this.tube(path[i], path[i + 1], r, r, group, 'outer', 16, ends);
    }
  }

  /** Rectangular bar from a to b, section wa × da at a and wb × db at b (w along `xHint`). */
  bar(a: V3, b: V3, wa: number, da: number, wb: number, db: number, group: 0 | 1, xHint: V3 = X, edges: Target = 'outer') {
    const u = b.clone().sub(a).normalize();
    let e1 = xHint.clone().addScaledVector(u, -xHint.dot(u));
    if (e1.lengthSq() < 1e-6) e1 = Y.clone().addScaledVector(u, -Y.dot(u));
    e1.normalize();
    const e2 = u.clone().cross(e1).normalize();
    const corner = (p: V3, w: number, d: number, i: number, j: number) => p.clone().addScaledVector(e1, i * w / 2).addScaledVector(e2, j * d / 2);
    const A = [corner(a, wa, da, -1, -1), corner(a, wa, da, 1, -1), corner(a, wa, da, 1, 1), corner(a, wa, da, -1, 1)];
    const B = [corner(b, wb, db, -1, -1), corner(b, wb, db, 1, -1), corner(b, wb, db, 1, 1), corner(b, wb, db, -1, 1)];
    this.mesh(loftRings([A, B], true, true), group, edges, false);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, group: 0 | 1, edges: Target = 'outer') {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.mesh(g, group, edges, false);
  }
}

// ── mesh helpers ─────────────────────────────────────────────────────────
function triangles(g: THREE.BufferGeometry): Float32Array {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = idx ? idx.getX(i) : i;
    out[i * 3] = p.getX(k); out[i * 3 + 1] = p.getY(k); out[i * 3 + 2] = p.getZ(k);
  }
  return out;
}

/** Flip the triangles of a closed mesh whose signed volume is negative (inward-facing). */
function fixWinding(g: THREE.BufferGeometry) {
  const t = triangles(g);
  let vol = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol >= 0) return;
  if (g.index) {
    const a = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const s = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = s; }
    g.index.needsUpdate = true;
  } else {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
    p.needsUpdate = true;
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
}

/**
 * Weld the vertices, then classify every edge: border / crease (dihedral >
 * creaseDeg) → static segment; smooth edges are left to the view-dependent contours.
 */
function analyse(g: THREE.BufferGeometry, creaseDeg: number) {
  const t = triangles(g);
  const ids = new Map<string, number>();
  const pts: number[] = [];
  const weld = (i: number) => {
    const k = `${Math.round(t[i] * 400)},${Math.round(t[i + 1] * 400)},${Math.round(t[i + 2] * 400)}`;
    let id = ids.get(k);
    if (id === undefined) { id = pts.length / 3; ids.set(k, id); pts.push(t[i], t[i + 1], t[i + 2]); }
    return id;
  };
  const normals: number[] = [];
  const edges = new Map<number, number[]>();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < t.length; i += 9) {
    const a = weld(i), b = weld(i + 3), c = weld(i + 6);
    if (a === b || b === c || a === c) continue;
    A.fromArray(pts, a * 3); B.fromArray(pts, b * 3); C.fromArray(pts, c * 3);
    const n = B.sub(A).cross(C.sub(A));
    const len = n.length();
    if (len < 1e-7) continue;
    n.divideScalar(len);
    const f = normals.length / 3;
    normals.push(n.x, n.y, n.z);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(p, q) * 4194304 + Math.max(p, q);
      const l = edges.get(key);
      if (l) l.push(f); else edges.set(key, [f]);
    }
  }
  const cosC = Math.cos(creaseDeg * DEG);
  const stat: number[] = [];
  for (const [key, fs] of edges) {
    const p = Math.floor(key / 4194304), q = key % 4194304;
    const seg = [pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2], pts[q * 3], pts[q * 3 + 1], pts[q * 3 + 2]];
    if (fs.length === 2) {
      const [f1, f2] = fs;
      const d = normals[f1 * 3] * normals[f2 * 3] + normals[f1 * 3 + 1] * normals[f2 * 3 + 1] + normals[f1 * 3 + 2] * normals[f2 * 3 + 2];
      if (d >= cosC) continue; // smooth: contour handled view-dependently
    }
    stat.push(...seg);
  }
  return { stat };
}

/**
 * Closed loft through rings of equal length (each ring a closed loop),
 * optionally capped (fan from the ring centroid) at both ends.
 */
function loftRings(rings: V3[][], capStart: boolean, capEnd: boolean, closedPath = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const n = rings[0].length;
  const R = closedPath ? rings.length : rings.length - 1;
  for (let j = 0; j < R; j++) {
    const r0 = rings[j], r1 = rings[(j + 1) % rings.length];
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      tri(r0[i], r1[i1], r1[i]);
      tri(r0[i], r0[i1], r1[i1]);
    }
  }
  const cap = (r: V3[], flip: boolean) => {
    const c = r.reduce((s, p) => s.add(p), v3(0, 0, 0)).divideScalar(r.length);
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      if (flip) tri(c, r[i1], r[i]); else tri(c, r[i], r[i1]);
    }
  };
  if (!closedPath && capStart) cap(rings[0], true);
  if (!closedPath && capEnd) cap(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Polyline with every interior corner replaced by a quadratic arc of (about) radius `rad`. */
function filletPath(pts: V3[], rad: number, seg = 4): V3[] {
  if (pts.length < 3) return pts.map(p => p.clone());
  const out: V3[] = [pts[0].clone()];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const da = a.clone().sub(p), db = b.clone().sub(p);
    const ra = Math.min(rad, da.length() * 0.45), rb = Math.min(rad, db.length() * 0.45);
    const s = p.clone().addScaledVector(da.normalize(), ra), e = p.clone().addScaledVector(db.normalize(), rb);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      out.push(s.clone().multiplyScalar((1 - t) ** 2).addScaledVector(p, 2 * t * (1 - t)).addScaledVector(e, t * t));
    }
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

/**
 * Smooth interpolation in a table of [x, value] pairs (x ascending): monotone
 * cubic Hermite (Fritsch–Carlson, no overshoot), zero slope at both ends
 * (the tables are mirrored around 0° and 180°).
 */
type Table = [number, number][];
const slopeCache = new WeakMap<Table, number[]>();
function lookup(tab: Table, x: number): number {
  const n = tab.length;
  if (x <= tab[0][0]) return tab[0][1];
  if (x >= tab[n - 1][0]) return tab[n - 1][1];
  let m = slopeCache.get(tab);
  if (!m) {
    const d: number[] = [];
    for (let i = 0; i + 1 < n; i++) d.push((tab[i + 1][1] - tab[i][1]) / (tab[i + 1][0] - tab[i][0]));
    m = new Array<number>(n).fill(0);
    for (let i = 1; i + 1 < n; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i + 1 < n; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    slopeCache.set(tab, m);
  }
  let i = 1;
  while (x > tab[i][0]) i++;
  const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
  const hh = x1 - x0, t = (x - x0) / hh, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * hh * m[i - 1] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * hh * m[i];
}

// ── moulded / upholstered shell ──────────────────────────────────────────
interface ShellSpec {
  /** Seat centre (plan). */
  cx: number; cy: number;
  /** Seat outline at the seat edge: superellipse, half-width a (front) and half-depth b, exponent n. */
  a: number; b: number; n: number;
  /** Rear half-width = a · (1 − taper). */
  taper: number;
  /** Seat surface height at the centre; the edge is `dish` higher. */
  z0: number; dish: number;
  /** Seat tilt (deg), rear lower. */
  tilt: number;
  /**
   * Around the outline, by angle from the front (deg, 0 = front, 90 = side,
   * 180 = back; mirrored on the left): rim height above the seat edge
   * (negative = rolled-down front edge), and the wall lean per cm of height
   * outwards (bx, mirrored) and backwards (by).
   */
  rim: Table; bx: Table; by: Table;
  /** Seat-to-wall fillet length, shell thickness, outward reach of the edge beyond the seat outline (default 1). */
  fillet: number; thick: number; reach?: number;
  /** Seam lines (upholstery) along the seat edge. */
  seam?: boolean;
  nu?: number;
}

/** Seat surface height of a shell at (x, y) (approximate, used to seat legs under it). */
function shellSeatZ(s: ShellSpec, x: number, y: number): number {
  const rx = (x - s.cx) / s.a, ry = (y - s.cy) / s.b;
  const rho = Math.min(1, Math.pow(Math.abs(rx) ** s.n + Math.abs(ry) ** s.n, 1 / s.n));
  return s.z0 + s.dish * rho * rho - Math.tan(s.tilt * DEG) * (y - s.cy);
}

function buildShell(P: Parts, s: ShellSpec, group: 0 | 1 = 0) {
  const NU = s.nu ?? 128;
  const nS = 8, nC = 7, nW = 10, kR = 8;
  const tanT = Math.tan(s.tilt * DEG);
  const outline = (th: number) => {
    const sn = Math.sin(th), cs = Math.cos(th);
    const r = Math.pow(Math.abs(sn / s.a) ** s.n + Math.abs(cs / s.b) ** s.n, -1 / s.n);
    const y = -r * cs;
    const x = r * sn * (1 - s.taper * (y / s.b + 1) / 2);
    return [s.cx + x, s.cy + y];
  };
  const top: V3[][] = [];
  /** Per column: how much the edge rolls down (negative rim height) → extra thickness at the edge (bull-nose front). */
  const drop: number[] = [];
  for (let i = 0; i < NU; i++) {
    const th = (i / NU) * Math.PI * 2;
    const thm = (th <= Math.PI ? th : Math.PI * 2 - th) / DEG;
    const side = Math.sin(th) >= 0 ? 1 : -1;
    const [ex, ey] = outline(th);
    const [ax, ay] = outline(th - 0.01), [bx2, by2] = outline(th + 0.01);
    // outward horizontal normal of the outline
    const nrm = v3(by2 - ay, -(bx2 - ax), 0).normalize();
    if (nrm.x * (ex - s.cx) + nrm.y * (ey - s.cy) < 0) nrm.negate();
    const C = v3(s.cx, s.cy, s.z0);
    const zE = s.z0 + s.dish;
    const E = v3(ex, ey, zE);
    const radial = Math.hypot(ex - s.cx, ey - s.cy);
    const dirH = v3(ex - s.cx, ey - s.cy, 0).divideScalar(radial);
    // Wall vector: a short outward reach plus the rim height (with its lean when
    // rising). Continuous through h = 0 (horizontal lip) and below (rolled-down front).
    const h = lookup(s.rim, thm), hp = Math.max(h, 0);
    drop.push(Math.max(0, -h));
    const Wv = nrm.clone().multiplyScalar(s.reach ?? 1).add(v3(side * lookup(s.bx, thm) * hp, lookup(s.by, thm) * hp, hp));
    const L = Wv.length();
    const w = Wv.divideScalar(L);
    const f = Math.min(s.fillet, 0.45 * L, 0.3 * radial);
    const Aend = E.clone().addScaledVector(dirH, -f);
    Aend.z = s.z0 + s.dish * ((radial - f) / radial) ** 2;
    const W0 = E.clone().addScaledVector(w, f);
    const T = E.clone().addScaledVector(w, L);
    const col: V3[] = [];
    for (let k = 0; k < nS; k++) {
      const t = k / nS;
      const p = C.clone().lerp(Aend, t);
      p.z = s.z0 + s.dish * ((t * (radial - f)) / radial) ** 2;
      col.push(p);
    }
    for (let k = 0; k < nC; k++) {
      const t = k / nC;
      col.push(Aend.clone().multiplyScalar((1 - t) ** 2).addScaledVector(E, 2 * t * (1 - t)).addScaledVector(W0, t * t));
    }
    for (let k = 0; k <= nW; k++) col.push(W0.clone().lerp(T, k / nW));
    for (const p of col) p.z -= tanT * (p.y - s.cy);
    top.push(col);
  }
  const M = top[0].length;
  // offset surface along the grid normals (away from the sitter)
  const nAt = (i: number, j: number) => {
    if (j === 0) return v3(0, 0, -1);
    const du = top[(i + 1) % NU][j].clone().sub(top[(i - 1 + NU) % NU][j]);
    const dv = top[i][Math.min(j + 1, M - 1)].clone().sub(top[i][j - 1]);
    return du.cross(dv).normalize();
  };
  // orientation: seat normals must point down
  const sgn = nAt(0, 3).z > 0 ? -1 : 1;
  const rings: V3[][] = [];
  for (let i = 0; i < NU; i++) {
    const P0 = top[i];
    // thickness: the shell's, plus the roll-down ramping in from mid-seat to the edge
    const tAt = (j: number) => {
      const r = THREE.MathUtils.smoothstep(j, nS * 0.45, nS + nC);
      return s.thick + drop[i] * r;
    };
    const Q = P0.map((p, j) => p.clone().addScaledVector(j === 0 ? v3(0, 0, -1) : nAt(i, j).multiplyScalar(sgn), tAt(j)));
    const pe = P0[M - 1], qe = Q[M - 1];
    const tv = pe.clone().sub(P0[M - 2]).normalize();
    const mid = pe.clone().add(qe).multiplyScalar(0.5), half = pe.clone().sub(qe).multiplyScalar(0.5);
    const rim: V3[] = [];
    for (let k = 1; k < kR; k++) {
      const ph = (k / kR) * Math.PI;
      rim.push(mid.clone().addScaledVector(half, Math.cos(ph)).addScaledVector(tv, Math.min(tAt(M - 1) / 2, 2.2) * Math.sin(ph)));
    }
    rings.push([...P0, ...rim, ...Q.reverse()]);
  }
  // rings run around θ; each "ring" here is a column (centre top → rim → centre bottom).
  const pos: number[] = [];
  const L = rings[0].length;
  for (let i = 0; i < NU; i++) {
    const a = rings[i], b = rings[(i + 1) % NU];
    for (let j = 0; j + 1 < L; j++) {
      // skip the zero-area triangles at the two poles (seat centre, top and bottom)
      if (a[j].distanceToSquared(b[j]) > 1e-10) pos.push(a[j].x, a[j].y, a[j].z, b[j].x, b[j].y, b[j].z, b[j + 1].x, b[j + 1].y, b[j + 1].z);
      if (a[j + 1].distanceToSquared(b[j + 1]) > 1e-10) pos.push(a[j].x, a[j].y, a[j].z, b[j + 1].x, b[j + 1].y, b[j + 1].z, a[j + 1].x, a[j + 1].y, a[j + 1].z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  P.mesh(g, group, 'outer', true, SMOOTH_CREASE);
  // rim centre line: dashed hidden outline in transparency
  P.polyline(rings.map(r => r[M - 1 + Math.floor(kR / 2)]), 'hidden', true);
  if (s.seam) P.polyline(top.map(c => c[nS]), 'inner', true);
}

// ── superellipsoid cushion ───────────────────────────────────────────────
interface PillowSpec {
  c: V3;
  /** Half sizes along local x, y (thickness for a back cushion), z. */
  a: number; b: number; cz: number;
  /** Exponents: e1 through z (edge roundness), e2 in plan (corner roundness). */
  e1: number; e2: number;
  /** Tilt (deg): the top moves towards +Y. */
  recline?: number;
  /** Piping seam around the equator. */
  seam?: boolean;
  /** Tufting buttons on the −Y face, local (x, z). */
  frontButtons?: [number, number][];
  /** Tufting buttons on the +Z face, local (x, y). */
  topButtons?: [number, number][];
}

function buildPillow(P: Parts, s: PillowSpec, group: 0 | 1 = 0) {
  const nE = 18, nW = 56;
  const f = (t: number, e: number) => Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** e;
  const gg = (t: number, e: number) => Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** e;
  const rc = Math.cos((s.recline ?? 0) * DEG), rs = Math.sin((s.recline ?? 0) * DEG);
  const tf = (x: number, y: number, z: number) => v3(s.c.x + x, s.c.y + y * rc + z * rs, s.c.z - y * rs + z * rc);
  const rows: V3[][] = [];
  for (let j = 1; j < nE; j++) {
    const eta = -Math.PI / 2 + (j / nE) * Math.PI;
    const row: V3[] = [];
    for (let i = 0; i < nW; i++) {
      const om = (i / nW) * Math.PI * 2;
      row.push(tf(s.a * f(eta, s.e1) * f(om, s.e2), s.b * f(eta, s.e1) * gg(om, s.e2), s.cz * gg(eta, s.e1)));
    }
    rows.push(row);
  }
  // poles: tiny caps (fan) at the bottom and top
  const g = loftRings(rows, true, true);
  P.mesh(g, group, 'outer', true, SMOOTH_CREASE);
  if (s.seam) P.polyline(rows[Math.floor(rows.length / 2)], 'inner', true);
  else P.polyline(rows[Math.floor(rows.length / 2)], 'hidden', true);
  const nrmL = (x: number, y: number, z: number) => v3(0, y * rc + z * rs, -y * rs + z * rc);
  // point on the superellipsoid surface: solve the missing coordinate
  const solve = (u: number, v: number, a: number, b: number, c: number) => {
    // |u/a|^(2/e2) + |w/b|^(2/e2))^(e2/e1) + |v/c|^(2/e1) = 1, solve for w (≥ 0)
    const k = Math.max(0, 1 - Math.abs(v / c) ** (2 / s.e1));
    const m = Math.max(0, k ** (s.e1 / s.e2) - Math.abs(u / a) ** (2 / s.e2));
    return b * m ** (s.e2 / 2);
  };
  for (const [bx, bz] of s.frontButtons ?? []) {
    const by = -solve(bx, bz, s.a, s.b, s.cz) - 0.05;
    P.circle(tf(bx, by, bz), nrmL(0, -1, 0), 0.9, 'inner', 12);
  }
  for (const [bx, by] of s.topButtons ?? []) {
    // top face: solve for z given x, y
    const k = Math.max(0, 1 - (Math.abs(bx / s.a) ** (2 / s.e2) + Math.abs(by / s.b) ** (2 / s.e2)) ** (s.e2 / s.e1));
    const bz = s.cz * k ** (s.e1 / 2) + 0.05;
    P.circle(tf(bx, by, bz), nrmL(0, 0, 1), 0.9, 'inner', 12);
  }
}

// ── models ───────────────────────────────────────────────────────────────

/** GRÖNSTA chair: polypropylene scoop shell, 4 splayed tapered eucalyptus legs with plastic sockets. */
function groensta(P: Parts, arm: boolean) {
  const s: ShellSpec = arm ? {
    cx: 29.5, cy: 22, a: 21, b: 18.6, n: 2.6, taper: 0.06, z0: 43.4, dish: 0.8, tilt: 4,
    rim: [[0, -2.2], [22, -2], [34, 0], [46, 5], [59, 12.5], [74, 16.8], [95, 18.4], [115, 19.4], [135, 24.5], [155, 31.5], [180, 33.3]],
    bx: [[0, 0], [40, 0.27], [75, 0.39], [110, 0.34], [140, 0.16], [180, 0]],
    by: [[0, 0], [60, 0], [100, 0.07], [140, 0.18], [180, 0.2]],
    fillet: 5, thick: 1.2,
  } : {
    cx: 27, cy: 21.3, a: 22.8, b: 17.8, n: 3.0, taper: 0.17, z0: 43.4, dish: 0.9, tilt: 4,
    rim: [[0, -2], [30, -1.8], [48, 0.5], [62, 2.8], [88, 3.6], [103, 5.5], [111, 11], [117, 22], [123, 30.5], [132, 34], [145, 34.8], [180, 35]],
    bx: [[0, 0], [45, 0.2], [80, 0.4], [100, 0.2], [112, 0], [125, -0.04], [150, -0.03], [180, 0]],
    by: [[0, 0], [80, 0], [102, 0.07], [118, 0.18], [135, 0.21], [180, 0.21]],
    fillet: 4, thick: 1.1,
  };
  buildShell(P, s, 0);
  const W = arm ? 59 : 54;
  const cx = W / 2;
  const feet = arm
    ? [v3(7.5, 1.6, 0), v3(W - 7.5, 1.6, 0), v3(6.5, 47.4, 0), v3(W - 6.5, 47.4, 0)]
    : [v3(1.3, 1.6, 0), v3(W - 1.3, 1.6, 0), v3(1.3, 46.4, 0), v3(W - 1.3, 46.4, 0)];
  const tops = arm
    ? [v3(cx - 14, 10.5, 0), v3(cx + 14, 10.5, 0), v3(cx - 13.5, 33.5, 0), v3(cx + 13.5, 33.5, 0)]
    : [v3(cx - 14, 9.5, 0), v3(cx + 14, 9.5, 0), v3(cx - 13.5, 31.5, 0), v3(cx + 13.5, 31.5, 0)];
  for (let i = 0; i < 4; i++) {
    const t = tops[i];
    t.z = shellSeatZ(s, t.x, t.y) - s.thick + 0.3;
    const u = t.clone().sub(feet[i]).normalize();
    const legTop = t.clone().addScaledVector(u, -3.6);
    P.tube(feet[i], legTop, 1.25, 1.75, 1, 'outer', 24, 'a'); // top end hidden in the socket
    // white plastic socket screwed under the shell
    P.tube(legTop, t, 1.95, 2.25, 0, 'outer', 24, 'a');
  }
}

/** NORDMANSSKÄR: upholstered one-piece shell on a black steel frame (hub + 4 splayed round legs). */
function nordmansskaer(P: Parts) {
  const s: ShellSpec = {
    cx: 22, cy: 22.8, a: 18.4, b: 18.5, n: 3.2, taper: 0.1, z0: 43.8, dish: 0.6, tilt: 3,
    rim: [[0, -3.6], [34, -3.2], [50, 0], [65, 1.8], [95, 2.4], [107, 6], [115, 16], [123, 30], [132, 37.5], [145, 39.6], [180, 40]],
    bx: [[0, 0], [50, 0.1], [90, 0.16], [107, 0.04], [120, -0.03], [150, -0.02], [180, 0]],
    by: [[0, 0], [85, 0], [107, 0.11], [125, 0.3], [180, 0.32]],
    fillet: 6, thick: 3.2, seam: true, reach: 1.4,
  };
  buildShell(P, s, 0);
  const zf = shellSeatZ(s, 22, 22.5) - s.thick - 0.2;
  // hub plate under the seat + 4 arms
  P.box(16, 16.5, zf - 1.6, 28, 28.5, zf, 1);
  const feet = [v3(1, 1.5, 0), v3(43, 1.5, 0), v3(1, 55.5, 0), v3(43, 55.5, 0)];
  const tops = [v3(11, 12, zf - 0.9), v3(33, 12, zf - 0.9), v3(11, 34, zf - 0.9), v3(33, 34, zf - 0.9)];
  const hub = [v3(17, 17.5, zf - 0.9), v3(27, 17.5, zf - 0.9), v3(17, 27.5, zf - 0.9), v3(27, 27.5, zf - 0.9)];
  for (let i = 0; i < 4; i++) {
    P.tube(hub[i], tops[i], 0.95, 0.95, 1, 'none', 16, 'none');
    P.tube(feet[i], tops[i], 0.8, 1.1, 1, 'outer', 20, 'a');
  }
}

/** TOSSBERG: upholstered tub with armrests on a steel sled base. */
function tossberg(P: Parts) {
  const s: ShellSpec = {
    cx: 30, cy: 24.4, a: 21.3, b: 19.2, n: 3.4, taper: 0.04, z0: 47.6, dish: 0.5, tilt: 3,
    rim: [[0, -5.6], [26, -5.2], [38, -2.6], [49, 3], [60, 10.5], [71, 14.8], [88, 16], [110, 16.5], [135, 24], [155, 31.5], [180, 33.6]],
    bx: [[0, 0], [50, 0.14], [80, 0.21], [120, 0.17], [150, 0.1], [180, 0]],
    by: [[0, 0], [80, 0], [120, 0.09], [150, 0.2], [180, 0.22]],
    fillet: 5, thick: 4.4, seam: true, reach: 1.4,
  };
  buildShell(P, s, 0);
  const zt = shellSeatZ(s, 30, 24) - s.thick + 0.4;
  for (const sd of [-1, 1]) {
    const xt = 30 + sd * 19, xf = 30 + sd * 27.6;
    P.rodPath([v3(xt, 9, zt), v3(xf, 2.6, 0.75), v3(xf, 53.4, 0.75), v3(xt, 40, zt - 1.5)], 0.75, 3.5, 1);
  }
  // cross bars under the seat
  P.tube(v3(11, 9, zt), v3(49, 9, zt), 0.7, 0.7, 1, 'none', 12, 'none');
  P.tube(v3(11, 40, zt - 1.5), v3(49, 40, zt - 1.5), 0.7, 0.7, 1, 'none', 12, 'none');
}

/** LISABO: ash chair — trapezoid seat, splayed tapered legs, rear legs rising into back posts, curved back rest, X underframe. */
function lisabo(P: Parts, pad: boolean) {
  const W = 46, cx = W / 2;
  const zs = 43.4, ts = 1.7;          // seat bottom, thickness → top at 45.1
  // seat: rounded trapezoid slab, front 44 wide, rear 38
  const sh = new THREE.Shape();
  const yf = 1.2, yb = 40.5, hf = 22, hb = 19, r = 4;
  const corner = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    sh.lineTo(x0, y0); sh.quadraticCurveTo(x1, y1, x2, y2);
  };
  sh.moveTo(cx, yf);
  corner(cx + hf - r, yf, cx + hf, yf, cx + hf - 0.3, yf + r);
  corner(cx + hb + 0.4, yb - r, cx + hb, yb, cx + hb - r, yb);
  corner(cx - hb + r, yb, cx - hb, yb, cx - hb - 0.4, yb - r);
  corner(cx - hf + 0.3, yf + r, cx - hf, yf, cx - hf + r, yf);
  sh.closePath();
  const seat = new THREE.ExtrudeGeometry(sh, { depth: ts, bevelEnabled: false, curveSegments: 8, steps: 1 });
  seat.translate(0, 0, zs);
  P.mesh(seat, 0, 'outer', false);
  // legs (tapered square sections)
  const fl = [v3(1.45, 2.6, 0), v3(W - 1.45, 2.6, 0)];
  const ft = [v3(7.2, 7.6, zs), v3(W - 7.2, 7.6, zs)];
  const rl = [v3(2.2, 49.6, 0), v3(W - 2.2, 49.6, 0)];
  const rt = [v3(7.6, 37.6, zs), v3(W - 7.6, 37.6, zs)];
  const pt = [v3(8.6, 48.8, 79.6), v3(W - 8.6, 48.8, 79.6)];
  for (let i = 0; i < 2; i++) {
    P.bar(fl[i], ft[i], 2.7, 2.7, 3.6, 3.6, 0);
    P.bar(rl[i], rt[i], 2.7, 2.7, 3.6, 3.6, 0);
    // back post: from the rear leg top, through the seat, leaning back to the back rest
    P.bar(v3(rt[i].x, rt[i].y + 0.4, zs - 1.5), pt[i], 3.2, 3.0, 2.6, 2.4, 0);
  }
  // X underframe under the seat
  const zr0 = zs - 4.2;
  for (const [a, b] of [[ft[0], rt[1]], [ft[1], rt[0]]] as const) {
    const A = v3(a.x, a.y, (zr0 + zs) / 2), B = v3(b.x, b.y, (zr0 + zs) / 2);
    P.bar(A, B, 1.8, zs - zr0, 1.8, zs - zr0, 0, Z.clone().cross(B.clone().sub(A)).normalize());
  }
  // curved back rest (ends forward), rounded top corners, in front of the posts
  const hw = 21.5, zb = 67.2, ztp = 80, t = 1.3, rc = 4.5, sag = 3.2;
  const rings: V3[][] = [];
  const N = 30;
  for (let k = 0; k <= N; k++) {
    const x = -hw * Math.cos((k / N) * Math.PI);
    const ex = Math.max(0, Math.abs(x) - (hw - rc));
    const zt = ztp - rc + Math.sqrt(Math.max(0, rc * rc - ex * ex));
    const zb2 = zb + 1.6 - Math.sqrt(Math.max(0, 1.6 * 1.6 - Math.max(0, Math.abs(x) - (hw - 1.6)) ** 2));
    const y0 = 50.9 - t - sag * (x / hw) ** 2;
    // lean back with the posts (top further back)
    const lean = 0.06;
    rings.push([
      v3(cx + x, y0 - lean * (zb2 - 73), zb2), v3(cx + x, y0 - lean * (zt - 73), zt),
      v3(cx + x, y0 + t - lean * (zt - 73), zt), v3(cx + x, y0 + t - lean * (zb2 - 73), zb2),
    ]);
  }
  P.mesh(loftRings(rings, true, true), 0, 'outer', true);
  if (pad) {
    buildPillow(P, { c: v3(cx, 21, zs + ts + 1.45), a: 19.6, b: 18.6, cz: 1.5, e1: 0.5, e2: 0.28, seam: true }, 1);
  }
}

/** IKEA PS 2026: round upholstered seat, 4 square legs (rear one = back post), "+" brace, cylindrical bolster. */
function ps2026(P: Parts) {
  const W = 44, cx = W / 2, cy = 22.4, R = 20.5;
  const lg = 3.5;
  // seat: board + upholstered disc with rounded edges
  const rev = (z0: number, z1: number, r0: number, r1: number, c0: Target, c1: Target, group: 0 | 1 = 0) =>
    P.tube(v3(cx, cy, z0), v3(cx, cy, z1), r0, r1, group, 'outer', 64, c0 === 'none' && c1 === 'none' ? 'none' : c0 === 'none' ? 'b' : c1 === 'none' ? 'a' : 'both');
  rev(40.4, 41.6, R - 1.2, R - 1.2, 'outer', 'none');
  rev(41.6, 42.5, R - 0.9, R, 'outer', 'none');
  rev(42.5, 46.1, R, R, 'none', 'none');
  rev(46.1, 47, R, R - 0.9, 'none', 'outer');
  // legs: front, left, right (top a little above the seat board), rear post up into the bolster
  const leg = (x: number, y: number, z1: number) => P.box(x - lg / 2, y - lg / 2, 0, x + lg / 2, y + lg / 2, z1, 0);
  leg(cx, lg / 2, 43.6);
  leg(lg / 2, cy, 43.6);
  leg(W - lg / 2, cy, 43.6);
  const yp = 48.9;
  leg(cx, yp, 68.5);
  // "+" brace of boards on edge, under the seat
  P.box(lg, cy - 1, 34.6, W - lg, cy + 1, 40.4, 0);
  P.box(cx - 1, lg, 34.6, cx + 1, cy - 1, 40.4, 0);
  P.box(cx - 1, cy + 1, 34.6, cx + 1, yp - lg / 2, 40.4, 0);
  // bolster
  const rb = 6.1;
  P.tube(v3(cx - 15.5, yp, 76 - rb), v3(cx + 15.5, yp, 76 - rb), rb, rb, 0, 'outer', 48);
}

/** DYVLINGE: tufted seat + back cushions on a padded pan, chrome column and 5-star swivel base. */
function dyvlinge(P: Parts) {
  const W = 63, cx = W / 2, cyb = 36;
  // 5-star base: hub, flat tapered spokes, small feet; one spoke towards the back
  P.tube(v3(cx, cyb, 1.8), v3(cx, cyb, 7.2), 4.4, 3.6, 1, 'outer', 40);
  const Rs = 30;
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + (k / 5) * Math.PI * 2;
    const d = v3(Math.cos(a), Math.sin(a), 0);
    const A = v3(cx, cyb, 5.2).addScaledVector(d, 3.4), B = v3(cx, cyb, 1.6).addScaledVector(d, Rs - 1.6);
    P.bar(A, B, 3.6, 2.2, 2.4, 1.1, 1, Z.clone().cross(d));
    const f = v3(cx, cyb, 0).addScaledVector(d, Rs - 1.6);
    P.tube(f, v3(f.x, f.y, 1.2), 1.5, 1.4, 1, 'outer', 16);
  }
  P.tube(v3(cx, cyb, 7.2), v3(cx, cyb, 25), 2.5, 2.5, 1, 'outer', 32);
  P.tube(v3(cx, cyb, 24.6), v3(cx, cyb, 26.4), 8.5, 8.5, 1, 'outer', 48);
  // padded pan + seat cushion (slightly tilted back) + reclined back cushion
  buildPillow(P, { c: v3(cx, 33.5, 30.6), a: 31.2, b: 30.5, cz: 4.4, e1: 0.55, e2: 0.22, recline: 4 }, 0);
  buildPillow(P, {
    c: v3(cx, 30.2, 38.8), a: 31.4, b: 29.6, cz: 6.4, e1: 0.5, e2: 0.2, recline: 5,
    topButtons: [[-9, -6], [9, -6], [0, 6]],
  }, 0);
  buildPillow(P, {
    c: v3(cx, 61.9, 48.4), a: 31.2, b: 8.6, cz: 20, e1: 0.5, e2: 0.3, recline: 22, seam: true,
    frontButtons: [[-9, 10], [9, 10], [0, 3], [-9, -4], [9, -4]],
  }, 0);
}

// ── assembly ─────────────────────────────────────────────────────────────

/** Nominal (IKEA) size of each model: the geometry is designed at this size, then fitted to the item size. */
const NOMINAL: Record<string, Size3> = {
  groensta: { w: 54, d: 48, h: 79 },
  groenstaArm: { w: 59, d: 49, h: 78 },
  nordmansskaer: { w: 44, d: 58, h: 85 },
  tossberg: { w: 60, d: 56, h: 82 },
  lisabo: { w: 46, d: 51, h: 80 },
  lisaboTallmyra: { w: 46, d: 51, h: 80 },
  ps2026: { w: 44, d: 55, h: 76 },
  dyvlinge: { w: 63, d: 75, h: 68 },
};

function lineGeo(positions: number[], withDistances = false): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  g.setPositions(new Float32Array(positions));
  if (withDistances) {
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

function strip(p: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = p.index ? p.toNonIndexed() : p;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

export function buildChair(key: string, s: Size3, variant?: string): ItemGeometry {
  const id = variant && NOMINAL[variant] ? variant : 'groensta';
  const P = new Parts();
  switch (id) {
    case 'groenstaArm': groensta(P, true); break;
    case 'nordmansskaer': nordmansskaer(P); break;
    case 'tossberg': tossberg(P); break;
    case 'lisabo': lisabo(P, false); break;
    case 'lisaboTallmyra': lisabo(P, true); break;
    case 'ps2026': ps2026(P); break;
    case 'dyvlinge': dyvlinge(P); break;
    default: groensta(P, false);
  }
  const w = Math.max(s.w, 1), d = Math.max(s.d, 1), h = Math.max(s.h, 1);

  // faces: group 0 then group 1
  const g0 = P.faces[0].map(strip), g1 = P.faces[1].map(strip);
  let face = mergeGeometries([...g0, ...g1]) ?? g0[0];
  const n0 = g0.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const nAll = face.getAttribute('position').count;
  face.clearGroups();
  face.addGroup(0, n0, 0);
  if (nAll > n0) face.addGroup(n0, nAll - n0, 1);

  // fit the nominal model exactly into [0,w] × [0,d] × [0,h]
  face.computeBoundingBox();
  const bb = face.boundingBox!.clone();
  const sx = w / Math.max(bb.max.x - bb.min.x, 1e-3), sy = d / Math.max(bb.max.y - bb.min.y, 1e-3), sz = h / Math.max(bb.max.z - bb.min.z, 1e-3);
  const m = new THREE.Matrix4().makeScale(sx, sy, sz).multiply(new THREE.Matrix4().makeTranslation(-bb.min.x, -bb.min.y, -bb.min.z));
  face.applyMatrix4(m);
  face.computeBoundingBox();
  face.computeBoundingSphere();
  const tp = (arr: number[]) => {
    const out = new Array<number>(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      out[i] = (arr[i] - bb.min.x) * sx; out[i + 1] = (arr[i + 1] - bb.min.y) * sy; out[i + 2] = (arr[i + 2] - bb.min.z) * sz;
    }
    return out;
  };
  const outer = tp(P.outer), inner = tp(P.inner), hidden = tp(P.hidden);
  const rs = (sx + sy + sz) / 3;
  const frusta: Frustum[] = P.frusta.map(f => ({
    a: v3((f.a.x - bb.min.x) * sx, (f.a.y - bb.min.y) * sy, (f.a.z - bb.min.z) * sz),
    b: v3((f.b.x - bb.min.x) * sx, (f.b.y - bb.min.y) * sy, (f.b.z - bb.min.z) * sz),
    ra: f.ra * rs, rb: f.rb * rs,
  }));
  const silNrm = new Float32Array(P.silNrm.length);
  for (let i = 0; i < P.silNrm.length; i += 3) {
    const nx = P.silNrm[i] / sx, ny = P.silNrm[i + 1] / sy, nz = P.silNrm[i + 2] / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    silNrm[i] = nx / l; silNrm[i + 1] = ny / l; silNrm[i + 2] = nz / l;
  }
  const sil: SilhouetteEdges = { tri: new Float32Array(tp(P.silTri)), nrm: silNrm };
  face.userData[SIL_KEY] = sil;

  return {
    key,
    size: { w, d, h },
    face,
    outer: lineGeo(outer.length ? outer : [0, 0, 0, 0, 0, 0]),
    inner: inner.length ? lineGeo(inner) : null,
    basket: null,
    all: lineGeo([...outer, ...inner, ...hidden], true),
    frusta,
    refs: 0,
  };
}
