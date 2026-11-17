// ─────────────────────────────────────────────────────────────
// KALLAX exact dimensions (cm) — measured values, not the
// rounded catalogue names.
//
// IKEA product sheets list real sizes: 2 cells = 76.5 cm,
// 4 cells = 146.5 cm, depth 39 cm (catalogue names 77 / 147).
// Pitch is therefore 35 cm per cell:   outer(n) = 35·n + 6.5
//   → 1: 41.5 · 2: 76.5 · 3: 111.5 · 4: 146.5 · 5: 181.5
// Cell opening 33.5 cm (inserts are 33×33), inner divider 1.5 cm,
// outer panels 4 cm:   n·33.5 + (n−1)·1.5 + 2·4 = 35n + 6.5 ✓
// ─────────────────────────────────────────────────────────────

import type { Item, KallaxItem, Size3, Vec3 } from './types';
import { orientDir, orientSize } from './orient';

export const KALLAX = {
  depth: 39,
  outerPanel: 4,
  divider: 1.5,
  cell: 33.5,
  pitch: 35,
  /** Underframe height: 147×164 "avec support" = 146.5 + 17.5 (sold as an 18 cm underframe). */
  legs: 17.5,
} as const;

/** IKEA sells the underframe for 2-wide (77) and 4-wide (147) frames. */
export function legsAvailable(cols: number): boolean {
  return cols === 2 || cols === 4;
}

/** IKEA reference pages. */
export const IKEA_LINKS = [
  { label: 'Série KALLAX — par nombre de cases', url: 'https://www.ikea.com/fr/fr/cat/kallax-serie-27534/' },
  { label: 'Étagères KALLAX — par format', url: 'https://www.ikea.com/fr/fr/cat/etageres-kallax-58285/' },
];

export const MAX_CELLS = 5;

export function kallaxOuter(n: number): number {
  return KALLAX.cell * n + KALLAX.divider * (n - 1) + KALLAX.outerPanel * 2;
}

/** Catalogue size name as IKEA prints it (rounded): 42, 77, 112, 147, 182. */
export function kallaxNominal(n: number): number {
  return Math.round(kallaxOuter(n) + 0.5);
}

/**
 * Frames sold by IKEA (either orientation): 5 → only 5×5; 4 → 4×4, 4×3, 4×2, 4×1;
 * up to 3 → every combination except the 3-cell 3×1 / 1×3. Others are "sur mesure".
 */
export function isOfficial(cols: number, rows: number): boolean {
  const a = Math.max(cols, rows), b = Math.min(cols, rows);
  if (a === 5) return b === 5;
  if (a === 4) return true;
  return !(a === 3 && b === 1);
}

export interface CatalogEntry {
  cols: number;
  rows: number;
  label: string;       // "2×4"
  nominal: string;     // "77×147 cm"
  exact: Size3;        // exact outer size (w × d × h)
  official: boolean;
}

/** Ordered catalogue shown in the library. */
export const CATALOG: CatalogEntry[] = (() => {
  // Every combination from 1×1 to 5×5, row by row.
  const order: [number, number][] = [];
  for (let rows = 1; rows <= MAX_CELLS; rows++)
    for (let cols = 1; cols <= MAX_CELLS; cols++) order.push([cols, rows]);
  return order.map(([cols, rows]) => ({
    cols, rows,
    label: `${cols}×${rows}`,
    nominal: `${kallaxNominal(cols)}×${kallaxNominal(rows)} cm`,
    exact: { w: kallaxOuter(cols), d: KALLAX.depth, h: kallaxOuter(rows) },
    official: isOfficial(cols, rows),
  }));
})();

/** Local (unrotated) size of an item. */
export function localSize(item: Item): Size3 {
  if (item.kind === 'kallax') {
    return { w: kallaxOuter(item.cols), d: KALLAX.depth, h: kallaxOuter(item.rows) + (item.legs ? KALLAX.legs : 0) };
  }
  return { ...item.size };
}

