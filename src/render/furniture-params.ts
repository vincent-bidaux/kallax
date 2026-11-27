// Geometry of the parametric objects (core/objects-params.ts): TV, custom
// table, wall frames. Local space [0,w] × [0,d] × [0,h], FRONT at y = 0
// (wall-hung items have their back at y = d).
// Faces carry two material groups for the generic colour rendering:
//   group 0 = main part (TV body, table top, frame profile)  → ObjectColor.hex
//   group 1 = secondary part (screen, legs, mat / picture)    → ObjectColor.hex2
// Edges: silhouettes in `outer`, details (screen outline, reflections,
// mouldings, mat, picture sketch, bracket) in `inner`; round parts return
// frusta for view-dependent silhouettes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ObjOpts, Size3 } from '../core/types';
import {
  FRAME_PROFILE, TABLE_LEG_INSET, TV_STAND_LIFT, frameStyle, tableLeg, tableStyle, tableTop, tvDims, tvInch, tvStand,
} from '../core/objects-params';
import {
  boxGeo, frustumZ, lineGeo, pushBox, pushCircle, pushRect, pushSeg,
  type BoxSpec, type Frustum, type ItemGeometry,
} from './item-geometry';
import { loftRings, pushPolyline, rodGeo, roundRectPts, type Ring } from './furniture-objects';

const UP = new THREE.Vector3(0, 0, 1);
type Part = 0 | 1;
type P3 = [number, number, number];

class PParts {
  private faces: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
  outer: number[] = [];
  inner: number[] = [];
  frusta: Frustum[] = [];
  /** Box faces (+ its 12 edges unless lines = 'none'). */
  box(b: BoxSpec, part: Part = 0, lines: 'outer' | 'inner' | 'none' = 'outer') {
    this.faces[part].push(boxGeo(...b));
    if (lines !== 'none') pushBox(lines === 'outer' ? this.outer : this.inner, ...b);
  }
  face(g: THREE.BufferGeometry, part: Part = 0) { this.faces[part].push(g); }
  /** Vertical cylinder / frustum. */
  cyl(cx: number, cy: number, z0: number, z1: number, r0: number, r1 = r0, part: Part = 1, circles = true) {
    this.faces[part].push(frustumZ(cx, cy, z0, z1, r0, r1, 40));
    const a = new THREE.Vector3(cx, cy, z0), b = new THREE.Vector3(cx, cy, z1);
    if (circles) { pushCircle(this.outer, a, UP, r0, 40); pushCircle(this.outer, b, UP, r1, 40); }
    this.frusta.push({ a, b, ra: r0, rb: r1 });
  }
  /** Rod between two points (round section), silhouette only. */
  rod(a: P3, b: P3, r: number, part: Part = 1) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    this.faces[part].push(rodGeo(va, vb, r, r, 12));
    this.frusta.push({ a: va, b: vb, ra: r, rb: r });
  }
  done(key: string, size: Size3): ItemGeometry {
    const strip = (p: THREE.BufferGeometry) => {
      const g = p.index ? p.toNonIndexed() : p;
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      g.clearGroups();
      return g;
    };
    const main = this.faces[0].map(strip), sec = this.faces[1].map(strip);
    const count = (l: THREE.BufferGeometry[]) => l.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const face = mergeGeometries([...main, ...sec]) ?? boxGeo(0, 0, 0, size.w, size.d, size.h);
    face.clearGroups();
    const n0 = count(main), n1 = count(sec);
    if (n0) face.addGroup(0, n0, 0);
    if (n1) face.addGroup(n0, n1, 1);
    face.computeBoundingBox();
    face.computeBoundingSphere();
    return {
      key, size, face, outer: lineGeo(this.outer), inner: this.inner.length ? lineGeo(this.inner) : null, basket: null,
      all: lineGeo([...this.outer, ...this.inner], true), frusta: this.frusta.length ? this.frusta : undefined, refs: 0,
    };
  }
}

