// ─────────────────────────────────────────────────────────────
// Desks & tables (IKEA-like models). OWNED BY THE FURNITURE AGENT.
//
// Heights (research, Nov 2026):
//   · office desk, fixed height: 74–76 cm (EN 527-1 / NEN 527), IKEA desks 73–75 cm
//   · sit-stand desk: 65–125 cm (EN 527); IDÅSEN 63–127, BEKANT 65–85 (feet)
//   · dining table: 71–76 cm (75 typical), IKEA 74–75
//   · coffee table: 40–45 cm (LACK 45)
// Sizes from the IKEA product pages (LAGKAPTEN/ALEX 120×60×73, MICKE
// 105×50×75, BEKANT 160×80 h 65–85, IDÅSEN 160×80 h 63–127, MELLTORP
// 125×75, PINNTORP Ø85×75, LACK 90×55×45).
//
// Local axes: w along X, d along Y (the user's side / FRONT at y = 0), h up.
// Colours: `hex` = main part (table top, drawer fronts), `hex2` = secondary
// part (legs, frame, drawer unit) — geometry material group 1 (see
// render/furniture-desks.ts). Hex values approximate the IKEA finishes.
// ─────────────────────────────────────────────────────────────
import type { ObjectColor, ObjectDef, ObjectVariant } from './objects';
import type { Size3 } from './types';

const S = (w: number, d: number, h: number): Size3 => ({ w, d, h });
const C = (id: string, hex: string, hex2?: string): ObjectColor => ({ id, labelKey: `obj.desk.c.${id}`, hex, hex2 });
const DESK = 'obj.desk.gDesk', TABLE = 'obj.desk.gTable';
const ikea = (art: string) => `https://www.ikea.com/fr/fr/p/-${art}/`;

// IKEA finishes (approximate sRGB)
const WHITE = '#f1f1ee';
const BLACK_BROWN = '#3a3230';
const OAK_WHITE = '#d8c7a8';      // white-stained oak effect
const GREY_WOOD = '#8e8982';      // grey wood effect
const BLACK = '#262627';
const BEIGE = '#d6ccb8';
const DARK_GREY = '#4d4e51';
const ASH_BLACK = '#2e2c2a';      // black-stained ash veneer
const ASH_BROWN = '#7a573d';      // brown-stained ash veneer
const PINE = '#b98b5f';           // light brown stained pine

export const DESK_VARIANTS: ObjectVariant[] = [
  // ── desks ──
  {
    // Plain desk: table top + 4 round legs (LAGKAPTEN/ADILS-like), EN 527 height.
    id: 'simple', groupKey: DESK, labelKey: 'obj.desk.simple', nameKey: 'obj.desk.simple.name', size: S(120, 60, 74),
    colors: [C('white', WHITE, WHITE), C('blackBrown', BLACK_BROWN, BLACK), C('oakWhite', OAK_WHITE, WHITE)],
  },
  {
    // LAGKAPTEN / ALEX: top 120×60, ALEX 5-drawer unit (36×58×70) on the left, 2 legs on the right.
    id: 'alex', groupKey: DESK, labelKey: 'obj.desk.alex', nameKey: 'obj.desk.alex.name', size: S(120, 60, 73),
    url: ikea('s69416817'),
    colors: [C('white', WHITE, WHITE), C('oakWhite', OAK_WHITE, WHITE), C('greyWoodBlack', GREY_WOOD, BLACK)],
  },
  {
    // MICKE: 105×50×75, side panel, drawer unit with drawer + open shelf, back (modesty) panel.
    id: 'micke', groupKey: DESK, labelKey: 'obj.desk.micke', nameKey: 'obj.desk.micke.name', size: S(105, 50, 75),
    url: ikea('80213074'),
    colors: [C('white', WHITE, WHITE), C('blackBrown', BLACK_BROWN, BLACK_BROWN), C('oakWhite', OAK_WHITE, WHITE)],
  },
  {
    // BEKANT 160×80: T-leg frame, height adjustable 65–85 with the feet (shown at 74).
    id: 'bekant', groupKey: DESK, labelKey: 'obj.desk.bekant', nameKey: 'obj.desk.bekant.name', noteKey: 'obj.desk.bekant.note', size: S(160, 80, 74),
    url: ikea('s19022808'),
    colors: [C('white', WHITE, WHITE), C('whiteBlack', WHITE, BLACK), C('oakWhiteBlack', OAK_WHITE, BLACK), C('ashBlack', ASH_BLACK, BLACK)],
  },
  {
    // IDÅSEN sit/stand 160×80, electric, 63–127 cm (shown at the 74 cm sitting height).
    id: 'idasen', groupKey: DESK, labelKey: 'obj.desk.idasen', nameKey: 'obj.desk.idasen.name', noteKey: 'obj.desk.idasen.note', size: S(160, 80, 74),
    url: ikea('s99280978'),
    colors: [C('blackBeige', ASH_BLACK, BEIGE), C('blackDarkGrey', ASH_BLACK, DARK_GREY), C('brownBeige', ASH_BROWN, BEIGE), C('brownDarkGrey', ASH_BROWN, DARK_GREY)],
  },
  // ── tables ──
  {
    // MELLTORP 125×75 (4 seats): top + apron + 4 square steel legs.
    id: 'dining', groupKey: TABLE, labelKey: 'obj.desk.dining', nameKey: 'obj.desk.dining.name', noteKey: 'obj.desk.dining.note', size: S(125, 75, 74),
    url: ikea('s19011777'), icon: 'table',
    colors: [C('white', WHITE, WHITE)],
  },
  {
    // PINNTORP round table Ø85 (2–4 seats), solid pine, 4 legs + apron.
    id: 'round', groupKey: TABLE, labelKey: 'obj.desk.round', nameKey: 'obj.desk.round.name', noteKey: 'obj.desk.round.note', size: S(85, 85, 75),
    url: ikea('30637834'), icon: 'tableRound',
    colors: [C('pineWhite', PINE, '#ece7dc'), C('pineBlack', PINE, BLACK)],
  },
  {
    // LACK coffee table 90×55×45: thick top, 4 square legs, lower shelf.
    id: 'coffee', groupKey: TABLE, labelKey: 'obj.desk.coffee', nameKey: 'obj.desk.coffee.name', size: S(90, 55, 45),
    url: ikea('90449905'), icon: 'tableLow',
    colors: [C('white', WHITE, WHITE), C('blackBrown', BLACK_BROWN, BLACK_BROWN), C('oakWhite', OAK_WHITE, OAK_WHITE)],
  },
];

export const DESK_DEF: ObjectDef = {
  shape: 'desk', group: 'objects', labelKey: 'obj.desk', icon: 'desk', size: DESK_VARIANTS[0].size, editable: [],
  defaultVariant: 'simple',
  variants: DESK_VARIANTS,
};
