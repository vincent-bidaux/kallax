// Beds, lamps and plants geometry (catalogue "Objets"). OWNED BY THE FURNITURE AGENT.
// Local space: the item occupies [0,w] × [0,d] × [0,h], front at y = 0.
// Clean vector look: faces for hidden-line removal + explicit edges; revolved
// parts also return frusta so ItemView draws view-dependent silhouettes.
import * as THREE from 'three';
import type { Size3 } from '../core/types';
import { BED_SLAB, variantOf } from '../core/objects';
import {
  frustumZ, lineGeo, mergeFaces, pushCircle, pushRectXY, pushRoundRectXY, pushSeg,
  type Frustum, type ItemGeometry,
} from './item-geometry';

// ── shared helpers ───────────────────────────────────────────────────────
type P2 = [number, number];
type P3 = [number, number, number];
const UP = new THREE.Vector3(0, 0, 1);
const clamp = THREE.MathUtils.clamp;

/** Rounded rectangle, CCW seen from above; `seg` segments per corner (seg = 0 → sharp 4-corner rect). */
export function roundRectPts(x0: number, y0: number, x1: number, y1: number, r: number, seg: number): P2[] {
  if (seg <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  r = clamp(r, 0.01, Math.min(x1 - x0, y1 - y0) / 2);
  const pts: P2[] = [];
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
  return pts;
}

export interface Ring { pts: P2[]; z: number }

/**
 * Closed loft through horizontal rings (bottom → top, same point count, CCW),
 * capped at both ends. Non-indexed, so normals are per facet (low-poly look).
 */
export function loftRings(rings: Ring[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const P = (r: Ring, i: number): P3 => { const p = r.pts[(i + r.pts.length) % r.pts.length]; return [p[0], p[1], r.z]; };
  const tri = (a: P3, b: P3, c: P3) => pos.push(...a, ...b, ...c);
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < A.pts.length; i++) {
      const a = P(A, i), b = P(A, i + 1), c = P(B, i + 1), d = P(B, i);
      tri(a, b, c); tri(a, c, d);
    }
  }
  const cap = (r: Ring, up: boolean) => {
    let cx = 0, cy = 0;
    for (const p of r.pts) { cx += p[0]; cy += p[1]; }
    const c: P3 = [cx / r.pts.length, cy / r.pts.length, r.z];
    for (let i = 0; i < r.pts.length; i++) { if (up) tri(c, P(r, i), P(r, i + 1)); else tri(c, P(r, i + 1), P(r, i)); }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

export function pushPolyline(out: number[], pts: P3[], closed = false) {
  for (let i = 0; i < pts.length - 1; i++) pushSeg(out, ...pts[i], ...pts[i + 1]);
  if (closed && pts.length > 2) pushSeg(out, ...pts[pts.length - 1], ...pts[0]);
}
const ringLine = (out: number[], r: Ring) => pushPolyline(out, r.pts.map(p => [p[0], p[1], r.z] as P3), true);

/** Cylinder / cone frustum between two arbitrary points (radius ra at a, rb at b). */
export function rodGeo(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb = ra, seg = 20): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(rb, ra, dir.length(), seg, 1, false); // +Y end = b
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Collects faces / edges / frusta of one object. */
export class Parts {
  faces: THREE.BufferGeometry[] = [];
  outer: number[] = [];
  inner: number[] = [];
  frusta: Frustum[] = [];
  /** Vertical revolved part about (cx, cy): faces, end circles (optional), silhouette frustum. */
  rev(cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, circles: 'both' | 'bottom' | 'top' | 'none' = 'both') {
    this.faces.push(frustumZ(cx, cy, z0, z1, r0, r1));
    const a = new THREE.Vector3(cx, cy, z0), b = new THREE.Vector3(cx, cy, z1);
    if ((circles === 'both' || circles === 'bottom') && r0 > 0.05) pushCircle(this.outer, a, UP, r0, 48);
    if ((circles === 'both' || circles === 'top') && r1 > 0.05) pushCircle(this.outer, b, UP, r1, 48);
    this.frusta.push({ a, b, ra: r0, rb: r1 });
  }
  /** Rod / tube between two points (no end circles unless asked). */
  rod(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb = ra, ends = false) {
    this.faces.push(rodGeo(a, b, ra, rb));
    if (ends) {
      const u = b.clone().sub(a).normalize();
      pushCircle(this.outer, a, u, ra, 32);
      pushCircle(this.outer, b, u, rb, 32);
    }
    this.frusta.push({ a: a.clone(), b: b.clone(), ra, rb });
  }
  /** Low-poly solid with its crease edges (EdgesGeometry, `thresholdDeg`). */
  facets(g: THREE.BufferGeometry, thresholdDeg = 20, into: 'outer' | 'inner' = 'inner') {
    g.computeVertexNormals();
    this.faces.push(g);
    const eg = new THREE.EdgesGeometry(g, thresholdDeg);
    const arr = eg.getAttribute('position').array as Float32Array;
    const out = into === 'outer' ? this.outer : this.inner;
    for (let i = 0; i < arr.length; i++) out.push(arr[i]);
    eg.dispose();
  }
  done(key: string, size: Size3): ItemGeometry {
    const face = mergeFaces(this.faces);
    const inner = this.inner.length ? lineGeo(this.inner) : null;
    return {
      key, size, face, outer: lineGeo(this.outer), inner, basket: null,
      all: lineGeo([...this.outer, ...this.inner], true),
      frusta: this.frusta.length ? this.frusta : undefined, refs: 0,
    };
  }
}

/** Deterministic pseudo-random in [0, 1) (stable geometry for a given key). */
function rng(seed: number) {
  let s = Math.floor(seed * 9973) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ── bed ──────────────────────────────────────────────────────────────────
/**
 * Bed: 20 cm slab (base + mattress seam) whose top edges are rounded (2.5 cm
 * fillet, drawn by its two tangent lines and the corner mitres), a turned-down
 * duvet and real 3D pillows (soft, squashed rounded cushions with a seam) on
 * the mattress at the head end (+Y). The item box includes the pillows
 * (h = 20 + pillow height). Legacy 20 cm beds keep flat pillow outlines.
 */
export function buildBed(key: string, s: Size3): ItemGeometry {
  const w = Math.max(s.w, 40), d = Math.max(s.d, 60), h = Math.max(s.h, 5);
  const H = Math.min(BED_SLAB, h);
  const ph = h - H;
  const r = Math.min(2.5, H * 0.2);
  const seam = Math.min(7, H * 0.35);
  const p = new Parts();

  // slab: mitred rings (sharp vertical corners), fillet along the 4 top edges
  const N = 4;
  const rect = (o: number): P2[] => [[o, o], [w - o, o], [w - o, d - o], [o, d - o]];
  const prof: [number, number][] = [[0, 0], [0, H - r]];
  for (let i = 1; i <= N; i++) { const a = (i / N) * Math.PI / 2; prof.push([r * (1 - Math.cos(a)), H - r + r * Math.sin(a)]); }
  p.faces.push(loftRings(prof.map(([o, z]) => ({ pts: rect(o), z }))));
  pushRectXY(p.outer, 0, 0, w, d, 0);
  pushRectXY(p.outer, 0, 0, w, d, H - r);           // side tangent line
  pushRectXY(p.outer, r, r, w - r, d - r, H);       // top tangent line
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, d, -1, -1], [0, d, 1, -1]] as const) {
    pushSeg(p.outer, cx, cy, 0, cx, cy, H - r);
    pushPolyline(p.outer, prof.slice(1).map(([o, z]) => [cx + sx * o, cy + sy * o, z] as P3)); // corner mitre
  }
  pushRectXY(p.inner, 0, 0, w, d, seam);            // base / mattress seam

  // pillows (head end, +Y)
  const pd = Math.min(42, d / 4.2), py1 = d - 4, py0 = py1 - pd;
  const pillows: [number, number][] = [];
  if (w < 120) {
    const pw = clamp(w * 0.66, 34, 65);
    pillows.push([(w - pw) / 2, (w + pw) / 2]);
  } else {
    const pw = clamp(w * 0.4, 50, 70), gap = w * 0.06;
    const m = (w - 2 * pw - gap) / 2;
    pillows.push([m, m + pw], [w - m - pw, w - m]);
  }
  for (const [x0, x1] of pillows) {
    if (ph >= 4) pillow(p, x0, py0, x1, py1, H + 0.05, ph - 0.05);
    else {
      pushRoundRectXY(p.inner, x0, py0, x1, py1, H, 6);
      pushRoundRectXY(p.inner, x0 + 3, py0 + 3, x1 - 3, py1 - 3, H, 4);
    }
  }

  // duvet: fold line ~1/3 from the head, turned-down band towards the head, drops on the sides
  const yf = d - d / 3, yb = Math.min(yf + 9, py0 - 3);
  pushSeg(p.inner, r, yf, H, w - r, yf, H);
  pushSeg(p.inner, r, yb, H, w - r, yb, H);
  for (const [x, sx] of [[0, 1], [w, -1]] as const) {
    pushSeg(p.inner, x, yf, H - r, x, yf, seam);
    pushPolyline(p.inner, prof.slice(1).map(([o, z]) => [x + sx * o, yf, z] as P3));
  }
  return p.done(key, { w, d, h });
}