/** Horizontal rounded slab (plate) with its top and bottom outlines. */
function roundSlab(p: PParts, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, r: number, part: Part = 0) {
  const pts = roundRectPts(x0, y0, x1, y1, r, 5);
  const rings: Ring[] = [{ pts, z: z0 }, { pts, z: z1 }];
  p.face(loftRings(rings), part);
  for (const z of [z0, z1]) pushPolyline(p.outer, pts.map(q => [q[0], q[1], z] as P3), true);
}

// ── TV ───────────────────────────────────────────────────────
/**
 * Flat TV: 2.5 cm panel slab with a rear electronics bulge, recessed screen
 * (group 1) framed by the bezels, a small logo mark on the bottom bezel and
 * two reflection strokes. Stand: rounded base plate + central neck, panel
 * bottom TV_STAND_LIFT above the surface. Wall: the box includes the 5 cm
 * gap to the wall (y = d), where a flat bracket (wall plate + 2 arms) sits.
 */
export function buildTv(key: string, s: Size3, variant: string | undefined, opts: ObjOpts | undefined): ItemGeometry {
  const inch = tvInch({ opts }), stand = tvStand({ variant });
  const t = tvDims(inch);
  const W = t.pw, D = Math.max(s.d, t.pd), H = s.h;
  const p = new PParts();
  const y0 = stand ? D / 2 - (t.slab + t.pd) / 2 : 0;
  const z0 = stand ? TV_STAND_LIFT : 0;
  const zt = z0 + t.ph;
  const rec = 0.12; // screen recess behind the bezel front
  const sx0 = t.bezel, sx1 = W - t.bezel, sz0 = z0 + t.chin, sz1 = zt - t.bezel;
  // bezel ring (front skin) + slab behind it
  p.box([0, y0, z0, W, y0 + rec, sz0], 0, 'none');
  p.box([0, y0, sz1, W, y0 + rec, zt], 0, 'none');
  p.box([0, y0, sz0, sx0, y0 + rec, sz1], 0, 'none');
  p.box([sx1, y0, sz0, W, y0 + rec, sz1], 0, 'none');
  p.box([0, y0 + rec, z0, W, y0 + t.slab, zt], 0, 'none');
  pushBox(p.outer, 0, y0, z0, W, y0 + t.slab, zt);
  // screen (glass) face, slightly recessed
  p.box([sx0, y0 + rec * 0.6, sz0, sx1, y0 + rec, sz1], 1, 'none');
  pushRect(p.inner, sx0, sz0, sx1, sz1, y0 - 0.01);
  // reflection: two short parallel diagonal strokes, upper left of the screen
  const k = Math.min(t.sw, t.sh), ry = y0 + rec * 0.6 - 0.02;
  const rx = sx0 + t.sw * 0.08, rz = sz1 - t.sh * 0.34;
  pushSeg(p.inner, rx, ry, rz, rx + k * 0.2, ry, rz + k * 0.2);
  pushSeg(p.inner, rx + k * 0.1, ry, rz - k * 0.04, rx + k * 0.26, ry, rz + k * 0.12);
  // logo mark on the bottom bezel
  const cx = W / 2, lz = z0 + t.chin / 2;
  pushRect(p.inner, cx - 1.6, lz - 0.12, cx + 1.6, lz + 0.12, y0 - 0.02);
  // rear electronics bulge
  const bx0 = W * 0.16, bx1 = W * 0.84, bz0 = z0 + t.ph * 0.1, bz1 = z0 + t.ph * 0.62;
  p.box([bx0, y0 + t.slab, bz0, bx1, y0 + t.pd, bz1], 0, 'outer');
  if (stand) {
    // central pedestal: rounded base plate + neck rising into the bulge
    const bw = t.baseW, bd = t.baseD, cy = D / 2;
    roundSlab(p, cx - bw / 2, cy - bd / 2, cx + bw / 2, cy + bd / 2, 0, 1.2, Math.min(4, bd / 3), 0);
    const nw = Math.min(8, bw * 0.3);
    p.box([cx - nw / 2, y0 + t.slab, 1.2, cx + nw / 2, y0 + t.pd - 0.4, bz0], 0, 'outer');
    // small foot block where the neck meets the plate
    p.box([cx - nw / 2 - 1, y0 + t.slab - 1, 1.2, cx + nw / 2 + 1, y0 + t.pd + 0.6, 2.2], 0, 'inner');
  } else {
    // flat wall bracket in the gap: wall plate + 2 vertical arms on the TV back
    const bw = Math.min(60, W * 0.4), bh = Math.min(40, t.ph * 0.4), zc = t.ph * 0.36;
    p.box([cx - bw / 2, D - 0.8, zc - bh / 2, cx + bw / 2, D, zc + bh / 2], 0, 'inner');
    for (const ax of [cx - bw * 0.36, cx + bw * 0.36]) {
      p.box([ax - 1.5, t.pd, zc - bh * 0.62, ax + 1.5, D - 0.8, zc + bh * 0.62], 0, 'inner');
    }
    // cross bar
    p.box([cx - bw * 0.36, t.pd + 1, zc - 1.2, cx + bw * 0.36, D - 0.8, zc + 1.2], 0, 'inner');
  }
  return p.done(key, { w: W, d: D, h: H });
}

