// EKET units, drawn as clean vector carcasses: 4 panels + a back panel set
// back from the rear edge (room for the wall rail), then what the version
// has inside / in front (see core/eket.ts):
//   open, four        — open compartments: opening outlines, their depth
//                       edges, the back panel outline; dividers for "four"
//   door, door-shelf,
//   doors-shelf       — handle-less doors inside the carcass, flush with the
//                       front (push-to-open, as IKEA sells them); shelves
//                       behind them (seen in transparency)
//   glass             — clear glass door inside the carcass: pane edge + an
//                       inner line, the window's reflection strokes, two small
//                       pivot hinges; the interior shows through
//   drawers, drawers-70,
//   wall-drawers      — two stacked handle-less drawer fronts, drawer boxes
//                       behind (transparency); the set also draws its wall rail
//                       in the back recess
//   media             — open upper compartment with a round cable outlet in
//                       the back panel, push-to-open flap below a shelf
// Local space: [0,w] × [0,35] × [0,h], front at y = 0.
import * as THREE from 'three';
import type { EketLegId, EketVariant } from '../core/eket';
import { EKET, eketDef } from '../core/eket';
import { boxGeo, frustumZ, lineGeo, mergeFaces, pushBox, pushCircle, pushRect, pushSeg, pushTube, type BoxSpec, type Frustum, type ItemGeometry } from './item-geometry';

type Rect = [number, number, number, number]; // x0, z0, x1, z1 (front plane)