/**
 * Soft pillow on [x0,x1] × [y0,y1] from z = zb, height ph: rounded-rect rings
 * following a quarter-ellipse profile above and below a seam (~1/3 up).
 * Edges: seam, crown outline and the four side meridians (end contours).
 */
function pillow(p: Parts, x0: number, y0: number, x1: number, y1: number, zb: number, ph: number) {
  const pw = x1 - x0, pd = y1 - y0, m = Math.min(pw, pd);
  const rc = Math.min(10, pd * 0.24);
  const zs = zb + ph * 0.34, hu = zb + ph - zs, hl = zs - zb;
  const Au = m * 0.27, Al = m * 0.1;
  const K = 4, seg = 3;
  const prof: [number, number][] = [];
  for (let k = K; k >= 1; k--) { const f = (k / K) * Math.PI / 2; prof.push([Al * (1 - Math.cos(f)), zs - hl * Math.sin(f)]); }
  prof.push([0, zs]);
  for (let k = 1; k <= K; k++) { const f = (k / K) * Math.PI / 2; prof.push([Au * (1 - Math.cos(f)), zs + hu * Math.sin(f)]); }
  const rings = prof.map(([o, z]) => ({ pts: roundRectPts(x0 + o, y0 + o, x1 - o, y1 - o, Math.max(rc - o * 0.6, 1.5), seg), z }));
  p.faces.push(loftRings(rings));
  ringLine(p.inner, rings[K]);                 // seam
  ringLine(p.inner, rings[rings.length - 1]);  // crown
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  // end meridians (left / right), bottom → crown: the pillow's contour in front elevation
  pushPolyline(p.inner, prof.map(([o, z]) => [x0 + o, ym, z] as P3));
  pushPolyline(p.inner, prof.map(([o, z]) => [x1 - o, ym, z] as P3));
  void xm;
}

