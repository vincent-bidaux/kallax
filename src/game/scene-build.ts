// ─────────────────────────────────────────────────────────────
// Game mode — conversion of the (snapshot) document into game meshes, with
// destructible items pre-fractured into pieces at load:
//   · KALLAX: its real panels as boxes (outer panels, vertical dividers, the
//     horizontal divider segments between them), cell fittings (door, drawer
//     fronts + bodies, BRANÄS baskets, shelves), underframe posts / rails;
//   · EKET and every other destructible object: the app's face geometry
//     (render/item-geometry, read-only) is split — runs of 36 vertices that
//     form an axis-aligned box become box pieces, everything else (lofts,
//     revolved parts, foliage) is cut into voxel chunks (triangles assigned
//     by centroid, 1–4 cells per axis); items with few pieces get their
//     biggest boxes split until they have at least 6.
// Intact items draw as one merged mesh per material; the first hit swaps it
// for the individual piece meshes. Structure (walls with their openings,
// windows + glass, doors — translucent —, skirting, radiators) is static and
// indestructible; humans are hidden.
// Local "content" space of an item: [0,w] × [0,d] × [0,h] (front at y = 0),
// placed like the app's ItemView: pivot at the world AABB centre, Euler ZYX.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BlockItem, DesignDoc, EketItem, Item, KallaxItem } from '../core/types';
import { KALLAX, kallaxOuter, localSize, validInserts, worldSize } from '../core/kallax';
import { effectiveFinish, kallaxLegsColor } from '../core/finishes';
import { EKET_COLOR_BY_ID, EKET_LEG_BY_ID, effectiveEketColor } from '../core/eket';
import { colorOf, variantOf } from '../core/objects';
import { acquireGeometry, releaseGeometry } from '../render/item-geometry';
import { computeWallHoles } from '../render/wall-openings';
import { GameMaterials, boxUVs } from './materials';

export type SoundKind = 'wood' | 'metal' | 'soft';

export interface Piece {
  /** Geometry centred on `c` (content-space axes). */
  geo: THREE.BufferGeometry;
  /** Centre (content space). */
  c: THREE.Vector3;
  /** Half extents of its local box. */
  half: THREE.Vector3;
  mat: THREE.Material;
  /** Volume (cm³): exact for boxes, ~35 % of the box for chunks. */
  vol: number;
  snd: SoundKind;
}

export interface GameItem {
  id: string;
  src: Item;
  destructible: boolean;
  /** Pivot at the world AABB centre (moves when the item falls). */
  root: THREE.Group;
  /** Content space (offset −size/2). */
  content: THREE.Group;
  /** Merged meshes while intact. */
  intact: THREE.Group | null;
  pieces: Piece[];
  /** Piece meshes once broken (null = detached / not built yet). */
  meshes: (THREE.Mesh | null)[];
  attached: boolean[];
  broken: boolean;
  destroyed: boolean;
  hits: number;
  hitsNeeded: number;
  volume: number;
  destroyedVol: number;
  /** Fall offset (cm, ≤ 0) and vertical speed. */
  dz: number;
  vz: number;
  falling: boolean;
  /** Items it rests on at load (ids); empty = floor / wall-hung. */
  supporters: string[];
  /** World AABB z range at load. */
  z0: number;
  z1: number;
}

const INDESTRUCTIBLE = new Set(['wall', 'window', 'door', 'skirting', 'radiator', 'human']);
export function isDestructible(it: Item): boolean {
  if (it.kind !== 'block') return true;
  return !INDESTRUCTIBLE.has(it.shape ?? 'box');
}
const isHidden = (it: Item) => it.kind === 'block' && it.shape === 'human';

export function visibleItems(doc: DesignDoc): Item[] {
  const vis = new Set(doc.layers.filter(l => l.visible).map(l => l.id));
  return doc.items.filter(i => vis.has(i.layerId));
}

