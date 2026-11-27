// ─────────────────────────────────────────────────────────────
// Chairs: real IKEA models (dimensions, colours and product pages from
// ikea.com/fr and ikea.com/gb, Nov 2026). OWNED BY THE CHAIRS AGENT.
//
// Size = the chair's overall W × D × H (item AABB). Local axes: w along X,
// d along Y with the FRONT of the chair at y = 0 (facing −Y), h along Z.
// Colours: `hex` = main part (shell / upholstery / wood), `hex2` = secondary
// part (legs, frame, swivel base, seat pad) — geometry material group 1.
// Hex values are approximations picked from the IKEA product photos.
// ─────────────────────────────────────────────────────────────
import type { ObjectColor, ObjectDef, ObjectVariant } from './objects';
import type { Size3 } from './types';

const S = (w: number, d: number, h: number): Size3 => ({ w, d, h });
const C = (id: string, hex: string, hex2?: string): ObjectColor => ({ id, labelKey: `obj.chair.c.${id}`, hex, hex2 });

// Wood / metal tones shared by several models.
const EUCALYPTUS = '#8c5d3b';        // GRÖNSTA legs, brown-stained solid eucalyptus
const EUCALYPTUS_LIGHT = '#a9784f';
const EUCALYPTUS_DARK = '#5c3d29';
const BLACK_STEEL = '#26272a';
const WHITE_STEEL = '#eeeeec';
const CHROME = '#c3c7cc';

export const CHAIR_VARIANTS: ObjectVariant[] = [
  {
    // GRÖNSTA chair, in/outdoor — moulded polypropylene scoop shell on 4 eucalyptus legs.
    // W54 D48 H79, seat 48 × 42, seat height 45.
    id: 'groensta', labelKey: 'obj.chair.groensta', size: S(54, 48, 79),
    url: 'https://www.ikea.com/fr/fr/p/groensta-chaise-interieur-exterieur-blanc-70519763/',
    colors: [
      C('white', '#f1f1ee', EUCALYPTUS),
      C('whiteLightBrown', '#f1f1ee', EUCALYPTUS_LIGHT),
      C('greyTurquoise', '#7e979d', EUCALYPTUS_DARK),
      C('greyDarkBrown', '#56595b', EUCALYPTUS_DARK),
    ],
  },
  {
    // GRÖNSTA chair with armrests, in/outdoor — tub shell whose sides rise into armrests.
    // W59 D49 H78, seat width 38 (between the arms), seat depth 42, seat height 45.
    id: 'groenstaArm', labelKey: 'obj.chair.groenstaArm', size: S(59, 49, 78),
    url: 'https://www.ikea.com/fr/fr/p/groensta-chaise-a-accoudoirs-int-exterieur-blanc-90557886/',
    colors: [
      C('white', '#f1f1ee', EUCALYPTUS),
      C('whiteLightBrown', '#f1f1ee', EUCALYPTUS_LIGHT),
      C('greyTurquoise', '#7e979d', EUCALYPTUS_DARK),
      C('greyDarkBrown', '#56595b', EUCALYPTUS_DARK),
    ],
  },
  {
    // NORDMANSSKÄR chair — upholstered one-piece seat shell on a black steel 4-leg frame.
    // W44 D58 H85, seat 43 × 40, seat height 46.
    id: 'nordmansskaer', labelKey: 'obj.chair.nordmansskaer', size: S(44, 58, 85),
    url: 'https://www.ikea.com/fr/fr/p/nordmansskaer-chaise-noir-tonerud-gris-s99618215/',
    colors: [
      C('tonerudGrey', '#a5a69c', BLACK_STEEL),
      C('bomstadBlack', '#2c2c2d', BLACK_STEEL),
      C('letaforsYellowBeige', '#cdb46c', BLACK_STEEL),
    ],
  },
  {
    // TOSSBERG chair — upholstered tub with armrests on a steel sled base.
    // W60 D56 H82, seat 42 × 40, seat height 49, armrest height 64.
    id: 'tossberg', labelKey: 'obj.chair.tossberg', size: S(60, 56, 82),
    url: 'https://www.ikea.com/fr/fr/p/tossberg-chaise-metal-noir-gunnared-gris-fonce-10582644/',
    colors: [
      C('gunnaredDarkGrey', '#57595c', BLACK_STEEL),
      C('gunnaredBeige', '#d8d3c6', WHITE_STEEL),
      C('gunnaredLightGreen', '#a9b29a', BLACK_STEEL),
    ],
  },
  {
    // LISABO chair — solid ash / ash veneer, curved back rest, X underframe.
    // W46 D51 H80, seat 44 × 39, seat height 45.
    id: 'lisabo', labelKey: 'obj.chair.lisabo', size: S(46, 51, 80),
    url: 'https://www.ikea.com/fr/fr/p/lisabo-chaise-frene-00457235/',
    colors: [
      C('ash', '#dcc39c'),
      C('black', '#2b2a29'),
    ],
  },
  {
    // LISABO chair with the Tallmyra seat pad (seat height 48).
    id: 'lisaboTallmyra', labelKey: 'obj.chair.lisaboTallmyra', size: S(46, 51, 80),
    url: 'https://www.ikea.com/fr/fr/p/lisabo-chaise-frene-tallmyra-blanc-noir-30553706/',
    colors: [
      C('ashTallmyra', '#dcc39c', '#b7b7b3'),
      C('blackTallmyra', '#2b2a29', '#4b4d51'),
    ],
  },
  {
    // IKEA PS 2026 chair — round upholstered seat, 4 square legs (the rear one rising
    // into the back post), "+" brace, cylindrical bolster back rest (Knäbäck fabric).
    // W44 D55 H76, seat Ø41 (38 × 38 usable), seat height 47.
    id: 'ps2026', labelKey: 'obj.chair.ps2026', size: S(44, 55, 76),
    url: 'https://www.ikea.com/fr/fr/p/ikea-ps-2026-chaise-vert-vif-knaebaeck-vert-vif-50617967/',
    colors: [
      C('brightGreen', '#14894a'),
      C('brightBlue', '#1f5cc8'),
    ],
  },
  {
    // DYVLINGE swivel easy chair — tufted seat + back cushions on a chrome 5-star swivel base.
    // W63 D75 H68, seat 63 × 47, seat height 43.
    id: 'dyvlinge', labelKey: 'obj.chair.dyvlinge', size: S(63, 75, 68),
    url: 'https://www.ikea.com/fr/fr/p/dyvlinge-siege-pivotant-kelinge-orange-00581918/',
    colors: [
      C('kelingeOrange', '#df6f2b', CHROME),
      C('kelingeBeige', '#cec3ae', CHROME),
      C('kelingeBlack', '#2f2f30', CHROME),
      C('kelingeGreen', '#2f9a40', CHROME),
      C('lidsbronBlack', '#2a2b2d', CHROME),
    ],
  },
];

export const CHAIR_DEF: ObjectDef = {
  shape: 'chair', group: 'objects', labelKey: 'obj.chair', icon: 'chair',
  size: CHAIR_VARIANTS[0].size, editable: [],
  defaultVariant: 'groensta',
  variants: CHAIR_VARIANTS,
};