// ── lamps ────────────────────────────────────────────────────────────────
export function buildLamp(key: string, s: Size3, variant?: string): ItemGeometry {
  const w = Math.max(s.w, 6), d = Math.max(s.d, 6), h = Math.max(s.h, 10);
  const p = new Parts();
  const id = variantOf('lamp', variant)?.id ?? 'h28';
  if (id === 'floor') floorLamp(p, w, d, h);
  else if (id === 'tripod') tripodLamp(p, w, d, h);
  else if (id === 'arc') arcLamp(p, w, d, h);
  else if (id === 'reading') readingLamp(p, w, d, h);
  else tableLamp(p, w, d, h);
  return p.done(key, { w, d, h });
}

/** Table lamp: base disc, thin stem, truncated-cone shade (wider at the bottom). */
function tableLamp(p: Parts, w: number, d: number, h: number) {
  const R = Math.min(w, d) / 2;
  const baseH = clamp(h * 0.06, 1.4, 3);
  const shadeH = h * 0.44;
  const stemR = clamp(R * 0.06, 0.45, 0.9);
  p.rev(w / 2, d / 2, 0, baseH, R * 0.6, R * 0.56);
  p.rev(w / 2, d / 2, baseH, h - shadeH * 0.4, stemR, stemR);
  p.rev(w / 2, d / 2, h - shadeH, h, R, R * 0.6);
}

