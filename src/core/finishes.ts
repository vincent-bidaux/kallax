// ─────────────────────────────────────────────────────────────
// Finishes ("finitions") and IKEA FR prices (€), from the user's
// price tables (Nov 2026). Frames are orientation-agnostic: a 2×4
// lying down is the same product as a 2×4 standing (key = small×large).
// ─────────────────────────────────────────────────────────────
import type { InsertType, Item, KallaxItem } from './types';
import { t, lang, locale } from './i18n';
import { EKET_COLOR_BY_ID, EKET_LEG_BY_ID, eketDef, eketDims, eketPrice, effectiveEketColor, type EketColorId } from './eket';

export type FinishId =
  | 'blanc' | 'blanc-brillant' | 'brun-noir' | 'chene-blanchi' | 'chene' | 'noyer' | 'gris';

export interface Finish {
  id: FinishId;
  label: string;
  /** Face colour for the "Couleurs des finitions" render option. */
  color: string;
  /** Edge colour drawn over that face (enough contrast, same family). */
  line: string;
}

export const FINISHES: Finish[] = [
  { id: 'blanc', label: t('finish.blanc'), color: '#f1f0ec', line: '#5f6166' },
  { id: 'blanc-brillant', label: t('finish.blancBrillant'), color: '#fbfbfa', line: '#6b6e75' },
  { id: 'brun-noir', label: t('finish.brunNoir'), color: '#3a2f2a', line: '#b9a99c' },
  { id: 'chene-blanchi', label: t('finish.cheneBlanchi'), color: '#d8cab2', line: '#6e5f49' },
  { id: 'chene', label: t('finish.chene'), color: '#c39a69', line: '#5e4224' },
  { id: 'noyer', label: t('finish.noyer'), color: '#7b5537', line: '#e2c7ac' },
  { id: 'gris', label: t('finish.gris'), color: '#8e9092', line: '#2f3133' },
];
export const FINISH_BY_ID = Object.fromEntries(FINISHES.map(f => [f.id, f])) as Record<FinishId, Finish>;
export const DEFAULT_FINISH: FinishId = 'blanc';

type PriceMap = Partial<Record<FinishId, number>>;

/** Frame prices by model "small×large" (cells). */
export const FRAME_PRICES: Record<string, PriceMap> = {
  '1x1': { 'blanc': 19.99, 'brun-noir': 24.99, 'chene-blanchi': 24.99, 'blanc-brillant': 29.99 },
  '1x2': { 'blanc': 24.99, 'brun-noir': 29.99, 'chene-blanchi': 29.99 },
  '1x3': { 'blanc': 34.99, 'brun-noir': 39.99, 'chene-blanchi': 39.99 },
  '2x2': { 'blanc': 34.99, 'brun-noir': 39.99, 'chene': 39.99, 'noyer': 39.99, 'blanc-brillant': 49.99 },
  '1x4': { 'blanc': 44.99, 'brun-noir': 49.99, 'chene-blanchi': 49.99, 'blanc-brillant': 59.99 },
  '2x4': { 'blanc': 59.99, 'brun-noir': 69.99, 'chene-blanchi': 69.99, 'gris': 69.99, 'noyer': 69.99, 'blanc-brillant': 74.99 },
  '3x3': { 'blanc': 79.99, 'brun-noir': 89.99, 'chene-blanchi': 89.99 },
  '3x4': { 'blanc': 99.99, 'brun-noir': 109.0, 'chene-blanchi': 109.0 },
  '4x4': { 'blanc': 119.0, 'brun-noir': 129.0, 'chene-blanchi': 129.0, 'blanc-brillant': 149.0 },
  '5x5': { 'blanc': 169.0, 'brun-noir': 179.0, 'chene-blanchi': 179.0 },
};

/**
 * Underframe ("piètement"): 76 cm wide for 2-cell-wide frames (+25 €),
 * 146 cm for 4-cell-wide frames (+35 €). Compatible: 2×2, 2×4 standing,
 * 4×2 lying, 4×3 lying (3×4 couché), 4×4. Not 1×N, 3×3, 5×5 (too heavy).
 */
const LEGS_OK = new Set(['2x2', '2x4', '4x2', '4x3', '4x4']);
export function legsCompatible(cols: number, rows: number): boolean { return LEGS_OK.has(`${cols}x${rows}`); }
export function legsPrice(cols: number): number { return cols === 2 ? 25 : 35; }
export function legsLabel(cols: number): string { return t('product.legs', { w: cols === 2 ? 76 : 146 }); }