// ── piece helpers ─────────────────────────────────────────────
type Box6 = [number, number, number, number, number, number];

function boxPiece(b: Box6, mat: THREE.Material, snd: SoundKind): Piece {
  const [x0, y0, z0, x1, y1, z1] = b;
  const w = Math.max(0.2, x1 - x0), d = Math.max(0.2, y1 - y0), h = Math.max(0.2, z1 - z0);
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const g = new THREE.BoxGeometry(w, d, h).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(c.x, c.y, c.z);
  boxUVs(g);
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  return { geo: g, c, half: new THREE.Vector3(w / 2, d / 2, h / 2), mat, vol: w * d * h, snd };
}

/** Split a box piece in two along its longest axis. */
function splitBox(p: Piece): [Piece, Piece] {
  const h = p.half, c = p.c;
  const b: Box6 = [c.x - h.x, c.y - h.y, c.z - h.z, c.x + h.x, c.y + h.y, c.z + h.z];
  const ax = h.x >= h.y && h.x >= h.z ? 0 : h.y >= h.z ? 1 : 2;
  const r = 0.4 + Math.random() * 0.2;
  const m = b[ax] + (b[ax + 3] - b[ax]) * r;
  const a = [...b] as Box6, bb = [...b] as Box6;
  a[ax + 3] = m; bb[ax] = m;
  p.geo.dispose();
  return [boxPiece(a, p.mat, p.snd), boxPiece(bb, p.mat, p.snd)];
}

/** Triangles (content space) → a chunk piece. */
function chunkPiece(pos: number[], nrm: number[], mat: THREE.Material, snd: SoundKind): Piece {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3));
  boxUVs(g);
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingSphere();
  return { geo: g, c, half, mat, vol: 8 * half.x * half.y * half.z * 0.35, snd };
}

function ensureMinPieces(list: Piece[], min = 6) {
  for (let guard = 0; list.length < min && guard < 20; guard++) {
    let best = -1, bv = 0;
    list.forEach((p, i) => {
      if (p.geo.userData.chunk) return;
      const longest = Math.max(p.half.x, p.half.y, p.half.z) * 2;
      if (longest > 8 && p.vol > bv) { bv = p.vol; best = i; }
    });
    if (best < 0) break;
    const [a, b] = splitBox(list[best]);
    list.splice(best, 1, a, b);
  }
}