/** Classic floor lamp (ÅRSTID-like): weighted disc base, slim pole, fabric drum shade. */
function floorLamp(p: Parts, w: number, d: number, h: number) {
  const R = Math.min(w, d) / 2, cx = w / 2, cy = d / 2;
  const shadeH = clamp(h * 0.2, 18, 34);
  const baseR = Math.min(14, R * 0.78);
  p.rev(cx, cy, 0, 2.2, baseR, baseR * 0.92);
  p.rev(cx, cy, 2.2, 4.2, 2.2, 1.6, 'top');                 // collar
  p.rev(cx, cy, 4.2, h - shadeH * 0.55, 0.9, 0.9, 'none');  // pole (into the shade)
  p.rev(cx, cy, h - shadeH, h, R, R * 0.86);                // drum shade
}

/** Tripod floor lamp: three splayed wooden legs, a hub, drum shade. */
function tripodLamp(p: Parts, w: number, d: number, h: number) {
  const R = Math.min(w, d) / 2, cx = w / 2, cy = d / 2;
  const shadeH = clamp(h * 0.21, 20, 34);
  const shadeR = R * 0.78;
  const zHub = h - shadeH - 8;
  const footR = R - 1.4;
  const hub = new THREE.Vector3(cx, cy, zHub);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3; // one leg at the back
    const foot = new THREE.Vector3(cx + footR * Math.cos(a), cy + footR * Math.sin(a), 0.6);
    const top = new THREE.Vector3(cx + 1.6 * Math.cos(a), cy + 1.6 * Math.sin(a), zHub + 3);
    p.rod(foot, top, 1.1, 1.4);
  }
  p.rev(cx, cy, zHub - 2, zHub + 4, 2.4, 2.4);               // hub
  p.rev(cx, cy, zHub + 4, h - shadeH * 0.5, 0.7, 0.7, 'none');
  p.rev(cx, cy, h - shadeH, h, shadeR, shadeR * 0.94);
}

/**
 * Arc floor lamp: heavy disc base at the back, a pole rising then arching
 * forward (cubic Bézier, drawn as a tube of short frusta), dome shade hanging
 * over the front. Base at +Y, shade at the front (y ≈ shade radius).
 */
function arcLamp(p: Parts, w: number, d: number, h: number) {
  const cx = w / 2;
  const shadeR = Math.min(w / 2, 20), baseR = Math.min(w / 2, 16);
  const yb = d - baseR, ys = shadeR;
  const baseH = 4, rTube = 1.2;
  p.rev(cx, yb, 0, baseH, baseR, baseR * 0.96);
  p.rev(cx, yb, baseH, baseH + 3, 3, 2, 'top');
  const z1 = h * 0.5;                 // end of the straight part
  const zEnd = h - clamp(h * 0.16, 22, 34); // pole tip = shade top
  const zPeak = h - rTube - 0.3;
  const bez = (t: number, k: number): [number, number] => {
    const u = 1 - t;
    const y = u * u * u * yb + 3 * u * u * t * yb + 3 * u * t * t * ys + t * t * t * ys;
    const z = u * u * u * z1 + 3 * u * u * t * (z1 + k) + 3 * u * t * t * (zEnd + k) + t * t * t * zEnd;
    return [y, z];
  };
  const NS = 28;
  const peak = (k: number) => { let m = -Infinity; for (let i = 0; i <= NS; i++) m = Math.max(m, bez(i / NS, k)[1]); return m; };
  let k = (8 * zPeak - 4 * z1 - 4 * zEnd) / 6;
  for (let it = 0; it < 6; it++) k += (zPeak - peak(k)) * 1.3;
  const pts = [new THREE.Vector3(cx, yb, baseH + 3)];
  for (let i = 0; i <= NS; i++) { const [y, z] = bez(i / NS, k); pts.push(new THREE.Vector3(cx, y, z)); }
  for (let i = 0; i < pts.length - 1; i++) p.rod(pts[i], pts[i + 1], rTube);
  // shade: dome (two frusta) hanging from the tip
  const sh = h - zEnd;
  const zb = zEnd - sh + 6;
  p.rev(cx, ys, zb, zEnd - 3, shadeR, shadeR * 0.42);
  p.rev(cx, ys, zEnd - 3, zEnd, shadeR * 0.42, 2.2, 'none');
}