/** Underframe colours ("KALLAX Structure"), same price in both. Absent = white (older documents). */
export type KallaxLegsColor = 'blanc' | 'noir';
export const KALLAX_LEGS_COLORS: { id: KallaxLegsColor; label: string; hex: string; urls: Record<76 | 146, string> }[] = [
  { id: 'blanc', label: t('legs.blanc'), hex: '#efefec', urls: {
    76: 'https://www.ikea.com/fr/fr/p/kallax-structure-blanc-90495596/', 146: 'https://www.ikea.com/fr/fr/p/kallax-structure-blanc-40501892/' } },
  { id: 'noir', label: t('legs.noir'), hex: '#262628', urls: {
    76: 'https://www.ikea.com/fr/fr/p/kallax-structure-noir-30495599/', 146: 'https://www.ikea.com/fr/fr/p/kallax-structure-noir-00501889/' } },
];
export function kallaxLegsColor(it: KallaxItem): (typeof KALLAX_LEGS_COLORS)[number] {
  return KALLAX_LEGS_COLORS.find(c => c.id === it.legsColor) ?? KALLAX_LEGS_COLORS[0];
}

export type BasketVariant = 'naturel' | 'blanc';
export const BASKET_VARIANTS: { id: BasketVariant; label: string; price: number }[] = [
  { id: 'naturel', label: t('basket.naturel'), price: 14.99 },
  { id: 'blanc', label: t('basket.blanc'), price: 16.99 },
];

/** Cell fitting prices. The basket (BRANÄS rattan) uses its own variants. */
export const INSERT_PRICES: Record<Exclude<InsertType, 'basket'>, PriceMap> = {
  door: { 'blanc': 17.5, 'brun-noir': 20, 'chene-blanchi': 20, 'noyer': 20, 'blanc-brillant': 25 },
  drawers: { 'blanc': 22.5, 'brun-noir': 25, 'blanc-brillant': 30 },
  shelf: { 'blanc': 20 },
};
export const INSERT_NAMES: Record<InsertType, string> = {
  door: t('product.door'),
  drawers: t('product.drawers'),
  shelf: t('product.shelf'),
  basket: t('product.basket'),
};

export function modelKey(cols: number, rows: number): string {
  return `${Math.min(cols, rows)}x${Math.max(cols, rows)}`;
}
/** Is this frame sold by IKEA (any orientation)? */
export function frameSold(cols: number, rows: number): boolean { return !!FRAME_PRICES[modelKey(cols, rows)]; }
export function framePrices(cols: number, rows: number): PriceMap | null { return FRAME_PRICES[modelKey(cols, rows)] ?? null; }
/** Lowest price of a frame ("dès …"), or null when not sold. */
export function frameMinPrice(cols: number, rows: number): number | null {
  const p = framePrices(cols, rows);
  return p ? Math.min(...Object.values(p) as number[]) : null;
}
export function insertMinPrice(t: InsertType): number {
  if (t === 'basket') return Math.min(...BASKET_VARIANTS.map(b => b.price));
  return Math.min(...Object.values(INSERT_PRICES[t]) as number[]);
}
/** Finishes a frame model is sold in. */
export function frameFinishes(cols: number, rows: number): FinishId[] {
  return Object.keys(framePrices(cols, rows) ?? {}) as FinishId[];
}

export function effectiveFinish(it: KallaxItem, docFinish: FinishId | undefined): FinishId {
  return it.finish ?? docFinish ?? DEFAULT_FINISH;
}

const EUR = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EUR_WHOLE = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** "19,99 €" in French, "€19.99" in English. */
export function fmtEur(v: number): string {
  if (lang === 'fr') return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  return EUR.format(v);
}
/** Like fmtEur, without decimals for whole amounts ("20 €" / "€20"). */
export function fmtEurShort(v: number): string {
  if (Math.abs(v - Math.round(v)) > 1e-9) return fmtEur(v);
  if (lang === 'fr') return `${Math.round(v).toLocaleString('fr-FR')} €`;
  return EUR_WHOLE.format(v);
}

// ── bill of materials ────────────────────────────────────────
export interface BomLine {
  key: string;
  qty: number;
  label: string;       // "KALLAX 2×4"
  detail: string;      // "77×147 cm · Blanc"
  unit: number | null; // € per unit (null = no price: not sold)
  total: number | null;
  /** Shown as a warning: finish not sold for this model, fallback price used, etc. */
  note?: string;
  kind: 'frame' | 'legs' | 'insert' | 'eket' | 'object';
}

const nominal = (n: number) => Math.round(35 * n + 7);

/** Price lookup with fallback: requested finish → else the "coloured" tier → else white. */
function priceFor(map: PriceMap, f: FinishId): { price: number; used: FinishId; exact: boolean } {
  if (map[f] != null) return { price: map[f]!, used: f, exact: true };
  const tierOrder: FinishId[] = f === 'blanc-brillant' ? ['blanc-brillant', 'brun-noir', 'blanc'] : ['brun-noir', 'chene-blanchi', 'noyer', 'blanc'];
  for (const t of tierOrder) if (map[t] != null) return { price: map[t]!, used: t, exact: false };
  const first = Object.entries(map)[0] as [FinishId, number];
  return { price: first[1], used: first[0], exact: false };
}