/** World-axis size after rotation about Z. */
export function worldSize(item: Item): Size3 {
  return orientSize(localSize(item), item);
}

export interface Box3 { min: Vec3; max: Vec3 }

export function itemBox(item: Item): Box3 {
  const s = worldSize(item);
  const p = item.position;
  return { min: { ...p }, max: { x: p.x + s.w, y: p.y + s.d, z: p.z + s.h } };
}

export function unionBox(items: Item[]): Box3 | null {
  if (!items.length) return null;
  const b = itemBox(items[0]);
  for (const it of items.slice(1)) {
    const o = itemBox(it);
    b.min.x = Math.min(b.min.x, o.min.x); b.min.y = Math.min(b.min.y, o.min.y); b.min.z = Math.min(b.min.z, o.min.z);
    b.max.x = Math.max(b.max.x, o.max.x); b.max.y = Math.max(b.max.y, o.max.y); b.max.z = Math.max(b.max.z, o.max.z);
  }
  return b;
}

/** Unit vector the open front of an item faces (rotation 0 → −Y, towards the viewer). */
export function frontNormal(item: Item): Vec3 {
  return orientDir(item, { x: 0, y: -1, z: 0 });
}

export function boxesOverlap(a: Box3, b: Box3, eps = 0.01): boolean {
  return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps &&
         a.min.y < b.max.y - eps && a.max.y > b.min.y + eps &&
         a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}

export function fmtCm(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)).replace('.', ',');
}

export function kallaxDisplayName(it: KallaxItem): string {
  return `Kallax ${it.cols}×${it.rows}${it.legs ? ' + piètement' : ''}`;
}

// ── round beams (cylinder blocks) ─────────────────────────────
export function isCylinder(it: Item): it is import('./types').BlockItem & { shape: 'cylinder' } {
  return it.kind === 'block' && it.shape === 'cylinder';
}
/** Diameter / length of a cylinder block. */
/** Ø (cylinder) or side (square beam), length and axis of a beam block. */
export function cylinderDims(it: import('./types').BlockItem): { diameter: number; length: number; axis: 'x' | 'z' } {
  const axis = it.axis ?? 'x';
  return axis === 'x' ? { diameter: it.size.h, length: it.size.w, axis } : { diameter: it.size.w, length: it.size.h, axis };
}
export function cylinderSize(diameter: number, length: number, axis: 'x' | 'z'): Size3 {
  return axis === 'x' ? { w: length, d: diameter, h: diameter } : { w: diameter, d: diameter, h: length };
}

export function isWall(it: Item): boolean {
  return it.kind === 'block' && it.shape === 'wall';
}
/** Structure of the room (walls, windows): not furniture, not in the shopping list. */
export function isStructure(it: Item): boolean {
  return it.kind === 'block' && (it.shape === 'wall' || it.shape === 'window');
}
/** Standard window sill height ("allège"). */
export const WINDOW_SILL = 90;

// ── cell fittings ("habillage") ───────────────────────────────
import type { InsertType } from './types';
export const INSERTS: Record<InsertType, { label: string; product: string; icon: string }> = {
  door: { label: 'Porte', product: 'KALLAX bloc porte 33×33', icon: 'insertDoor' },
  drawers: { label: '2 tiroirs', product: 'KALLAX bloc 2 tiroirs 33×33', icon: 'insertDrawers' },
  basket: { label: 'Panier', product: 'Boîte / panier 33×38×33 (DRÖNA…)', icon: 'insertBasket' },
  shelf: { label: 'Séparation', product: 'KALLAX insert 1 étagère 33×33', icon: 'insertShelf' },
};
/** Valid fittings of a unit (ignores cells outside the current cols × rows). */
export function validInserts(it: KallaxItem): [number, number, InsertType][] {
  const out: [number, number, InsertType][] = [];
  for (const [k, t] of Object.entries(it.inserts ?? {})) {
    const [c, r] = k.split(',').map(Number);
    if (c >= 0 && r >= 0 && c < it.cols && r < it.rows && INSERTS[t]) out.push([c, r, t]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