/** Slim reading floor lamp: small base, thin pole, short arm and a tilted cone head. */
function readingLamp(p: Parts, w: number, d: number, h: number) {
  const cx = w / 2;
  const baseR = Math.min(w / 2, 12);
  const yb = d - baseR - 1;
  p.rev(cx, yb, 0, 2.4, baseR, baseR * 0.94);
  const zTop = h - 14;
  p.rev(cx, yb, 2.4, zTop, 0.8, 0.8, 'none');
  const elbow = new THREE.Vector3(cx, yb, zTop);
  p.rev(cx, yb, zTop - 1.5, zTop + 1.5, 1.3, 1.3);           // joint
  const headTop = new THREE.Vector3(cx, Math.max(13, d * 0.33), h - 2.6);
  p.rod(elbow, headTop, 0.7);
  const dir = new THREE.Vector3(0, -0.42, -0.9).normalize();
  const headBot = headTop.clone().addScaledVector(dir, 15);
  p.rod(headTop, headBot, 2.4, 7, true);
}

// ── plants ───────────────────────────────────────────────────────────────
export function buildPlant(key: string, s: Size3, variant?: string): ItemGeometry {
  const w = Math.max(s.w, 8), d = Math.max(s.d, 8), h = Math.max(s.h, 12);
  const v = variantOf('plant', variant);
  const p = new Parts();
  if (v?.id.startsWith('t') && v.hang) trailingPlant(p, w, d, h, v.hang, v.hangDepth ?? 7);
  else if (v?.id.startsWith('b')) bushyPlant(p, w, d, h);
  else classicPlant(p, w, d, h);
  return p.done(key, { w, d, h });
}

/** Overlapping low-poly clumps (dodecahedra), kept inside the box. */
function clump(p: Parts, w: number, d: number, h: number, cx: number, cy: number, cz: number, r: number, rz: number, seed: number) {
  cx = clamp(cx, r, w - r); cy = clamp(cy, r, d - r); cz = clamp(cz, rz, h - rz);
  const g = new THREE.DodecahedronGeometry(1, 0);
  g.rotateX(seed * 0.7); g.rotateZ(seed * 1.3); g.rotateY(seed * 0.4);
  // vertices stay on the unit sphere whatever the rotation: the box bound holds
  g.scale(r, r, rz);
  g.translate(cx, cy, cz);
  p.facets(g, 20);
}

function pot(p: Parts, cx: number, cy: number, z0: number, potH: number, rTop: number, rBot: number) {
  const rimH = clamp(potH * 0.11, 1, 3);
  p.rev(cx, cy, z0, z0 + potH - rimH, rBot, rTop);
  p.rev(cx, cy, z0 + potH - rimH, z0 + potH, rTop + 0.7, rTop + 0.7);
}

/** Potted plant: truncated-cone pot (~40 % of the height) with a rim, five foliage clumps. */
function classicPlant(p: Parts, w: number, d: number, h: number) {
  const W = Math.min(w, d);
  const potH = h * 0.4;
  pot(p, w / 2, d / 2, 0, potH, W * 0.3, W * 0.3 * 0.74);
  const z0 = potH * 0.86, Hf = h - z0;
  const k = clamp(Hf / W, 1, 1.45);
  const R0 = Math.min(W / 2, Hf / (2 * k));
  const blobs: [number, number, number, number, number][] = [
    [0.0, 0.08, 0.62, 0.74, 0.3],
    [-0.42, -0.12, 0.38, 0.54, 1.7],
    [0.44, 0.1, 0.42, 0.52, 2.9],
    [0.08, -0.42, 0.3, 0.48, 4.1],
    [-0.08, 0.4, 0.34, 0.46, 5.3],
  ];
  for (const [dx, dy, dz, rr, seed] of blobs) {
    const r = R0 * rr, rz = r * k;
    clump(p, w, d, h, w / 2 + dx * W / 2, d / 2 + dy * W / 2, Math.max(z0 + dz * Hf, z0 + rz * 0.6), r, rz, seed);
  }
}