// ── KALLAX ────────────────────────────────────────────────────
function kallaxPieces(it: KallaxItem, doc: DesignDoc, mats: GameMaterials): Piece[] {
  const W = kallaxOuter(it.cols), H = kallaxOuter(it.rows), D = KALLAX.depth;
  const op = KALLAX.outerPanel, dv = KALLAX.divider, cell = KALLAX.cell;
  const L = it.legs ? KALLAX.legs : 0;
  const fin = mats.kallax(effectiveFinish(it, doc.finish));
  const out: Piece[] = [];
  const P = (b: Box6, m = fin, s: SoundKind = 'wood') => out.push(boxPiece(b, m, s));
  // outer panels
  P([0, 0, L, op, D, L + H]);
  P([W - op, 0, L, W, D, L + H]);
  P([op, 0, L, W - op, D, L + op]);
  P([op, 0, L + H - op, W - op, D, L + H]);
  // vertical dividers (full inner height)
  for (let i = 1; i < it.cols; i++) {
    const x = op + i * cell + (i - 1) * dv;
    P([x, 0, L + op, x + dv, D, L + H - op]);
  }
  // horizontal dividers, one segment per column
  for (let j = 1; j < it.rows; j++) {
    const z = L + op + j * cell + (j - 1) * dv;
    for (let i = 0; i < it.cols; i++) {
      const x0 = op + i * (cell + dv);
      P([x0, 0, z, x0 + cell, D, z + dv]);
    }
  }
  // cell fittings
  const basketColor = (doc.basket ?? 'naturel') === 'blanc' ? '#f1efe9' : '#c8a26a';
  const rattan = mats.get('rattan', basketColor);
  const knob = mats.get('metal', '#3a3b3e');
  for (const [c, r, t] of validInserts(it)) {
    const x0 = op + c * (cell + dv), z0 = L + op + r * (cell + dv), x1 = x0 + cell, z1 = z0 + cell;
    const g = 0.25;
    if (t === 'door') {
      P([x0 + g, 0.3, z0 + g, x1 - g, 2, z1 - g]);
      const kx = x1 - 3.2, kz = (z0 + z1) / 2;
      P([kx - 0.6, -0.6, kz - 2.2, kx + 0.6, 0.3, kz + 2.2], knob, 'metal');
    } else if (t === 'drawers') {
      const zm = (z0 + z1) / 2;
      for (const [a, b] of [[z0 + g, zm - g / 2], [zm + g / 2, z1 - g]] as const) {
        P([x0 + g, 0.3, a, x1 - g, 2, b]);
        P([x0 + 1.2, 2, a + 0.8, x1 - 1.2, D - 3, b - 1.5]);
      }
    } else if (t === 'basket') {
      P([x0 + 0.6, 1.2, z0 + 0.2, x1 - 0.6, Math.min(D - 0.5, 38.2), z1 - 1.5], rattan, 'soft');
    } else {
      const zm = (z0 + z1) / 2;
      P([x0, 1.5, zm - 0.8, x1, D - 1.5, zm + 0.8]);
    }
  }
  // underframe
  if (L) {
    const lc = kallaxLegsColor(it);
    const lm = mats.get('metal', lc.hex);
    const post = 3, rail = 3, inset = 1.5;
    for (const x of [inset, W - inset - post]) for (const y of [inset, D - inset - post]) P([x, y, 0, x + post, y + post, L - rail], lm, 'metal');
    P([inset, inset, L - rail, W - inset, inset + post, L], lm, 'metal');
    P([inset, D - inset - post, L - rail, W - inset, D - inset, L], lm, 'metal');
    P([inset, inset + post, L - rail, inset + post, D - inset - post, L], lm, 'metal');
    P([W - inset - post, inset + post, L - rail, W - inset, D - inset - post, L], lm, 'metal');
  }
  ensureMinPieces(out);
  return out;
}

// ── generic splitting of the app's face geometry ──────────────
interface TriMat { mat: THREE.Material; snd: SoundKind }

function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

/**
 * Split a content-space geometry into pieces. `matOf(tri, cx, cy, cz)` picks
 * the material of each triangle (group material index and centroid).
 */
