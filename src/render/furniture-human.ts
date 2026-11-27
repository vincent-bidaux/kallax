// ─────────────────────────────────────────────────────────────
// Human figure geometry (core/objects-human.ts): a stylised mannequin.
//
// The body is ONE smooth surface: a signed distance field made of a few
// primitives (head + jaw + nose ellipsoids, neck, shoulder girdle, chest /
// waist / pelvis ellipsoids, deltoids, upper arms, forearms, hands, thighs,
// knees, calves, shins, feet — round cones and ellipsoids) joined with smooth
// unions, polygonised with surface nets and its vertices projected back on
// the surface. Normals come from the field gradient, so the mesh is smooth
// everywhere: no static edges at all, only the view-dependent contour
// (face.userData[SIL_KEY], see ItemView.updateSilhouette) — a clean drawn
// outline from any angle, without wireframe noise.
//
// Nominal model (adult, cm): x centred, y = 0 on the body's mid plane with
// the face / toes towards −y, z = 0 on the floor. The child (~10 years) is
// the adult warped by landmark heights (ankle, knee, hip, waist, shoulder,
// chin, top of the head) and width / depth factors that differ for the head
// (relatively bigger) and the body. The result is fitted to the item box.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { Size3 } from '../core/types';
import { lineGeo, type ItemGeometry } from './item-geometry';
import { SIL_KEY, type SilhouetteEdges } from './furniture-chairs';
import { humanVariant, type HumanVariant } from '../core/objects-human';

type Field = (x: number, y: number, z: number) => number;