/**
 * Bushy plant: low wide pot, a dense dome of 13 overlapping clumps (crown,
 * inner ring, outer ring spilling over the pot) — wider than tall-ish.
 */
function bushyPlant(p: Parts, w: number, d: number, h: number) {
  const W = Math.min(w, d);
  const potH = h * 0.3;
  const rTop = W * 0.24;
  pot(p, w / 2, d / 2, 0, potH, rTop, rTop * 0.78);
  const z0 = potH * 0.78, Hf = h - z0;
  const k = clamp(Hf / W, 0.72, 1.05);
  const R = W / 2;
  const rnd = rng(W + h);
  const list: [number, number, number, number][] = []; // ρ, angle, zfrac, size
  list.push([0, 0, 0.66, 0.4]);
  for (let i = 0; i < 5; i++) list.push([0.36, (i / 5) * Math.PI * 2 + 0.3, 0.5, 0.36]);
  for (let i = 0; i < 7; i++) list.push([0.66, (i / 7) * Math.PI * 2 + 0.75, 0.22, 0.3]);
  list.forEach(([rho, a, zf, sz], i) => {
    const r = R * sz * (0.9 + rnd() * 0.22), rz = r * k;
    const rr = rho * (0.92 + rnd() * 0.12);
    const cx = w / 2 + Math.cos(a) * rr * R, cy = d / 2 + Math.sin(a) * rr * R;
    clump(p, w, d, h, cx, cy, z0 + zf * Hf + rz * 0.35, r, rz, 0.4 + i * 1.37);
  });
}

/**
 * Heart-shaped leaf (pothos), ~1.45·sz tall, folded along its midrib so the
 * crease draws: outline + midrib, thin closed solid. Local XZ plane, facing
 * −Y, tip pointing down (−Z), stem notch on top.
 */