function splitGeometry(src: THREE.BufferGeometry, size: { w: number; d: number; h: number },
  matOf: (group: number, cx: number, cy: number, cz: number) => TriMat): Piece[] {
  const g = nonIndexed(src);
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const nrm = g.getAttribute('normal').array as ArrayLike<number>;
  const n = pos.length / 3;
  // group (material index) of each vertex
  const grp = new Int16Array(n);
  for (const gr of g.groups) for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i++) grp[i] = gr.materialIndex ?? 0;
  const triMat = (v: number) => {
    const cx = (pos[v * 3] + pos[v * 3 + 3] + pos[v * 3 + 6]) / 3;
    const cy = (pos[v * 3 + 1] + pos[v * 3 + 4] + pos[v * 3 + 7]) / 3;
    const cz = (pos[v * 3 + 2] + pos[v * 3 + 5] + pos[v * 3 + 8]) / 3;
    return { m: matOf(grp[v], cx, cy, cz), cx, cy, cz };
  };
  const out: Piece[] = [];
  const isBox = (v0: number): Box6 | null => {
    if (v0 + 36 > n) return null;
    const xs = new Set<number>(), ys = new Set<number>(), zs = new Set<number>();
    for (let v = v0; v < v0 + 36; v++) {
      xs.add(Math.round(pos[v * 3] * 1000)); ys.add(Math.round(pos[v * 3 + 1] * 1000)); zs.add(Math.round(pos[v * 3 + 2] * 1000));
      if (xs.size > 2 || ys.size > 2 || zs.size > 2) return null;
    }
    if (xs.size !== 2 || ys.size !== 2 || zs.size !== 2) return null;
    const g0 = grp[v0];
    for (let v = v0; v < v0 + 36; v++) if (grp[v] !== g0) return null;
    const [ax, bx] = [...xs].sort((p, q) => p - q), [ay, by] = [...ys].sort((p, q) => p - q), [az, bz] = [...zs].sort((p, q) => p - q);
    return [ax / 1000, ay / 1000, az / 1000, bx / 1000, by / 1000, bz / 1000];
  };
  // voxel grid for the rest
  const cellsOf = (s: number) => Math.max(1, Math.min(4, Math.ceil(s / 28)));
  const nx = cellsOf(size.w), ny = cellsOf(size.d), nz = cellsOf(size.h);
  const soup = new Map<string, { pos: number[]; nrm: number[]; tm: TriMat }>();
  for (let v = 0; v < n;) {
    const b = isBox(v);
    if (b) {
      const tm = triMat(v).m;
      out.push(boxPiece(b, tm.mat, tm.snd));
      v += 36;
      continue;
    }
    if (v + 3 > n) break;
    const t = triMat(v);
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(t.cx / Math.max(1, size.w) * nx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(t.cy / Math.max(1, size.d) * ny)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor(t.cz / Math.max(1, size.h) * nz)));
    const key = `${ix},${iy},${iz}|${t.m.mat.uuid}`;
    let s = soup.get(key);
    if (!s) { s = { pos: [], nrm: [], tm: t.m }; soup.set(key, s); }
    for (let k = 0; k < 9; k++) { s.pos.push(pos[v * 3 + k]); s.nrm.push(nrm[v * 3 + k]); }
    v += 3;
  }
  for (const s of soup.values()) {
    if (s.pos.length < 9) continue;
    const p = chunkPiece(s.pos, s.nrm, s.tm.mat, s.tm.snd);
    p.geo.userData.chunk = true;
    out.push(p);
  }
  g.dispose();
  // a single-chunk object (small lamp…): cut its soup along Z
  if (out.length < 4 && out.every(p => p.geo.userData.chunk) && size.h > 8) {
    const all = out.splice(0);
    const pos2: number[][] = [[], [], [], []], nrm2: number[][] = [[], [], [], []];
    const mat = all[0]?.mat, snd = all[0]?.snd ?? 'soft';
    for (const p of all) {
      const a = p.geo.getAttribute('position').array, b = p.geo.getAttribute('normal').array;
      for (let i = 0; i < a.length; i += 9) {
        const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + p.c.z;
        const k = Math.min(3, Math.max(0, Math.floor(cz / size.h * 4)));
        for (let j = 0; j < 9; j++) {
          const off = j % 3 === 0 ? p.c.x : j % 3 === 1 ? p.c.y : p.c.z;
          pos2[k].push(a[i + j] + off); nrm2[k].push(b[i + j]);
        }
      }
      if (all.length === 1 || p === all[0]) { /* keep mat */ }
      p.geo.dispose();
    }
    for (let k = 0; k < 4; k++) if (pos2[k].length >= 9 && mat) { const q = chunkPiece(pos2[k], nrm2[k], mat, snd); q.geo.userData.chunk = true; out.push(q); }
  }
  ensureMinPieces(out);
  return out;
}