export function buildEket(key: string, variant: EketVariant, legs?: EketLegId): ItemGeometry {
  const def = eketDef(variant);
  const W = def.w, D = EKET.depth, H = def.h;
  const p = EKET.panel, dv = EKET.panel;
  const yb = D - EKET.backInset - EKET.back;   // front face of the back panel
  const boxes: BoxSpec[] = [
    [0, 0, 0, p, D, H],               // left side
    [W - p, 0, 0, W, D, H],           // right side
    [p, 0, 0, W - p, D, p],           // bottom
    [p, 0, H - p, W - p, D, H],       // top
    [p, yb, p, W - p, yb + EKET.back, H - p], // back panel
  ];
  const outer: number[] = [];
  pushTube(outer, 0, 0, W, H, D);
  const inner: number[] = [];
  const x0 = p, x1 = W - p, z0 = p, z1 = H - p;
  const xm = W / 2, zm = H / 2;

  /** An open compartment: outline at the front, depth edges, outline on the back panel. */
  const cell = ([a, b, c, d]: Rect) => {
    pushRect(inner, a, b, c, d, 0);
    for (const [x, z] of [[a, b], [c, b], [c, d], [a, d]] as const) pushSeg(inner, x, 0, z, x, yb, z);
    pushRect(inner, a, b, c, d, yb);
  };
  const g = 0.3;      // reveal around fronts
  const T = 1.6;      // door / drawer front thickness
  /** A front (door, drawer front, flap) inside the opening, flush with the carcass. */
  const front = ([a, b, c, d]: Rect) => {
    boxes.push([a, 0, b, c, T, d]);
    pushRect(inner, a, b, c, d, 0);
    pushRect(inner, a, b, c, d, T);
  };
  /** Horizontal shelf / divider plank at height z (centre), from y0 to the back panel. */
  const shelf = (z: number, a = x0, c = x1, y0 = 0) => {
    const s: BoxSpec = [a, y0, z - dv / 2, c, yb, z + dv / 2];
    boxes.push(s);
    pushRect(inner, a, z - dv / 2, c, z + dv / 2, y0);
    pushSeg(inner, a, y0, z + dv / 2, a, yb, z + dv / 2);
    pushSeg(inner, c, y0, z + dv / 2, c, yb, z + dv / 2);
  };
  const drawerPair = () => {
    const fronts: Rect[] = [[x0 + g, z0 + g, x1 - g, zm - g / 2], [x0 + g, zm + g / 2, x1 - g, z1 - g]];
    // drawer boxes: 26 × 27 cm inside in the cube, 63 × 28 cm in the 70 cm wide unit
    const bw = W > 40 ? 64.4 : 27.4, bd = W > 40 ? 29.4 : 28.4;
    for (const f of fronts) {
      front(f);
      const bx0 = (W - bw) / 2;
      pushBox(inner, bx0, T, f[1] + 0.8, bx0 + bw, Math.min(yb - 0.2, T + bd), f[3] - 2.2);
    }
  };

  switch (variant) {
    case 'open':
      cell([x0, z0, x1, z1]);
      break;
    case 'four': {
      boxes.push([xm - dv / 2, 0, z0, xm + dv / 2, yb, z1]);           // vertical divider
      boxes.push([x0, 0, zm - dv / 2, xm - dv / 2, yb, zm + dv / 2]);  // horizontal, left
      boxes.push([xm + dv / 2, 0, zm - dv / 2, x1, yb, zm + dv / 2]);  // horizontal, right
      for (const r of [[x0, z0, xm - dv / 2, zm - dv / 2], [xm + dv / 2, z0, x1, zm - dv / 2],
        [x0, zm + dv / 2, xm - dv / 2, z1], [xm + dv / 2, zm + dv / 2, x1, z1]] as Rect[]) cell(r);
      break;
    }
    case 'door':
      cell([x0, z0, x1, z1]);
      front([x0 + g, z0 + g, x1 - g, z1 - g]);
      break;
    case 'door-shelf':
      cell([x0, z0, x1, z1]);
      shelf(zm, x0, x1, T + 0.4);
      front([x0 + g, z0 + g, x1 - g, z1 - g]);
      break;
    case 'doors-shelf':
      cell([x0, z0, x1, z1]);
      shelf(zm, x0, x1, T + 0.4);
      front([x0 + g, z0 + g, xm - g / 2, z1 - g]);
      front([xm + g / 2, z0 + g, x1 - g, z1 - g]);
      break;
    case 'drawers':
    case 'drawers-70':
      cell([x0, z0, x1, z1]);
      drawerPair();
      break;
    case 'wall-drawers': {
      cell([x0, z0, x1, z1]);
      drawerPair();
      // EKET suspension rail (70 cm) in the back recess, near the top
      const rail: BoxSpec = [x0 + 1, yb + EKET.back, z1 - 7, x1 - 1, D - 0.1, z1 - 2];
      pushBox(inner, ...rail);
      break;
    }
    case 'media': {
      // flap (push-to-open) under a shelf, open compartment above with a cable outlet
      const zf = z0 + 10.5;
      cell([x0, zf + dv / 2, x1, z1]);
      shelf(zf);
      front([x0 + g, z0 + g, x1 - g, zf - dv / 2 - g]);
      pushCircle(inner, new THREE.Vector3(xm, yb - 0.01, (zf + z1) / 2 + 3), new THREE.Vector3(0, 1, 0), 3, 32);
      break;
    }
    case 'glass': {
      cell([x0, z0, x1, z1]);
      // tempered glass 31 × 31 cm, inside the 32 cm opening
      const gi = Math.max(0.3, (x1 - x0 - 31) / 2);
      const gx0 = x0 + gi, gx1 = x1 - gi, gz0 = z0 + gi, gz1 = z1 - gi;
      const gy0 = 0.2, gy1 = 0.6;
      pushRect(inner, gx0, gz0, gx1, gz1, gy0);
      pushRect(inner, gx0 + 0.9, gz0 + 0.9, gx1 - 0.9, gz1 - 0.9, gy0);
      for (const [x, z] of [[gx0, gz0], [gx1, gz0], [gx1, gz1], [gx0, gz1]] as const) pushSeg(inner, x, gy0, z, x, gy1, z);
      // reflection strokes (same language as the window)
      const k = gx1 - gx0, cx = gx0 + k * 0.3, cz = gz0 + k * 0.6;
      pushSeg(inner, cx, gy0, cz, cx + k * 0.18, gy0, cz + k * 0.18);
      pushSeg(inner, cx + k * 0.08, gy0, cz - k * 0.06, cx + k * 0.3, gy0, cz + k * 0.16);
      // pivot hinges, top and bottom on the left (hinge) side
      for (const [hz0, hz1] of [[z0, z0 + 0.9], [z1 - 0.9, z1]] as const) {
        const hb: BoxSpec = [gx0 - 0.2, 0.1, hz0, gx0 + 2.4, 1.3, hz1];
        boxes.push(hb);
        pushBox(inner, ...hb);
      }
      break;
    }
  }

  let face = mergeFaces(boxes.map(b => boxGeo(...b)));
  if (!legs) {
    return {
      key, size: { w: W, d: D, h: H }, face,
      outer: lineGeo(outer), inner: lineGeo(inner), basket: null,
      all: lineGeo([...outer, ...inner], true), refs: 0,
    };
  }
  // ── legs: the carcass moves up by EKET.legs, 4 legs under its corners ──
  const L = EKET.legs;
  face.translate(0, 0, L);
  for (const arr of [outer, inner]) for (let i = 2; i < arr.length; i += 3) arr[i] += L;
  const lg = eketLegs(W, D, L, legs);
  const frameCount = face.getAttribute('position').count;
  face = mergeFaces([face, ...lg.faces]);
  face.addGroup(0, frameCount, 0);
  face.addGroup(frameCount, face.getAttribute('position').count - frameCount, 1);
  return {
    key, size: { w: W, d: D, h: H + L }, face,
    outer: lineGeo(outer), inner: lineGeo(inner), basket: lineGeo(lg.edges), frusta: lg.frusta,
    all: lineGeo([...outer, ...inner, ...lg.edges], true), refs: 0,
  };
}

