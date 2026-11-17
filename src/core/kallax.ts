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

export const KALLAX = {
  depth: 39,
  outerPanel: 4,
  divider: 1.5,
  cell: 33.5,
  pitch: 35,
} as const;

export const MAX_CELLS = 5;

export function kallaxOuter(n: number): number {
  return KALLAX.cell * n + KALLAX.divider * (n - 1) + KALLAX.outerPanel * 2;
}

/** Catalogue size name as IKEA prints it (rounded): 42, 77, 112, 147, 182. */
export function kallaxNominal(n: number): number {
  return Math.round(kallaxOuter(n) + 0.5);
}

/**
 * Frames sold by IKEA (cols × rows), per the IKEA FR "Sélectionnez la dimension
 * de votre KALLAX" range: 1, 2, 4 (1×4), 4 (2×2), 8, 12, 16 and 25 cells — each
 * usable upright or lying down. Other combinations are "sur mesure".
 */
const OFFICIAL = new Set(['1x1', '1x2', '2x1', '1x4', '4x1', '2x2', '2x4', '4x2', '3x4', '4x3', '4x4', '5x5']);
export function isOfficial(cols: number, rows: number): boolean {
  return OFFICIAL.has(`${cols}x${rows}`);
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
    return { w: kallaxOuter(item.cols), d: KALLAX.depth, h: kallaxOuter(item.rows) };
  }
  return { ...item.size };
}

/** World-axis size after rotation about Z. */
export function worldSize(item: Item): Size3 {
  const s = localSize(item);
  return item.rotation === 90 || item.rotation === 270 ? { w: s.d, d: s.w, h: s.h } : s;
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
  switch (item.rotation) {
    case 0: return { x: 0, y: -1, z: 0 };
    case 90: return { x: 1, y: 0, z: 0 };
    case 180: return { x: 0, y: 1, z: 0 };
    case 270: return { x: -1, y: 0, z: 0 };
  }
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
  return `Kallax ${it.cols}×${it.rows}`;
}