// ── table ────────────────────────────────────────────────────
/**
 * Custom table: top (rectangular box or round disc) + leg style:
 * square / round / tapered corner legs (inset 3 cm; square + tapered get a
 * 7 cm apron), two rectangular trestle frames, a central pedestal (round
 * base, column, spider plate) or metal hairpin legs (2 rods + mounting plate).
 */
export function buildTable(key: string, s: Size3, variant: string | undefined, opts: ObjOpts | undefined): ItemGeometry {
  const w = Math.max(s.w, 20), d = Math.max(s.d, 20), h = Math.max(s.h, 10);
  const st = { variant, opts, size: s };
  const style = tableStyle(st), T = tableTop(st), L = tableLeg(st);
  const round = !!opts?.round;
  const zt = h - T;
  const p = new PParts();
  const cx = w / 2, cy = d / 2, R = Math.min(w, d) / 2;
  if (round) p.cyl(cx, cy, zt, h, R, R, 0);
  else p.box([0, 0, zt, w, d, h], 0);

  const i = TABLE_LEG_INSET;
  // corner leg centres: rectangle inset, or on the circle's diagonals for a round top
  const corners = (side: number): [number, number][] => {
    if (round) {
      const a = (R - i - side / 2) * Math.SQRT1_2 * 0.92;
      return [[cx - a, cy - a], [cx + a, cy - a], [cx + a, cy + a], [cx - a, cy + a]];
    }
    const o = i + side / 2;
    return [[o, o], [w - o, o], [w - o, d - o], [o, d - o]];
  };
  const apron = (side: number) => {
    const ah = Math.min(7, zt * 0.15), at = 2, back = 1;
    const c = corners(side);
    const xa = c[0][0] + side / 2, xb = c[1][0] - side / 2, ya = c[0][1] + side / 2, yb = c[3][1] - side / 2;
    const fx = c[0][0] - side / 2 + back, fy = c[0][1] - side / 2 + back;
    const gx = c[1][0] + side / 2 - back, gy = c[3][1] + side / 2 - back;
    if (xb - xa > 2) {
      p.box([xa, fy, zt - ah, xb, fy + at, zt], 1, 'inner');
      p.box([xa, gy - at, zt - ah, xb, gy, zt], 1, 'inner');
    }
    if (yb - ya > 2) {
      p.box([fx, ya, zt - ah, fx + at, yb, zt], 1, 'inner');
      p.box([gx - at, ya, zt - ah, gx, yb, zt], 1, 'inner');
    }
  };

  switch (style) {
    case 'square': {
      for (const [x, y] of corners(L)) p.box([x - L / 2, y - L / 2, 0, x + L / 2, y + L / 2, zt], 1);
      if (!round) apron(L);
      break;
    }
    case 'round': {
      for (const [x, y] of corners(L)) p.cyl(x, y, 0, zt, L / 2, L / 2, 1);
      break;
    }
    case 'tapered': {
      // square legs tapering to 55 % at the floor, on the inner faces (outer faces stay plumb)
      const b = L * 0.55;
      corners(L).forEach(([x, y], k) => {
        const sx = k === 0 || k === 3 ? -1 : 1, sy = k < 2 ? -1 : 1;
        // outer corner fixed, inner faces move in
        const ox = x + sx * L / 2, oy = y + sy * L / 2;
        const top: [number, number][] = [[ox, oy], [ox - sx * L, oy], [ox - sx * L, oy - sy * L], [ox, oy - sy * L]];
        const bot: [number, number][] = [[ox, oy], [ox - sx * b, oy], [ox - sx * b, oy - sy * b], [ox, oy - sy * b]];
        // CCW from above
        const ccw = (pts: [number, number][]) => sx * sy > 0 ? pts : [pts[0], pts[3], pts[2], pts[1]];
        const rings: Ring[] = [{ pts: ccw(bot), z: 0 }, { pts: ccw(top), z: zt }];
        p.face(loftRings(rings), 1);
        const bt = ccw(bot), tp = ccw(top);
        pushPolyline(p.outer, bt.map(q => [q[0], q[1], 0] as P3), true);
        pushPolyline(p.outer, tp.map(q => [q[0], q[1], zt] as P3), true);
        for (let n = 0; n < 4; n++) pushSeg(p.outer, bt[n][0], bt[n][1], 0, tp[n][0], tp[n][1], zt);
      });
      if (!round) apron(L);
      break;
    }
    case 'trestle': {
      // two closed rectangular frames (square tube L), set in from the ends
      const half = round ? R * 0.5 : Math.max(w / 2 - Math.max(8, w * 0.1) - L / 2, 4);
      const yHalf = round ? Math.sqrt(R * R - half * half) - 3 : d / 2 - 4;
      for (const xc of [cx - half, cx + half]) {
        const x0 = xc - L / 2, x1 = xc + L / 2, y0 = cy - yHalf, y1 = cy + yHalf;
        const t = L;
        p.box([x0, y0, 0, x1, y0 + t, zt], 1, 'none');
        p.box([x0, y1 - t, 0, x1, y1, zt], 1, 'none');
        p.box([x0, y0 + t, zt - t, x1, y1 - t, zt], 1, 'none');
        p.box([x0, y0 + t, 0, x1, y1 - t, t], 1, 'none');
        for (const x of [x0, x1]) {
          pushRectYZ(p.outer, x, y0, 0, y1, zt);
          pushRectYZ(p.outer, x, y0 + t, t, y1 - t, zt - t);
        }
        for (const [y, z] of [[y0, 0], [y1, 0], [y0, zt], [y1, zt], [y0 + t, t], [y1 - t, t], [y0 + t, zt - t], [y1 - t, zt - t]] as const) {
          pushSeg(p.outer, x0, y, z, x1, y, z);
        }
      }
      break;
    }
    case 'pedestal': {
      const rb = Math.max(18, Math.min(35, R * 0.62)), rc = L / 2;
      p.cyl(cx, cy, 0, 2.5, rb, rb * 0.96, 1);
      p.cyl(cx, cy, 2.5, 4, rb * 0.6, rc * 1.3, 1, false);
      p.cyl(cx, cy, 4, zt - 2, rc, rc, 1, false);
      p.cyl(cx, cy, zt - 2, zt, Math.min(R * 0.4, 18), Math.min(R * 0.4, 18), 1);
      break;
    }
    case 'hairpin': {
      const r = L / 2, spread = 5;
      for (const [x, y] of corners(10)) {
        p.box([x - 5, y - 5, zt - 0.6, x + 5, y + 5, zt], 1, 'inner');
        // V of two rods in the Y–Z plane, joined by a small bend at the floor
        const rb = 0.9, zb = rb + r;
        p.rod([x, y - spread, zt - 0.6], [x, y - rb, zb], r);
        p.rod([x, y + spread, zt - 0.6], [x, y + rb, zb], r);
        const n = 4;
        for (let k = 0; k < n; k++) {
          const a0 = Math.PI + (k / n) * Math.PI, a1 = Math.PI + ((k + 1) / n) * Math.PI;
          p.rod([x, y + rb * Math.cos(a0), zb + rb * Math.sin(a0)], [x, y + rb * Math.cos(a1), zb + rb * Math.sin(a1)], r);
        }
      }
      break;
    }
  }
  return p.done(key, { w, d, h });
}

