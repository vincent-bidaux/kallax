// ─────────────────────────────────────────────────────────────
// EKET — IKEA France catalogue (regular prices, Nov. 2026, read on each
// ikea.com/fr product page; no promotional / IKEA Family price used).
// Every unit is 35 cm deep. Doors, drawer fronts and flaps sit inside the
// carcass, flush with its front edges, and open with push-openers (no
// handles). Panel thickness is not published: 1,5 cm is a drawing
// approximation, like the inner layout of the media shelf.
// ─────────────────────────────────────────────────────────────
import type { EketItem } from './types';
import { t } from './i18n';

export const EKET = {
  depth: 35,
  /** Carcass panels (approximation, not published). */
  panel: 1.5,
  /** Back panel: thin fibreboard, set back to leave room for the wall rail. */
  back: 0.3,
  backInset: 1.8,
  /** EKET legs: 10 cm (adjustable to 11). */
  legs: 10,
} as const;

/** EKET legs ("Pied, 10 cm"), sold by 4 — one pack per unit (IKEA's own EKET sets on legs use 1 pack for a 70 cm wide unit). */
export type EketLegId = 'bois' | 'noir' | 'argent';
export interface EketLeg {
  id: EketLegId;
  label: string;
  product: string;
  price: number;
  url: string;
  /** Colour in "Couleurs des finitions". */
  hex: string;
}
export const EKET_LEGS: EketLeg[] = [
  { id: 'bois', label: t('eket.leg.bois'), product: t('eket.legP.bois'), price: 25, hex: '#d8b98e', url: 'https://www.ikea.com/fr/fr/p/eket-pied-bois-80474151/' },
  { id: 'noir', label: t('eket.leg.noir'), product: t('eket.legP.noir'), price: 25, hex: '#2a2a2c', url: 'https://www.ikea.com/fr/fr/p/eket-pied-metal-noir-70574660/' },
  { id: 'argent', label: t('eket.leg.argent'), product: t('eket.legP.argent'), price: 25, hex: '#b8bbbf', url: 'https://www.ikea.com/fr/fr/p/eket-pied-metal-couleur-argent-70428904/' },
];
export const EKET_LEG_BY_ID = Object.fromEntries(EKET_LEGS.map(l => [l.id, l])) as Record<EketLegId, EketLeg>;

export type EketVariant =
  | 'open' | 'door' | 'glass' | 'drawers'        // 35 × 35 × 35 cubes
  | 'door-shelf'                                  // 35 × 35 × 70
  | 'drawers-70' | 'media' | 'wall-drawers'       // 70 × 35 × 35
  | 'four' | 'doors-shelf';                       // 70 × 35 × 70

export type EketColorId =
  | 'blanc' | 'beige' | 'bleu-gris-fonce' | 'brun-noyer' | 'chene-blanchi' | 'gris-fonce' | 'lilas-pale';

export interface EketColor {
  id: EketColorId;
  label: string;
  /** Face colour ("Couleurs des finitions"), estimated from IKEA photos. */
  color: string;
  /** Edge colour drawn over that face. */
  line: string;
}

export const EKET_COLORS: EketColor[] = [
  { id: 'blanc', label: t('eket.color.blanc'), color: '#f2f1ed', line: '#5f6166' },
  { id: 'beige', label: t('eket.color.beige'), color: '#d6c6a8', line: '#6a5b42' },
  { id: 'bleu-gris-fonce', label: t('eket.color.bleuGrisFonce'), color: '#4c5967', line: '#c2ccd7' },
  { id: 'brun-noyer', label: t('eket.color.brunNoyer'), color: '#8c623f', line: '#3a2615' },
  { id: 'chene-blanchi', label: t('eket.color.cheneBlanchi'), color: '#dccfb7', line: '#6e5f49' },
  { id: 'gris-fonce', label: t('eket.color.grisFonce'), color: '#3e3f41', line: '#b5b7ba' },
  { id: 'lilas-pale', label: t('eket.color.lilasPale'), color: '#cbbfd5', line: '#5d5168' },
];
export const EKET_COLOR_BY_ID = Object.fromEntries(EKET_COLORS.map(c => [c.id, c])) as Record<EketColorId, EketColor>;
export const DEFAULT_EKET_COLOR: EketColorId = 'blanc';

const P = 'https://www.ikea.com/fr/fr/p/';

/** One colour of a product: regular price (€) and product page. */
interface Offer { price: number; url: string }

export interface EketVariantDef {
  id: EketVariant;
  /** Width × height (cm); depth is always EKET.depth. */
  w: number;
  h: number;
  /** Short chip / tile label ("Ouvert", "2 portes"…). */
  label: string;
  /** IKEA product name ("EKET Armoire 1 porte"). */
  product: string;
  /** Colours sold for this product (first = reference), with their regular price and page. */
  offers: Partial<Record<EketColorId, Offer>>;
  /** What the front / inside looks like, or what a set includes (inspector, BOM tooltip). */
  note?: string;
  /** Sets ("combinaison"): contents listed in the inspector. */
  contents?: string;
  /** Sets that include the wall rail: "rail inclus" in the BOM. */
  rail?: boolean;
  icon: string;
}