// ── SDF primitives ───────────────────────────────────────────────────────
/** Ellipsoid (approximate distance, iq's bound). */
function ell(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const qx = px / rx, qy = py / ry, qz = pz / rz;
  const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** Round cone from a (radius r1) to b (radius r2) — iq's exact sdRoundCone. */
function rcone(x: number, y: number, z: number, a: readonly number[], b: readonly number[], r1: number, r2: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

/** Polynomial smooth minimum (blend radius k). */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ── adult mannequin (nominal, 180 cm) ────────────────────────────────────
// limb axes [x, y, z] for the RIGHT side of the figure (x > 0); mirrored for the left.
const UPPER_ARM = [[19.2, 1.4, 139.5], [21.7, 2.2, 114]] as const;
const FOREARM = [[21.7, 2.2, 114], [24.0, -0.6, 88.5]] as const;
const THIGH = [[9.0, 1.2, 91], [9.8, 0.4, 51]] as const;
const SHIN = [[9.9, 0.6, 49], [10.4, 2.4, 8.5]] as const;
const HEEL = [[10.4, 4.0, 3.7], [11.0, -9.5, 3.1]] as const;
// trapezius: sloping from the base of the neck down to each shoulder
const GIRDLE = [[0, 1.8, 146.5], [14.5, 1.6, 142.2]] as const;
const NECK = [[0, 1.4, 145], [0, 0.9, 159]] as const;

function arm(x: number, y: number, z: number): number {
  let d = ell(x, y, z, 18.3, 1.3, 141.2, 5.3, 6.1, 6.6);                     // deltoid
  d = smin(d, rcone(x, y, z, UPPER_ARM[0], UPPER_ARM[1], 4.4, 3.8), 3);
  d = smin(d, rcone(x, y, z, FOREARM[0], FOREARM[1], 4.0, 2.6), 2.5);
  d = smin(d, ell(x, y, z, 24.7, -1.3, 78.6, 1.75, 4.3, 9.4), 2.2);         // hand (palm towards the body)
  d = smin(d, ell(x, y, z, 23.9, -4.9, 82.5, 1.45, 1.5, 3.6), 1.2);         // thumb
  return d;
}

function leg(x: number, y: number, z: number): number {
  let d = rcone(x, y, z, THIGH[0], THIGH[1], 8.6, 5.4);
  d = smin(d, ell(x, y, z, 9.9, 0.1, 50.5, 5.4, 5.7, 6.4), 3);              // knee
  d = smin(d, rcone(x, y, z, SHIN[0], SHIN[1], 5.2, 3.0), 3);
  d = smin(d, ell(x, y, z, 10.0, 2.7, 36, 5.0, 5.6, 10.5), 3.5);           // calf
  let f = rcone(x, y, z, HEEL[0], HEEL[1], 3.6, 3.1);                        // heel → ball
  f = smin(f, ell(x, y, z, 11.3, -12.2, 2.8, 4.6, 6.7, 2.9), 3);            // forefoot
  d = smin(d, f, 3.5);
  return Math.max(d, -z);                                                    // flat sole on the floor
}

/** Distance from a point to an axis-aligned box (0 inside): a lower bound of a part's distance. */
function boxDist(x: number, y: number, z: number, b: readonly number[]): number {
  const dx = Math.max(b[0] - x, 0, x - b[3]), dy = Math.max(b[1] - y, 0, y - b[4]), dz = Math.max(b[2] - z, 0, z - b[5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
// Bounds of the parts (right side; with the blend radius, a part farther than
// d + k cannot change the smooth union and is skipped — exact, just faster).
const ARM_BOX = [12.5, -7, 68, 27.5, 8, 148.5];
const LEG_BOX = [0, -19.5, 0, 19, 11, 100];
const HEAD_BOX = [-8, -11.5, 155, 8, 10.5, 180.5];

/** Adult field (nominal coordinates). */
const adult: Field = (x, y, z) => {
  const ax = Math.abs(x); // left / right symmetry
  // torso
  let d = ell(x, y, z, 0, 0.6, 131, 14.0, 11, 15.5);                        // chest
  d = smin(d, ell(x, y, z, 0, 0.8, 113, 13.2, 9.8, 11), 8);                 // waist
  d = smin(d, ell(x, y, z, 0, 1.0, 96, 16.2, 10.6, 11.5), 8);               // pelvis
  d = smin(d, ell(ax, y, z, 6.8, 3.6, 91, 8.0, 7.4, 8.8), 4);               // buttocks
  d = smin(d, rcone(ax, y, z, GIRDLE[0], GIRDLE[1], 6.4, 5.3), 5);          // shoulders / trapezius
  d = smin(d, rcone(x, y, z, NECK[0], NECK[1], 6.0, 5.4), 4);               // neck
  // head
  if (boxDist(x, y, z, HEAD_BOX) < d + 2.5) {
    let hd = ell(x, y, z, 0, 0.3, 168.8, 7.7, 9.8, 11.3);
    hd = smin(hd, ell(x, y, z, 0, -3.0, 161.4, 5.6, 5.9, 4.7), 3);          // jaw / chin
    hd = smin(hd, ell(x, y, z, 0, -9.5, 166.4, 1.3, 1.7, 2.5), 1.2);        // nose
    d = smin(d, hd, 2.5);
  }
  // limbs
  if (boxDist(ax, y, z, ARM_BOX) < d + 2.2) d = smin(d, arm(ax, y, z), 2.2);
  if (boxDist(ax, y, z, LEG_BOX) < d + 3) d = smin(d, leg(ax, y, z), 3);
  return d;
};

// ── child: the adult warped by landmarks ─────────────────────────────────
// Landmark heights (adult → child): floor, ankle, knee, hip, waist, shoulder, chin, top.
const Z_ADULT = [0, 8.5, 50, 91, 113, 143, 157, 180];
const Z_CHILD = [0, 6.6, 38, 69, 83, 106.5, 120, 140];
const pwl = (from: number[], to: number[], v: number) => {
  const n = from.length - 1;
  let i = 0;
  while (i < n - 1 && v > from[i + 1]) i++;
  const t = (v - from[i]) / (from[i + 1] - from[i]);
  return to[i] + t * (to[i + 1] - to[i]);
};
/** Head / body width and depth factors, blended across the neck (adult z 149 → 158). */
function childScale(zAdult: number): [number, number] {
  const t = THREE.MathUtils.smoothstep(zAdult, 149, 158);
  return [0.71 + (0.93 - 0.71) * t, 0.77 + (0.92 - 0.77) * t];
}
const child: Field = (x, y, z) => {
  const za = pwl(Z_CHILD, Z_ADULT, z);
  const [sx, sy] = childScale(za);
  return adult(x / sx, y / sy, za) * Math.min(sx, sy);
};

const FIELDS: Record<HumanVariant, { f: Field; step: number; box: [number, number, number, number, number, number] }> = {
  adult: { f: adult, step: 1.5, box: [-28, -22, -1, 28, 15, 183] },
  child: { f: child, step: 1.2, box: [-21, -17, -1, 21, 12, 143] },
};

// ── surface nets ─────────────────────────────────────────────────────────
/**
 * Polygonise f < 0 on a regular grid: one vertex per cell crossed by the
 * surface (mean of the edge crossings, then projected on f = 0), one quad
 * per grid edge crossed (around it, the 4 cells' vertices), outward winding.
 * Returns non-indexed triangles with gradient normals.
 */
function surfaceNets(f: Field, box: readonly number[], step: number): { pos: Float32Array; nrm: Float32Array } {
  const [x0, y0, z0, x1, y1, z1] = box;
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Sample by blocks of B³ points: a block whose centre is farther from the
  // surface than its half diagonal (+ one step) has no crossing (the field is
  // ~1-Lipschitz) and only needs its sign.
  const B = 4, half = (B - 1) * step * Math.sqrt(3) / 2;
  for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
    const ei = Math.min(bi + B, nx), ej = Math.min(bj + B, ny), ek = Math.min(bk + B, nz);
    const c = f(x0 + (bi + ei - 1) / 2 * step, y0 + (bj + ej - 1) / 2 * step, z0 + (bk + ek - 1) / 2 * step);
    const far = Math.abs(c) > half + step * 1.5;
    for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) for (let i = bi; i < ei; i++) {
      F[id(i, j, k)] = far ? c : f(x0 + i * step, y0 + j * step, z0 + k * step);
    }
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  const vIdx = new Int32Array(cx * cy * cz).fill(-1);
  const V: number[] = [];
  const VN: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  const eps = step * 0.12;
  /** Unit gradient (forward differences, `d` = f at the point) into `out`; returns |∇f|. */
  const grad = (x: number, y: number, z: number, d: number, out: number[]) => {
    out[0] = f(x + eps, y, z) - d;
    out[1] = f(x, y + eps, z) - d;
    out[2] = f(x, y, z + eps) - d;
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return l / eps;
  };
  const g = [0, 0, 0];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      const o = corner[c];
      val[c] = F[id(i + o[0], j + o[1], k + o[2])];
      if (val[c] < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((val[a] < 0) === (val[b] < 0)) continue;
      const t = val[a] / (val[a] - val[b]);
      const pa = corner[a], pb = corner[b];
      sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t;
      n++;
    }
    let px = x0 + (i + sx / n) * step, py = y0 + (j + sy / n) * step, pz = z0 + (k + sz / n) * step;
    // project onto the surface (one Newton step along the gradient, bounded to the cell size)
    let d = f(px, py, pz);
    const gl = grad(px, py, pz, d, g);
    const st = Math.max(-step, Math.min(step, d / Math.max(gl, 1e-3)));
    px -= g[0] * st; py -= g[1] * st; pz -= g[2] * st;
    d = f(px, py, pz);
    vIdx[cell(i, j, k)] = V.length / 3;
    V.push(px, py, pz);
    grad(px, py, pz, d, g);
    VN.push(g[0], g[1], g[2]);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dac = (V[a * 3] - V[c * 3]) ** 2 + (V[a * 3 + 1] - V[c * 3 + 1]) ** 2 + (V[a * 3 + 2] - V[c * 3 + 2]) ** 2;
    const dbd = (V[b * 3] - V[d * 3]) ** 2 + (V[b * 3 + 1] - V[d * 3 + 1]) ** 2 + (V[b * 3 + 2] - V[d * 3 + 2]) ** 2;
    const tri = (p: number, q: number, r: number) => {
      for (const v of [p, q, r]) { pos.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); nrm.push(VN[v * 3], VN[v * 3 + 1], VN[v * 3 + 2]); }
    };
    if (dac <= dbd) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const f0 = F[id(i, j, k)] < 0;
    // edge along +x: cells around it in the (y, z) plane
    if (i < cx && f0 !== (F[id(i + 1, j, k)] < 0)) {
      const a = vIdx[cell(i, j - 1, k - 1)], b = vIdx[cell(i, j, k - 1)], c = vIdx[cell(i, j, k)], d = vIdx[cell(i, j - 1, k)];
      if (f0) quad(a, b, c, d); else quad(d, c, b, a);
    }
    // edge along +y: (z, x) plane
    if (j < cy && f0 !== (F[id(i, j + 1, k)] < 0)) {
      const a = vIdx[cell(i - 1, j, k - 1)], b = vIdx[cell(i - 1, j, k)], c = vIdx[cell(i, j, k)], d = vIdx[cell(i, j, k - 1)];
      if (f0) quad(a, b, c, d); else quad(d, c, b, a);
    }
    // edge along +z: (x, y) plane
    if (k < cz && f0 !== (F[id(i, j, k + 1)] < 0)) {
      const a = vIdx[cell(i - 1, j - 1, k)], b = vIdx[cell(i, j - 1, k)], c = vIdx[cell(i, j, k)], d = vIdx[cell(i - 1, j, k)];
      if (f0) quad(a, b, c, d); else quad(d, c, b, a);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
}

/** Polygonised nominal mannequins, per variant (the geometry cache keys on the size too). */
const meshes = new Map<HumanVariant, { pos: Float32Array; nrm: Float32Array; bb: THREE.Box3 }>();
function nominalMesh(v: HumanVariant) {
  let m = meshes.get(v);
  if (!m) {
    const { f, step, box } = FIELDS[v];
    const r = surfaceNets(f, box, step);
    const bb = new THREE.Box3();
    for (let i = 0; i < r.pos.length; i += 3) bb.expandByPoint(new THREE.Vector3(r.pos[i], r.pos[i + 1], r.pos[i + 2]));
    m = { ...r, bb };
    meshes.set(v, m);
  }
  return m;
}

/** Natural W × D × H of a mannequin (cm), for tests / catalogue sizes. */
export function humanNominalSize(variant: string | undefined): Size3 {
  const bb = nominalMesh(humanVariant(variant)).bb;
  return { w: bb.max.x - bb.min.x, d: bb.max.y - bb.min.y, h: bb.max.z - bb.min.z };
}

export function buildHuman(key: string, s: Size3, variant: string | undefined): ItemGeometry {
  const m = nominalMesh(humanVariant(variant));
  const w = Math.max(s.w, 1), d = Math.max(s.d, 1), h = Math.max(s.h, 1);
  const bb = m.bb;
  const kx = w / (bb.max.x - bb.min.x), ky = d / (bb.max.y - bb.min.y), kz = h / (bb.max.z - bb.min.z);
  const pos = new Float32Array(m.pos.length), nrm = new Float32Array(m.nrm.length);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (m.pos[i] - bb.min.x) * kx;
    pos[i + 1] = (m.pos[i + 1] - bb.min.y) * ky;
    pos[i + 2] = (m.pos[i + 2] - bb.min.z) * kz;
    // normals under a non-uniform scale: inverse transpose
    const nx = m.nrm[i] / kx, ny = m.nrm[i + 1] / ky, nz = m.nrm[i + 2] / kz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i] = nx / l; nrm[i + 1] = ny / l; nrm[i + 2] = nz / l;
  }
  const face = new THREE.BufferGeometry();
  face.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  face.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  face.computeBoundingBox();
  face.computeBoundingSphere();
  const sil: SilhouetteEdges = { tri: pos, nrm };
  face.userData[SIL_KEY] = sil;
  const none = [0, 0, 0, 0, 0, 0];
  return { key, size: { w, d, h }, face, outer: lineGeo(none), inner: null, basket: null, all: lineGeo(none, true), refs: 0 };
}