/** Rectangle in the plane x = const (y, z coords). */
function pushRectYZ(out: number[], x: number, y0: number, z0: number, y1: number, z1: number) {
  pushSeg(out, x, y0, z0, x, y1, z0);
  pushSeg(out, x, y1, z0, x, y1, z1);
  pushSeg(out, x, y1, z1, x, y0, z1);
  pushSeg(out, x, y0, z1, x, y0, z0);
}

// ── frames ───────────────────────────────────────────────────
/** Rectangle `o` cm inside the frame outline (front-plane coords x, z) at depth y. */
const ring = (out: number[], w: number, h: number, o: number, y: number) => pushRect(out, o, o, w - o, h - o, y);

/** Abstract picture sketch in the rectangle (x0, z0, x1, z1) on the plane y: mountains, horizon, sun. */
function sketch(out: number[], x0: number, z0: number, x1: number, z1: number, y: number, classic: boolean) {
  const W = x1 - x0, H = z1 - z0;
  const P = (u: number, v: number): P3 => [x0 + u * W, y, z0 + v * H];
  if (classic) {
    // painted landscape: rolling hills, a cypress, two birds
    const hill = (v0: number, amp: number, ph: number) => {
      const pts: P3[] = [];
      for (let k = 0; k <= 16; k++) { const u = k / 16; pts.push(P(u, v0 + amp * Math.sin(u * Math.PI * 1.6 + ph))); }
      pushPolyline(out, pts);
    };
    hill(0.42, 0.06, 0.3);
    hill(0.26, 0.05, 2.1);
    // cypress: pointed spindle standing on the far hill
    const cu = 0.27, cv = 0.47, ch = 0.3, cw = 0.045;
    const sp: P3[] = [];
    for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI; sp.push(P(cu + cw * Math.sin(a) * (1 - 0.35 * (k / 12)), cv + ch * (1 - Math.cos(a)) / 2)); }
    for (let k = 12; k >= 0; k--) { const a = (k / 12) * Math.PI; sp.push(P(cu - cw * Math.sin(a) * (1 - 0.35 * (k / 12)), cv + ch * (1 - Math.cos(a)) / 2)); }
    pushPolyline(out, sp);
    const bird = (u: number, v: number, k: number) => pushPolyline(out, [P(u - k, v + k * 0.5), P(u, v), P(u + k, v + k * 0.6)]);
    bird(0.5, 0.78, 0.035); bird(0.58, 0.83, 0.025);
  } else {
    pushPolyline(out, [P(0, 0.36), P(0.17, 0.56), P(0.29, 0.46), P(0.48, 0.72), P(0.66, 0.49), P(0.79, 0.58), P(1, 0.4)]);
    pushSeg(out, ...P(0, 0.26), ...P(1, 0.26));
  }
  const sun = P(classic ? 0.78 : 0.78, classic ? 0.7 : 0.82);
  pushCircle(out, new THREE.Vector3(sun[0], sun[1], sun[2]), new THREE.Vector3(0, 1, 0), Math.min(W, H) * (classic ? 0.075 : 0.06), 24);
}