function heartLeaf(sz: number): THREE.BufferGeometry {
  const o: P2[] = [[0, -1], [0.55, -0.28], [0.5, 0.3], [0.24, 0.45], [0, 0.32], [-0.24, 0.45], [-0.5, 0.3], [-0.55, -0.28]]; // (x, z)
  const fold = 0.32, th = 0.07;
  const F = (q: P2, back = 0): P3 => [q[0] * sz, (Math.abs(q[0]) * fold + back) * sz, q[1] * sz];
  const pos: number[] = [];
  const tri = (a: P3, b: P3, c: P3) => pos.push(...a, ...b, ...c);
  const tip = o[0], notch = o[4];
  // front (−Y) faces: fan from the midrib on each half; back faces mirrored
  const halves = [[3, 2, 1], [5, 6, 7]]; // each half from the notch round to the tip
  for (const back of [0, th]) {
    for (const hf of halves) {
      const ring = [notch, ...hf.map(i => o[i]), tip];
      const right = hf[0] === 3;
      for (let i = 1; i < ring.length - 1; i++) {
        const a = F(notch, back), b = F(ring[i], back), c = F(ring[i + 1], back);
        // front faces wind so their normal points to −Y
        if ((back === 0) === right) tri(a, c, b); else tri(a, b, c);
      }
    }
  }
  // rim (thickness)
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    const a0 = F(a), b0 = F(b), a1 = F(a, th), b1 = F(b, th);
    tri(a0, b1, b0); tri(a0, a1, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/**
 * Trailing plant (pothos-like) for a shelf: small pot standing at the back
 * with its base at z = hang, a low mound of leaves, stems falling over the
 * FRONT rim down to the bottom of the box (inside the front strip hd deep)
 * and short ones draping over the sides. Leaves = small flat octahedra
 * (diamond outline + midrib).
 */
function trailingPlant(p: Parts, w: number, d: number, h: number, hang: number, hd: number) {
  const potR = (d - hd - 1) / 2;
  const cx = w / 2, cy = hd + 0.5 + potR;
  const potH = Math.min(potR * 1.7, h - hang - 6);
  const zRim = hang + potH;
  pot(p, cx, cy, hang, potH, potR - 0.7, (potR - 0.7) * 0.78);
  const rnd = rng(w * 3 + h);
  const leafK = clamp(potR / 8.5, 0.8, 1.15);
  // mound: clumps spilling over the rim, a crown on top
  const mz = h - zRim;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = potR * (0.55 + rnd() * 0.1), rz = Math.min(r * 0.75, mz * 0.5);
    clump(p, w, d, h, cx + Math.cos(a) * potR * 0.68, cy + Math.sin(a) * potR * 0.6, zRim + rz * 0.75, r, rz, 1.1 + i * 2.3);
  }
  clump(p, w, d, h, cx, cy + potR * 0.1, h - mz * 0.48, potR * 0.62, mz * 0.48, 7.7);

  /** Leaf: heart-shaped, in the XZ plane facing the front, tip down; `tilt` about Y, `yaw` about Z; kept inside the box. */
  const leaf = (x: number, y: number, z: number, sz: number, tilt: number, yaw: number) => {
    const g = heartLeaf(sz);
    g.rotateY(tilt);
    g.rotateZ(yaw);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    g.translate(clamp(x, -b.min.x, w - b.max.x), clamp(y, -b.min.y, d - b.max.y), clamp(z, -b.min.z, h - b.max.z));
    p.facets(g, 25);
  };
  const stem = (pts: P3[]) => pushPolyline(p.inner, pts);

  // front stems: over the rim, then hanging in the front strip
  const front: [number, number][] = [[-0.55, 0.02], [0.08, 0.0], [0.62, 0.28]]; // x offset (× potR), tip height (× hang)
  const fy0 = hd + 0.5, yHang = hd * 0.55;
  front.forEach(([dx, tip], j) => {
    const x0 = cx + dx * potR;
    const pts: P3[] = [[x0, fy0 + 2, zRim + 1.5], [x0, fy0 - 0.5, zRim + 0.6], [x0, yHang, zRim - 2.5]];
    const zTip = Math.max(1.2, tip * hang + 1.2);
    const n = Math.max(3, Math.round((zRim - 2.5 - zTip) / (6.6 * leafK)));
    for (let i = 1; i <= n; i++) {
      const z = zRim - 2.5 - ((zRim - 2.5 - zTip) * i) / n;
      pts.push([x0 + Math.sin(i * 0.9 + j * 2) * 1.6, yHang + Math.sin(i * 1.3 + j) * 0.25, z]);
    }
    stem(pts);
    for (let i = 2; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      const side = i % 2 ? 1 : -1;
      const sz = (3.4 + 0.7 * Math.sin(i * 1.7 + j)) * leafK * (i === pts.length - 1 ? 0.75 : 1);
      leaf(x + side * sz * 0.62, y - 0.2, z - sz * 0.3, sz, side * 0.75, side * 0.2);
    }
  });
  // side stems: drape over the left / right rims down to about the pot base
  for (const sx of [-1, 1]) {
    const x0 = cx + sx * potR * 0.9;
    const pts: P3[] = [[x0, cy, zRim + 1], [x0 + sx * 2.5, cy - 1, zRim - 1]];
    const xOut = cx + sx * (w / 2 - 2.4);
    const n = 4;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push([x0 + (xOut - x0) * Math.min(1, t * 1.5), cy - 1 - t * 2, zRim - 1 - (zRim - hang - 2.5) * t]);
    }
    stem(pts);
    for (let i = 1; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      leaf(x + sx * 0.4, y - 0.8, z - 0.4, 3 * leafK, 0.45 + i * 0.1, sx * (Math.PI / 2 - 0.35));
    }
  }
}