const o = (price: number, slug: string): Offer => ({ price, url: `${P}${slug}/` });

export const EKET_VARIANTS: EketVariantDef[] = [
  {
    id: 'open', w: 35, h: 35, label: t('eket.v.open'), product: t('eket.p.open'), icon: 'eketOpen',
    offers: {
      'blanc': o(24.99, 'eket-rangement-blanc-80334603'),
      'beige': o(24.99, 'eket-rangement-beige-70595525'),
      'bleu-gris-fonce': o(24.99, 'eket-rangement-bleu-gris-fonce-30595527'),
      'brun-noyer': o(24.99, 'eket-rangement-brun-motif-noyer-60530577'),
      'chene-blanchi': o(24.99, 'eket-rangement-effet-chene-blanchi-80428852'),
      'gris-fonce': o(24.99, 'eket-rangement-gris-fonce-50334591'),
      'lilas-pale': o(24.99, 'eket-rangement-lilas-pale-20595523'),
    },
  },
  {
    id: 'door', w: 35, h: 35, label: t('eket.v.door'), product: t('eket.p.door'), icon: 'eketDoor', note: t('eket.n.push'),
    offers: {
      'blanc': o(35, 'eket-armoire-1-porte-blanc-80332114'),
      'brun-noyer': o(35, 'eket-armoire-1-porte-brun-motif-noyer-60574590'),
      'gris-fonce': o(35, 'eket-armoire-1-porte-gris-fonce-90344927'),
    },
  },
  {
    id: 'glass', w: 35, h: 35, label: t('eket.v.glass'), product: t('eket.p.glass'), icon: 'eketGlass',
    note: t('eket.n.glass'), contents: t('eket.c.glass'), rail: true,
    offers: {
      'blanc': o(44.99, 'eket-element-mural-porte-vitree-blanc-s59336374'),
      'beige': o(44.99, 'eket-element-mural-porte-vitree-beige-s49602132'),
      'bleu-gris-fonce': o(44.99, 'eket-element-mural-porte-vitree-bleu-gris-fonce-s69602131'),
      'brun-noyer': o(44.99, 'eket-element-mural-porte-vitree-brun-motif-noyer-s79533019'),
      'chene-blanchi': o(44.99, 'eket-element-mural-porte-vitree-effet-chene-blanchi-s19336371'),
      'gris-fonce': o(44.99, 'eket-element-mural-porte-vitree-gris-fonce-s69336359'),
      'lilas-pale': o(44.99, 'eket-element-mural-porte-vitree-lilas-pale-s29602133'),
    },
  },
  {
    id: 'drawers', w: 35, h: 35, label: t('eket.v.drawers'), product: t('eket.p.drawers'), icon: 'eketDrawers', note: t('eket.n.drawers'),
    offers: {
      'blanc': o(50, 'eket-rangement-2-tiroirs-blanc-30428915'),
      'brun-noyer': o(50, 'eket-rangement-2-tiroirs-brun-motif-noyer-20574592'),
      'gris-fonce': o(50, 'eket-rangement-2-tiroirs-gris-fonce-30428920'),
    },
  },
  {
    id: 'door-shelf', w: 35, h: 70, label: t('eket.v.doorShelf'), product: t('eket.p.doorShelf'), icon: 'eketDoorTall', note: t('eket.n.doorShelf'),
    offers: {
      'blanc': o(50, 'eket-element-1-porte-et-1-tablette-blanc-90333938'),
      'brun-noyer': o(60, 'eket-element-1-porte-et-1-tablette-brun-motif-noyer-00574588'),
      'gris-fonce': o(50, 'eket-element-1-porte-et-1-tablette-gris-fonce-50344929'),
    },
  },
  {
    id: 'drawers-70', w: 70, h: 35, label: t('eket.v.drawers70'), product: t('eket.p.drawers70'), icon: 'eketDrawersWide', note: t('eket.n.drawers70'),
    offers: {
      'blanc': o(95, 'eket-rangement-2-tiroirs-blanc-00333947'),
      'brun-noyer': o(105, 'eket-rangement-2-tiroirs-brun-motif-noyer-80574594'),
      'gris-fonce': o(95, 'eket-rangement-2-tiroirs-gris-fonce-80344923'),
    },
  },
  {
    id: 'wall-drawers', w: 70, h: 35, label: t('eket.v.wallDrawers'), product: t('eket.p.wallDrawers'), icon: 'eketDrawersWide',
    note: t('eket.n.drawers70'), contents: t('eket.c.wallDrawers'), rail: true,
    offers: {
      'blanc': o(100, 'eket-combinaison-de-rangement-murale-avec-2-tiroirs-blanc-s49590370'),
      'brun-noyer': o(110, 'eket-combinaison-de-rangement-murale-avec-2-tiroirs-brun-motif-noyer-s09590372'),
      'gris-fonce': o(100, 'eket-combinaison-de-rangement-murale-avec-2-tiroirs-gris-fonce-s29590371'),
    },
  },
  {
    id: 'media', w: 70, h: 35, label: t('eket.v.media'), product: t('eket.p.media'), icon: 'eketMedia', note: t('eket.n.media'),
    offers: {
      'blanc': o(80, 'eket-tablette-media-blanc-90582027'),
      'brun-noyer': o(90, 'eket-tablette-media-brun-motif-noyer-00576479'),
      'gris-fonce': o(80, 'eket-tablette-media-gris-fonce-30582025'),
    },
  },
  {
    id: 'four', w: 70, h: 70, label: t('eket.v.four'), product: t('eket.p.four'), icon: 'eketFour', note: t('eket.n.four'),
    offers: {
      'blanc': o(60, 'eket-rangement-4-compartiments-blanc-60333954'),
      'brun-noyer': o(70, 'eket-rangement-4-compartiments-brun-motif-noyer-10574583'),
      'gris-fonce': o(60, 'eket-rangement-4-compartiments-gris-fonce-00334536'),
    },
  },
  {
    id: 'doors-shelf', w: 70, h: 70, label: t('eket.v.doorsShelf'), product: t('eket.p.doorsShelf'), icon: 'eketDoors', note: t('eket.n.doorsShelf'),
    offers: {
      'blanc': o(95, 'eket-element-2-portes-et-1-tablette-blanc-20333951'),
      'brun-noyer': o(105, 'eket-element-2-portes-et-1-tablette-brun-motif-noyer-20574587'),
      'gris-fonce': o(95, 'eket-element-2-portes-et-1-tablette-gris-fonce-20344921'),
    },
  },
];
export const EKET_BY_VARIANT = Object.fromEntries(EKET_VARIANTS.map(v => [v.id, v])) as Record<EketVariant, EketVariantDef>;

