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
import { frameSold, legsCompatible } from './finishes';
import { OBJECT_BY_SHAPE } from './objects';
import { t, DECIMAL } from './i18n';
import { eketSize } from './eket';

export const KALLAX = {
  depth: 39,
  outerPanel: 4,
  divider: 1.5,
  cell: 33.5,
  pitch: 35,
  /** Underframe height: 147×164 "avec support" = 146.5 + 17.5 (sold as an 18 cm underframe). */
  legs: 17.5,
} as const;

/** Underframe compatibility (2×2, 2×4 standing, 4×2 / 4×3 lying, 4×4). */
export function legsAvailable(cols: number, rows: number): boolean {
  return legsCompatible(cols, rows);
}

/** IKEA reference pages. */
export const IKEA_LINKS = [
  { label: t('link.series'), url: 'https://www.ikea.com/fr/fr/cat/kallax-serie-27534/' },
  { label: t('link.shelves'), url: 'https://www.ikea.com/fr/fr/cat/etageres-kallax-58285/' },
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
 * Formats IKEA sells = those with a price (core/finishes.ts), in either
 * orientation — except 3×1: the 1×3 only stands upright. Other formats
 * (older documents) still load and render, as "sur mesure".
 */
export function isOfficial(cols: number, rows: number): boolean {
  return frameSold(cols, rows) && !(cols === 3 && rows === 1);
}

/**
 * Next sold value of one dimension, the other one fixed (inspector steppers):
 * the first `isOfficial` format from `v` in direction `dir`, or null.
 */
export function nextOfficial(axis: 'cols' | 'rows', cols: number, rows: number, dir: 1 | -1): number | null {
  const v0 = axis === 'cols' ? cols : rows;
  for (let v = v0 + dir; v >= 1 && v <= MAX_CELLS; v += dir) {
    if (axis === 'cols' ? isOfficial(v, rows) : isOfficial(cols, v)) return v;
  }
  return null;
}

export interface CatalogEntry {
  cols: number;
  rows: number;
  label: string;       // "2×4"
  nominal: string;     // "77×147 cm"
  exact: Size3;        // exact outer size (w × d × h)
  official: boolean;
}

/** Ordered catalogue shown in the library: the formats IKEA sells, row by row (1 cell high first). */
export const CATALOG: CatalogEntry[] = (() => {
  const order: [number, number][] = [];
  for (let rows = 1; rows <= MAX_CELLS; rows++)
    for (let cols = 1; cols <= MAX_CELLS; cols++) if (isOfficial(cols, rows)) order.push([cols, rows]);
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
  if (item.kind === 'eket') return eketSize(item.variant, !!item.legs);
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
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)).replace('.', DECIMAL);
}

export function kallaxDisplayName(it: KallaxItem): string {
  return `Kallax ${it.cols}×${it.rows}${it.legs ? t('kallax.legsSuffix') : ''}`;
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

/**
 * Collision participation: furniture (KALLAX, EKET) always collides; other
 * objects unless their "Collisions" switch is off (`collide: false`).
 */
export function collides(it: Item): boolean {
  return it.kind !== 'block' || it.collide !== false;
}

export function isWall(it: Item): boolean {
  return it.kind === 'block' && it.shape === 'wall';
}
/** Structure of the room (walls, windows): not furniture, not in the shopping list. */
export function isStructure(it: Item): boolean {
  return it.kind === 'block' && !!it.shape && !!OBJECT_BY_SHAPE[it.shape]?.structure;
}
/** Standard window sill height ("allège"). */
export const WINDOW_SILL = 90;

// ── cell fittings ("habillage") ───────────────────────────────
import type { InsertType } from './types';
export const INSERTS: Record<InsertType, { label: string; product: string; icon: string }> = {
  door: { label: t('insert.door'), product: `${t('product.door')} 33×33`, icon: 'insertDoor' },
  drawers: { label: t('insert.drawers'), product: `${t('product.drawers')} 33×33`, icon: 'insertDrawers' },
  basket: { label: t('insert.basket'), product: `${t('product.basketFull')} 33×38×33`, icon: 'insertBasket' },
  shelf: { label: t('insert.shelf'), product: `${t('product.shelf')} 33×33`, icon: 'insertShelf' },
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