export function buildBom(items: Item[], docFinish: FinishId | undefined, basket: BasketVariant | undefined, docEket?: EketColorId): { lines: BomLine[]; total: number; unpriced: number } {
  const map = new Map<string, BomLine>();
  const add = (l: Omit<BomLine, 'qty' | 'total'>, n = 1) => {
    const e = map.get(l.key);
    if (e) { e.qty += n; e.total = e.unit != null ? e.unit * e.qty : null; }
    else map.set(l.key, { ...l, qty: n, total: l.unit != null ? l.unit * n : null });
  };
  for (const it of items) {
    if (it.kind === 'eket') {
      // EKET: regular price of the product in its colour. A colour the product
      // is not sold in falls back on the white price, with a note (like KALLAX finishes).
      const v = eketDef(it.variant), c = effectiveEketColor(it, docEket);
      const pr = eketPrice(v.id, c);
      const extra = v.rail ? ` · ${t('eket.railIncluded')}` : '';
      add({ key: `e:${v.id}:${c}`, label: v.product, detail: `${eketDims(v.id)} cm · ${EKET_COLOR_BY_ID[c].label}${extra}`,
        unit: pr.price, kind: 'eket',
        note: pr.exact ? undefined : t('bom.noteEketColor', { variant: v.label.toLowerCase(), used: EKET_COLOR_BY_ID[pr.used].label.toLowerCase() }) });
      // legs: one pack of 4 per unit
      const lg = it.legs ? EKET_LEG_BY_ID[it.legs] : undefined;
      if (lg) add({ key: `el:${lg.id}`, label: lg.product, detail: t('bom.eketLegsDetail'), unit: lg.price, kind: 'legs' });
      continue;
    }
    if (it.kind !== 'kallax') continue;
    const f = effectiveFinish(it, docFinish);
    const fl = FINISH_BY_ID[f].label;
    const mk = modelKey(it.cols, it.rows);
    const pm = framePrices(it.cols, it.rows);
    const dims = `${nominal(it.cols)}×${nominal(it.rows)} cm`;
    if (pm) {
      const p = priceFor(pm, f);
      add({ key: `f:${mk}:${f}`, label: `KALLAX ${it.cols}×${it.rows}`, detail: `${dims} · ${fl}`, unit: p.price, kind: 'frame',
        note: p.exact ? undefined : t('bom.noteFinish', { model: mk.replace('x', '×'), finish: FINISH_BY_ID[p.used].label.toLowerCase() }) });
    } else {
      add({ key: `f:${mk}:${f}`, label: `KALLAX ${it.cols}×${it.rows}`, detail: `${dims} · ${fl}`, unit: null, kind: 'frame', note: t('bom.noteCustom') });
    }
    if (it.legs) {
      const ok = legsCompatible(it.cols, it.rows);
      const lc = kallaxLegsColor(it);
      add({ key: `l:${it.cols === 2 ? 76 : 146}:${lc.id}`, label: legsLabel(it.cols), detail: `39 × 18 cm · ${lc.label}`, unit: ok ? legsPrice(it.cols) : null, kind: 'legs',
        note: ok ? undefined : t('bom.noteLegs') });
    }
    for (const [k, ty] of Object.entries(it.inserts ?? {})) {
      const [c, r] = k.split(',').map(Number);
      if (!(c < it.cols && r < it.rows)) continue;
      if (ty === 'basket') {
        const v = BASKET_VARIANTS.find(b => b.id === (basket ?? 'naturel'))!;
        add({ key: `i:basket:${v.id}`, label: INSERT_NAMES.basket, detail: `33×38×33 cm · ${v.label}`, unit: v.price, kind: 'insert' });
      } else {
        const p = priceFor(INSERT_PRICES[ty], f);
        add({ key: `i:${ty}:${p.used}`, label: INSERT_NAMES[ty], detail: `33×33 cm · ${FINISH_BY_ID[p.used].label}`, unit: p.price, kind: 'insert',
          note: p.exact ? undefined : t('bom.noteInsert', { finish: fl.toLowerCase(), used: FINISH_BY_ID[p.used].label.toLowerCase() }) });
      }
    }
  }
  const order = { frame: 0, legs: 1, insert: 2, eket: 3, object: 4 };
  // EKET legs come right after the EKET units
  const rank = (l: BomLine) => (l.key.startsWith('el:') ? order.eket + 0.5 : order[l.kind]);
  const lines = [...map.values()].sort((a, b) => rank(a) - rank(b) || (b.unit ?? 0) - (a.unit ?? 0));
  const total = lines.reduce((s, l) => s + (l.total ?? 0), 0);
  const unpriced = lines.filter(l => l.total == null).reduce((s, l) => s + l.qty, 0);
  return { lines, total, unpriced };
}