/** Materials of a non-KALLAX item, per triangle. */
function materialsFor(it: EketItem | BlockItem, doc: DesignDoc, mats: GameMaterials): (group: number, cx: number, cy: number, cz: number) => TriMat {
  const W: TriMat = { mat: mats.get('wood', '#d2b48c'), snd: 'wood' };
  if (it.kind === 'eket') {
    const col = EKET_COLOR_BY_ID[effectiveEketColor(it, doc.eketFinish)];
    const body: TriMat = { mat: mats.get('plain', col.color), snd: 'wood' };
    const lg = it.legs ? EKET_LEG_BY_ID[it.legs] : undefined;
    const legs: TriMat = lg ? { mat: lg.id === 'bois' ? mats.get('wood', lg.hex) : mats.get('metal', lg.hex), snd: lg.id === 'bois' ? 'wood' : 'metal' } : body;
    return (g) => (g === 1 ? legs : body);
  }
  const s = localSize(it);
  const shape = it.shape ?? 'box';
  const oc = colorOf(shape, it.variant, it.color);
  if (oc) {
    const kind = (hex: string) => {
      const c = new THREE.Color(hex);
      const l = (c.r + c.g + c.b) / 3;
      return l < 0.12 ? 'gloss' as const : 'plain' as const;
    };
    const main: TriMat = { mat: mats.get(shape === 'chair' ? 'fabric' : kind(oc.hex), oc.hex), snd: shape === 'chair' ? 'soft' : 'wood' };
    const sec: TriMat = oc.hex2 ? { mat: mats.get(shape === 'tv' ? 'gloss' : 'metal', oc.hex2), snd: 'metal' } : main;
    if (shape === 'tv') return (g) => (g === 1 ? { mat: mats.get('gloss', oc.hex2 ?? '#141821'), snd: 'metal' } : { mat: mats.get('plain', oc.hex), snd: 'metal' });
    return (g) => (g === 1 ? sec : main);
  }
  switch (shape) {
    case 'bed': {
      const base: TriMat = { mat: mats.get('fabric', '#62666d'), snd: 'soft' };
      const sheet: TriMat = { mat: mats.get('fabric', '#ece7dc'), snd: 'soft' };
      const pillow: TriMat = { mat: mats.get('fabric', '#f8f6f1'), snd: 'soft' };
      const seam = Math.min(7, Math.min(20, s.h) * 0.35), H = Math.min(20, s.h);
      return (_g, _x, _y, z) => (z < seam ? base : z <= H + 0.1 ? sheet : pillow);
    }
    case 'lamp': {
      const v = variantOf('lamp', it.variant)?.id ?? 'h28';
      const shadeZ = v === 'h28' || v === 'h50' ? s.h * 0.56 : s.h - Math.min(34, Math.max(18, s.h * 0.21)) - 0.5;
      const shade: TriMat = { mat: mats.get('emissive', '#f6eedd'), snd: 'soft' };
      const metal: TriMat = { mat: mats.get('metal', v === 'tripod' ? '#9a7550' : '#2e2f33'), snd: 'metal' };
      return (_g, _x, _y, z) => (z > shadeZ ? shade : metal);
    }
    case 'plant': {
      const v = variantOf('plant', it.variant);
      const pot: TriMat = { mat: mats.get('plain', '#b7684a'), snd: 'wood' };
      const leaf: TriMat = { mat: mats.get('leaf', '#4d7c3b'), snd: 'soft' };
      const Wm = Math.min(s.w, s.d);
      if (v?.hang) {
        const hd = v.hangDepth ?? 7;
        const potR = (s.d - hd - 1) / 2, cx = s.w / 2, cy = hd + 0.5 + potR;
        const potH = Math.min(potR * 1.7, s.h - v.hang - 6);
        return (_g, x, y, z) => (z >= v.hang! - 0.5 && z <= v.hang! + potH * 0.92 && Math.hypot(x - cx, y - cy) < potR + 0.2 ? pot : leaf);
      }
      const bushy = v?.id.startsWith('b');
      const potH = s.h * (bushy ? 0.3 : 0.4), rTop = Wm * (bushy ? 0.24 : 0.3);
      return (_g, x, y, z) => (z < potH * 0.92 && Math.hypot(x - s.w / 2, y - s.d / 2) < rTop + 1 ? pot : leaf);
    }
    case 'cylinder': case 'square': return () => ({ mat: mats.get('wood', '#c9a77c'), snd: 'wood' });
    case 'desk': case 'table': return (g) => (g === 1 ? { mat: mats.get('metal', '#2f3033'), snd: 'metal' } : W);
    case 'frame': return (g) => (g === 1 ? { mat: mats.get('plain', '#efe9dd'), snd: 'wood' } : { mat: mats.get('plain', '#2b2a28'), snd: 'wood' });
    default: return () => W;
  }
}