/** Four boxes of a frame band between offsets a and b (front plane), from depth y0 to y1. */
function band(p: PParts, w: number, h: number, a: number, b: number, y0: number, y1: number, part: Part = 0) {
  p.box([a, y0, a, w - a, y1, b], part, 'none');
  p.box([a, y0, h - b, w - a, y1, h - a], part, 'none');
  p.box([a, y0, b, b, y1, h - b], part, 'none');
  p.box([w - b, y0, b, w - a, y1, h - b], part, 'none');
}

/**
 * Wall frame, front at y = 0, back against the wall at y = d.
 * Simple: flat 2 cm profile, mitred corners, a mat (passe-partout) with a
 * bevelled window behind the glass and the picture in it. Classic: 6 cm
 * moulded profile in 4 stepped bands (bead / cove / bead / sight edge) drawn
 * as nested outlines, mitres across the profile, a painted landscape.
 */
export function buildFrame(key: string, s: Size3, variant: string | undefined): ItemGeometry {
  const style = frameStyle({ variant });
  const { p: P, d: D0 } = FRAME_PROFILE[style];
  const w = Math.max(s.w, 2 * P + 4), h = Math.max(s.h, 2 * P + 4), d = Math.max(s.d, D0);
  const p = new PParts();
  // back outline + outer depth edges
  ring(p.outer, w, h, 0, d);
  for (const [x, z] of [[0, 0], [w, 0], [w, h], [0, h]] as const) pushSeg(p.outer, x, 0, z, x, d, z);
  const mitres = (o0: number, o1: number, y: number) => {
    pushSeg(p.inner, o0, y, o0, o1, y, o1);
    pushSeg(p.inner, w - o0, y, o0, w - o1, y, o1);
    pushSeg(p.inner, w - o0, y, h - o0, w - o1, y, h - o1);
    pushSeg(p.inner, o0, y, h - o0, o1, y, h - o1);
  };
  if (style === 'simple') {
    band(p, w, h, 0, P, 0, d);
    ring(p.outer, w, h, 0, 0);
    ring(p.outer, w, h, P, 0);
    mitres(0, P, -0.01);
    // mat behind the glass
    const ym = 1.2;
    for (const [x, z] of [[P, P], [w - P, P], [w - P, h - P], [P, h - P]] as const) pushSeg(p.inner, x, 0, z, x, ym, z);
    p.box([P, ym, P, w - P, d, h - P], 1, 'none');
    const ow = w - 2 * P, oh = h - 2 * P;
    const m = Math.max(1.5, Math.min(ow, oh) * 0.14);
    const ix0 = P + m, iz0 = P + m * 1.08, ix1 = w - P - m, iz1 = h - P - m * 0.92;
    pushRect(p.inner, ix0, iz0, ix1, iz1, ym - 0.01);
    pushRect(p.inner, ix0 + 0.5, iz0 + 0.5, ix1 - 0.5, iz1 - 0.5, ym - 0.01);
    sketch(p.inner, ix0 + 0.5, iz0 + 0.5, ix1 - 0.5, iz1 - 0.5, ym - 0.02, false);
  } else {
    // stepped bands: [offset a, offset b, front depth]
    const bands: [number, number, number][] = [[0, 1.5, 0], [1.5, 4, 0.9], [4, 5, 0.3], [5, P, 1.4]];
    for (const [a, b, yf] of bands) {
      band(p, w, h, a, b, yf, d);
      ring(p.outer, w, h, a, yf);
      ring(p.outer, w, h, b, yf);
    }
    // mould crests / cove line (ornate look)
    ring(p.inner, w, h, 0.75, -0.01);
    ring(p.inner, w, h, 2.75, 0.89);
    ring(p.inner, w, h, 4.5, 0.29);
    mitres(0, P, -0.02);
    // the painting, recessed
    const yp = 2.2;
    for (const [x, z] of [[P, P], [w - P, P], [w - P, h - P], [P, h - P]] as const) pushSeg(p.inner, x, 1.4, z, x, yp, z);
    p.box([P, yp, P, w - P, d, h - P], 1, 'none');
    const ins = Math.min(w, h) * 0.04;
    sketch(p.inner, P + ins, P + ins, w - P - ins, h - P - ins, yp - 0.02, true);
  }
  return p.done(key, { w, d, h });
}