/** IKEA reference pages for EKET. */
export const EKET_LINKS = [
  { label: t('link.eketSeries'), url: 'https://www.ikea.com/fr/fr/cat/eket-systeme-59283/' },
  { label: t('link.eketCubes'), url: 'https://www.ikea.com/fr/fr/cat/etageres-et-armoires-cubiques-eket-59285/' },
];

export function eketDef(v: EketVariant | string | undefined): EketVariantDef {
  return EKET_BY_VARIANT[v as EketVariant] ?? EKET_BY_VARIANT.open;
}
export function eketSize(v: EketVariant | string | undefined, legs = false): { w: number; d: number; h: number } {
  const d = eketDef(v);
  return { w: d.w, d: EKET.depth, h: d.h + (legs ? EKET.legs : 0) };
}
/** Legs fit every floor-standing unit; wall-mounted sets (sold with their rail) are not offered on legs. */
export function eketLegsAllowed(v: EketVariant): boolean { return !eketDef(v).rail; }
export function eketColorsOf(v: EketVariant): EketColorId[] {
  return Object.keys(eketDef(v).offers) as EketColorId[];
}
export function eketColorSold(v: EketVariant, c: EketColorId): boolean {
  return !!eketDef(v).offers[c];
}
export function effectiveEketColor(it: EketItem, docColor: EketColorId | undefined): EketColorId {
  const c = it.finish ?? docColor ?? DEFAULT_EKET_COLOR;
  return EKET_COLOR_BY_ID[c] ? c : DEFAULT_EKET_COLOR;
}
/**
 * Price of a product in a colour. A colour the product is not sold in falls
 * back on the white price (else the first colour), flagged `exact: false`.
 */
export function eketPrice(v: EketVariant, c: EketColorId): { price: number; used: EketColorId; exact: boolean; url: string } {
  const d = eketDef(v);
  const hit = d.offers[c];
  if (hit) return { ...hit, used: c, exact: true };
  const used = (d.offers.blanc ? 'blanc' : Object.keys(d.offers)[0]) as EketColorId;
  return { ...d.offers[used]!, used, exact: false };
}
/** Lowest regular price of a product ("dès …"). */
export function eketMinPrice(v: EketVariant): number {
  return Math.min(...Object.values(eketDef(v).offers).map(x => x!.price));
}

/** Default item name ("EKET 2 portes"). */
export function eketDisplayName(v: EketVariant): string {
  return t('eket.name', { variant: eketDef(v).label });
}
/** "70×35×35" */
export function eketDims(v: EketVariant): string {
  const d = eketDef(v);
  return `${d.w}×${EKET.depth}×${d.h}`;
}