// ── items ─────────────────────────────────────────────────────
function placeRoot(it: Item, root: THREE.Group, content: THREE.Group) {
  const p = it.position, ws = worldSize(it), ls = localSize(it);
  root.position.set(p.x + ws.w / 2, p.y + ws.d / 2, p.z + ws.h / 2);
  const r = THREE.MathUtils.degToRad;
  root.rotation.set(r(it.tilt?.x ?? 0), r(it.tilt?.y ?? 0), r(it.rotation), 'ZYX');
  content.position.set(-ls.w / 2, -ls.d / 2, -ls.h / 2);
}

/** One mesh per material from a set of pieces (content space). */
export function mergePieces(pieces: Piece[]): THREE.Group {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of pieces) {
    const g = p.geo.clone();
    g.translate(p.c.x, p.c.y, p.c.z);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const l = byMat.get(p.mat); if (l) l.push(g); else byMat.set(p.mat, [g]);
  }
  const grp = new THREE.Group();
  for (const [mat, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

function staticMesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}

/** Window glass panes (same layout as the app's window frame). */
function windowGlass(s: { w: number; d: number; h: number }, mat: THREE.Material): THREE.Mesh[] {
  const w = Math.max(s.w, 20), d = Math.max(s.d, 1), h = Math.max(s.h, 20);
  const f = Math.min(6, w / 6, h / 6);
  const two = w >= 70;
  const m = two ? Math.min(7, w / 10) : 0;
  const panes: [number, number, number, number][] = two ? [[f, f, (w - m) / 2, h - f], [(w + m) / 2, f, w - f, h - f]] : [[f, f, w - f, h - f]];
  return panes.map(([x0, z0, x1, z1]) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(Math.PI / 2);
    g.translate((x0 + x1) / 2, d / 2, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.userData.glass = true;
    return mesh;
  });
}

export interface BuiltScene {
  items: GameItem[];
  byId: Map<string, GameItem>;
  root: THREE.Group;
  /** Meshes hit by rays (static structure + floor), besides item meshes. */
  staticTargets: THREE.Object3D[];
  totalVolume: number;
}

export function buildScene(doc: DesignDoc, mats: GameMaterials): BuiltScene {
  const all = visibleItems(doc).filter(i => !isHidden(i));
  const holes = computeWallHoles(all);
  const root = new THREE.Group();
  root.name = 'game-items';
  const items: GameItem[] = [];
  const staticTargets: THREE.Object3D[] = [];
  for (const it of all) {
    const ir = new THREE.Group(), content = new THREE.Group();
    ir.add(content);
    placeRoot(it, ir, content);
    ir.userData.itemId = it.id;
    const ws = worldSize(it);
    const gi: GameItem = {
      id: it.id, src: it, destructible: isDestructible(it), root: ir, content, intact: null,
      pieces: [], meshes: [], attached: [], broken: false, destroyed: false, hits: 0, hitsNeeded: 3,
      volume: 0, destroyedVol: 0, dz: 0, vz: 0, falling: false, supporters: [],
      z0: it.position.z, z1: it.position.z + ws.h,
    };
    if (gi.destructible) {
      if (it.kind === 'kallax') gi.pieces = kallaxPieces(it, doc, mats);
      else {
        const ag = acquireGeometry(it);
        const src = ag.face.clone();
        src.groups = ag.face.groups.map(g => ({ ...g }));
        releaseGeometry(ag);
        gi.pieces = splitGeometry(src, localSize(it), materialsFor(it as EketItem | BlockItem, doc, mats));
        src.dispose();
      }
      gi.volume = gi.pieces.reduce((s, p) => s + p.vol, 0);
      gi.meshes = gi.pieces.map(() => null);
      gi.attached = gi.pieces.map(() => true);
      gi.hitsNeeded = gi.volume > 60000 ? 4 : 3;
      gi.intact = mergePieces(gi.pieces);
      for (const m of gi.intact.children) m.userData.itemId = it.id;
      content.add(gi.intact);
    } else {
      const b = it as BlockItem;
      const ag = acquireGeometry(it, b.shape === 'wall' ? holes.get(it.id) : undefined);
      const geo = nonIndexed(ag.face);
      releaseGeometry(ag);
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo.clearGroups();
      let mesh: THREE.Mesh;
      switch (b.shape) {
        case 'wall': {
          if (!geo.getAttribute('uv')) boxUVs(geo, 100);
          mesh = staticMesh(geo, mats.get('plaster', '#ebe6de'));
          // furniture often stands flush against the zero-thickness wall: let it win the depth tie
          const wm = mesh.material as THREE.Material;
          wm.polygonOffset = true; wm.polygonOffsetFactor = 1; wm.polygonOffsetUnits = 2;
          break;
        }
        case 'window': {
          boxUVs(geo);
          mesh = staticMesh(geo, mats.get('plain', '#f4f4f1'));
          for (const gl of windowGlass(localSize(it), mats.get('glass', '#cfe3f0'))) content.add(gl);
          break;
        }
        case 'door': {
          boxUVs(geo);
          mesh = staticMesh(geo, mats.get('door', '#f3f1ec'), false);
          mesh.renderOrder = 3;
          mesh.userData.passable = true;
          break;
        }
        case 'radiator': boxUVs(geo); mesh = staticMesh(geo, mats.get('gloss', '#efefec')); break;
        default: boxUVs(geo); mesh = staticMesh(geo, mats.get('plain', '#f2f0ea'));
      }
      mesh.userData.itemId = it.id;
      content.add(mesh);
      if (!mesh.userData.passable) staticTargets.push(mesh);
    }
    root.add(ir);
    items.push(gi);
  }
  const byId = new Map(items.map(g => [g.id, g]));
  computeSupporters(items);
  const totalVolume = items.reduce((s, g) => s + (g.destructible ? g.volume : 0), 0);
  root.updateMatrixWorld(true);
  return { items, byId, root, staticTargets, totalVolume };
}

// ── support graph ─────────────────────────────────────────────
import { itemOBB, obbFootprintOverlap, type OBB } from '../core/obb';

export function obbOf(g: GameItem): OBB {
  const o = itemOBB(g.src);
  o.c.z += g.dz;
  return o;
}

/** Items each destructible rests on at load (top within 1 cm of its bottom, footprints overlapping). */
function computeSupporters(items: GameItem[]) {
  const obbs = new Map(items.map(g => [g.id, itemOBB(g.src)]));
  for (const g of items) {
    if (!g.destructible || g.z0 < 0.5) continue;
    const A = obbs.get(g.id)!;
    for (const o of items) {
      if (o === g) continue;
      if (o.src.kind === 'block' && (o.src.shape === 'wall' || o.src.shape === 'door' || o.src.shape === 'window')) continue;
      if (Math.abs(o.z1 - g.z0) > 1.2) continue;
      if (obbFootprintOverlap(A, obbs.get(o.id)!, 0.5)) g.supporters.push(o.id);
    }
  }
}

export function disposeScene(s: BuiltScene) {
  s.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });
  for (const g of s.items) for (const p of g.pieces) p.geo.dispose();
  s.root.removeFromParent();
}