/**
 * EKET legs (10 cm, 4 per unit), each under a corner with its triangular
 * mounting plate: birch "bois" (slightly tapered round leg), "argent"
 * (straight steel tube + plastic foot), "noir" (three thin rods from the
 * plate's corners converging to a round foot). Faces + edges + frusta (for
 * the view-dependent silhouettes of the round parts).
 */
function eketLegs(W: number, D: number, L: number, type: EketLegId) {
  const faces: THREE.BufferGeometry[] = [];
  const edges: number[] = [];
  const frusta: Frustum[] = [];
  const up = new THREE.Vector3(0, 0, 1);
  const PT = 0.4;              // plate thickness
  const zp = L - PT;           // plate underside
  const round = (cx: number, cy: number, z0: number, z1: number, r0: number, r1: number) => {
    faces.push(frustumZ(cx, cy, z0, z1, r0, r1, 32));
    const a = new THREE.Vector3(cx, cy, z0), b = new THREE.Vector3(cx, cy, z1);
    frusta.push({ a, b, ra: r0, rb: r1 });
    pushCircle(edges, a, up, r0, 32);
    pushCircle(edges, b, up, r1, 32);
  };
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 12, 1, false);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    faces.push(g);
    frusta.push({ a: a.clone(), b: b.clone(), ra: r, rb: r });
  };
  for (const [ox, sx] of [[0, 1], [W, -1]] as const) for (const [oy, sy] of [[0, 1], [D, -1]] as const) {
    const P = (u: number, v: number) => [ox + sx * u, oy + sy * v] as const;
    // triangular mounting plate in the corner
    const tri = sx * sy > 0 ? [P(0.8, 0.8), P(10, 0.8), P(0.8, 10)] : [P(0.8, 0.8), P(0.8, 10), P(10, 0.8)];
    const shape = new THREE.Shape();
    shape.moveTo(...tri[0]); shape.lineTo(...tri[1]); shape.lineTo(...tri[2]); shape.closePath();
    const plate = new THREE.ExtrudeGeometry(shape, { depth: PT, bevelEnabled: false, steps: 1, curveSegments: 1 });
    plate.translate(0, 0, zp);
    faces.push(plate);
    for (let i = 0; i < 3; i++) {
      const p0 = tri[i], p1 = tri[(i + 1) % 3];
      pushSeg(edges, p0[0], p0[1], zp, p1[0], p1[1], zp);
      pushSeg(edges, p0[0], p0[1], zp, p0[0], p0[1], L);
    }
    const [cx, cy] = P(4, 4);
    if (type === 'bois') {
      round(cx, cy, 0, zp, 1.2, 1.5);
    } else if (type === 'argent') {
      round(cx, cy, 0, 1, 1.4, 1.4);        // plastic foot
      round(cx, cy, 1, zp, 1.5, 1.5);       // steel tube
    } else {
      round(cx, cy, 0, 1.2, 1.5, 1.3);      // round foot
      const foot = new THREE.Vector3(cx, cy, 1.2);
      for (const [u, v] of [[1.8, 1.8], [8, 1.8], [1.8, 8]] as const) {
        const [x, y] = P(u, v);
        rod(new THREE.Vector3(x, y, zp), foot, 0.35);
      }
    }
  }
  return { faces, edges, frusta };
}
