// Desk / table geometry (IKEA-like models, see core/objects-desks.ts).
// OWNED BY THE FURNITURE AGENT.
//
// Local space: [0,w] × [0,d] × [0,h], the user's side (front) at y = 0.
// Faces carry two material groups for the generic colour rendering:
//   group 0 = main part (table top, drawer fronts)   → ObjectColor.hex
//   group 1 = secondary part (legs, frame, caisson)   → ObjectColor.hex2
// (a single material ignores the groups). Edges: silhouette pieces in
// `outer`, details (drawer fronts, grips, apron seams…) in `inner`;
// round legs / tops return frusta for view-dependent silhouettes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Size3 } from '../core/types';
import { variantOf } from '../core/objects';
import {
  boxGeo, frustumZ, lineGeo, pushBox, pushCircle, pushRect, pushSeg,
  type BoxSpec, type Frustum, type ItemGeometry,
} from './item-geometry';

const UP = new THREE.Vector3(0, 0, 1);
type Part = 0 | 1;

class DeskParts {
  private faces: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
  outer: number[] = [];
  inner: number[] = [];
  frusta: Frustum[] = [];
  box(b: BoxSpec, part: Part = 0, lines: 'outer' | 'inner' = 'outer') {
    this.faces[part].push(boxGeo(...b));
    pushBox(lines === 'outer' ? this.outer : this.inner, ...b);
  }
  /** Vertical cylinder / frustum (round leg, round top). */
  cyl(cx: number, cy: number, z0: number, z1: number, r0: number, r1 = r0, part: Part = 1) {
    this.faces[part].push(frustumZ(cx, cy, z0, z1, r0, r1, 32));
    const a = new THREE.Vector3(cx, cy, z0), b = new THREE.Vector3(cx, cy, z1);
    pushCircle(this.outer, a, UP, r0, 32);
    pushCircle(this.outer, b, UP, r1, 32);
    this.frusta.push({ a, b, ra: r0, rb: r1 });
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

export function buildDesk(key: string, s: Size3, variant?: string): ItemGeometry {
  const w = Math.max(s.w, 20), d = Math.max(s.d, 20), h = Math.max(s.h, 10);
  const p = new DeskParts();
  switch (variantOf('desk', variant)?.id) {
    case 'alex': alexDesk(p, w, d, h); break;
    case 'micke': mickeDesk(p, w, d, h); break;
    case 'bekant': bekantDesk(p, w, d, h); break;
    case 'idasen': idasenDesk(p, w, d, h); break;
    case 'dining': diningTable(p, w, d, h); break;
    case 'round': roundTable(p, w, d, h); break;
    case 'coffee': coffeeTable(p, w, d, h); break;
    default: simpleDesk(p, w, d, h);
  }
  return p.done(key, { w, d, h });
}

/** Table top + 4 round legs (Ø 3.6) set 5 cm in from the corners. */
function simpleDesk(p: DeskParts, w: number, d: number, h: number) {
  const t = 3;
  p.box([0, 0, h - t, w, d, h]);
  for (const x of [5, w - 5]) for (const y of [5, d - 5]) p.cyl(x, y, 0, h - t, 1.8);
}

/** Drawer-unit fronts on the face y = y0 between x0..x1 and z0..z1 (n fronts, finger grip slot near the top). */
function drawerFronts(p: DeskParts, x0: number, x1: number, z0: number, z1: number, y0: number, n: number) {
  const g = 0.3, hh = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const a = z0 + i * hh + g / 2, b = z0 + (i + 1) * hh - g / 2;
    pushRect(p.inner, x0 + g, a, x1 - g, b, y0 - 0.02);
    const cx = (x0 + x1) / 2, sz = b - Math.min(2.6, hh * 0.22);
    pushRect(p.inner, cx - 4.5, sz - 0.6, cx + 4.5, sz + 0.6, y0 - 0.03);
  }
}

/** LAGKAPTEN / ALEX: top, ALEX 5-drawer unit (36 × 58) under the left end, 2 legs on the right. */
function alexDesk(p: DeskParts, w: number, d: number, h: number) {
  const t = 3;
  p.box([0, 0, h - t, w, d, h]);
  const ux0 = 1, ux1 = Math.min(37, w * 0.4), uy0 = Math.max(0.5, (d - 58) / 2), uy1 = d - uy0;
  const plinth = 2.5;
  p.box([ux0, uy0, 0, ux1, uy1, h - t], 1);
  pushSeg(p.inner, ux0, uy0 - 0.02, plinth, ux1, uy0 - 0.02, plinth);
  drawerFronts(p, ux0, ux1, plinth, h - t - 0.6, uy0, 5);
  for (const y of [5, d - 5]) p.cyl(w - 5, y, 0, h - t, 1.8);
}

/** MICKE: top, side panel (left), drawer column (right: drawer + open shelf), back panel. */
function mickeDesk(p: DeskParts, w: number, d: number, h: number) {
  const t = 2.5, pt = 1.8;
  const zt = h - t;
  p.box([0, 0, zt, w, d, h]);
  p.box([0, 0, 0, pt, d, zt], 1);                       // left side panel
  const cw = Math.min(36, w * 0.34);
  const xi = w - cw;
  p.box([w - pt, 0, 0, w, d, zt], 1);                   // right side panel
  p.box([xi, 0, 0, xi + pt, d, zt], 1);                 // column inner panel
  p.box([xi + pt, 1.5, 0, w - pt, d, 6], 1, 'inner');   // plinth
  p.box([xi + pt, 1.5, 30, w - pt, d - 1, 30 + pt], 1, 'inner'); // shelf
  const dz0 = zt - 15;
  p.box([xi + pt + 0.25, 0, dz0, w - pt - 0.25, d - 2, zt - 0.4], 0, 'inner'); // drawer
  const gx = (xi + w) / 2;
  pushRect(p.inner, gx - 5, zt - 3.2, gx + 5, zt - 2, -0.03);                  // grip slot
  p.box([pt, d - pt, h * 0.3, xi, d, zt], 1);           // back (modesty) panel
  const cx = (pt + xi) / 2;
  pushRect(p.inner, cx - 4, zt - 6, cx + 4, zt - 3, d - pt - 0.03);            // cable outlet
}

/** BEKANT: top on a T-leg frame (column + long foot at each end, top rails, cross beam). */
function bekantDesk(p: DeskParts, w: number, d: number, h: number) {
  const t = 2.5, zt = h - t;
  p.box([0, 0, zt, w, d, h]);
  for (const xc of [8, w - 8]) {
    p.box([xc - 3, d / 2 - 2.5, 3.5, xc + 3, d / 2 + 2.5, zt - 4], 1);       // column
    p.box([xc - 3, 3, 0, xc + 3, d - 3, 3.5], 1);                            // foot
    p.box([xc - 2.5, 5, zt - 4, xc + 2.5, d - 5, zt], 1);                    // top rail
  }
  p.box([11, d / 2 - 2, zt - 6, w - 11, d / 2 + 2, zt - 1], 1);              // cross beam
}

/** IDÅSEN sit/stand: two telescopic panel columns on long feet, top frame, control panel (front right). */
function idasenDesk(p: DeskParts, w: number, d: number, h: number) {
  const t = 2.4, zt = h - t;
  p.box([0, 0, zt, w, d, h]);
  const zs = Math.min(42, zt * 0.58);
  for (const xc of [9, w - 9]) {
    p.box([xc - 3.6, d / 2 - 5, 3, xc + 3.6, d / 2 + 5, zs], 1);             // lower stage
    p.box([xc - 3.1, d / 2 - 4.5, zs, xc + 3.1, d / 2 + 4.5, zt - 3], 1);    // upper stage
    p.box([xc - 3, 4, 0, xc + 3, d - 4, 3], 1);                              // foot
    p.box([xc - 2.5, 8, zt - 3, xc + 2.5, d - 8, zt], 1);                    // side rail
  }
  p.box([12.6, d / 2 - 2.5, zt - 5, w - 12.6, d / 2 + 2.5, zt], 1);          // centre beam
  p.box([w - 32, 0.6, zt - 1.8, w - 20, 4.5, zt], 1, 'inner');               // control panel
}

/** MELLTORP: top, apron, 4 square steel legs at the corners. */
function diningTable(p: DeskParts, w: number, d: number, h: number) {
  const t = 2.5, zt = h - t, L = 3.5, i = 2.5, ah = 7, at = 1.6;
  p.box([0, 0, zt, w, d, h]);
  for (const x of [i, w - i - L]) for (const y of [i, d - i - L]) p.box([x, y, 0, x + L, y + L, zt], 1);
  p.box([i + L, i, zt - ah, w - i - L, i + at, zt], 1, 'inner');
  p.box([i + L, d - i - at, zt - ah, w - i - L, d - i, zt], 1, 'inner');
  p.box([i, i + L, zt - ah, i + at, d - i - L, zt], 1, 'inner');
  p.box([w - i - at, i + L, zt - ah, w - i, d - i - L, zt], 1, 'inner');
}

/** PINNTORP-like round table: round top, 4 square legs under it, square apron. */
function roundTable(p: DeskParts, w: number, d: number, h: number) {
  const R = Math.min(w, d) / 2, cx = w / 2, cy = d / 2, t = 3, zt = h - t;
  p.cyl(cx, cy, zt, h, R, R, 0);
  const a = R * 0.46, L = 4.5, ah = 8, at = 2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x = cx + sx * a - L / 2, y = cy + sy * a - L / 2;
    p.box([x, y, 0, x + L, y + L, zt], 1);
  }
  const x0 = cx - a + L / 2, x1 = cx + a - L / 2, y0 = cy - a - L / 2 + 0.5, y1 = cy + a + L / 2 - 0.5;
  p.box([x0, y0, zt - ah, x1, y0 + at, zt], 1, 'inner');
  p.box([x0, y1 - at, zt - ah, x1, y1, zt], 1, 'inner');
  const xa = cx - a - L / 2 + 0.5, xb = cx + a + L / 2 - 0.5, ya = cy - a + L / 2, yb = cy + a - L / 2;
  p.box([xa, ya, zt - ah, xa + at, yb, zt], 1, 'inner');
  p.box([xb - at, ya, zt - ah, xb, yb, zt], 1, 'inner');
}

/** LACK: 5 cm top, 4 square 5 × 5 legs flush at the corners, lower shelf. */
function coffeeTable(p: DeskParts, w: number, d: number, h: number) {
  const t = 5, L = 5, zt = h - t;
  p.box([0, 0, zt, w, d, h]);
  for (const x of [0, w - L]) for (const y of [0, d - L]) p.box([x, y, 0, x + L, y + L, zt], 1);
  const z0 = Math.min(11, h * 0.25);
  p.box([L, 0.5, z0, w - L, d - 0.5, z0 + 2.5], 0);
}
