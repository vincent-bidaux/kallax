// ─────────────────────────────────────────────────────────────
// Human figure ("Humain"): a stylised standing mannequin to check the scale
// of a composition (an adult 1.80 m next to a KALLAX 147 cm) and to start the
// first-person walk from (interaction/walk/*).
//
//   · adult man 180 cm, eye height 168 cm, shoulders (bideltoid) ~47 cm,
//     chest depth ~22 cm, feet ~27 cm long;
//   · child ~10 years old, 140 cm, eye height 130 cm (relatively bigger head,
//     shorter limbs, narrower shoulders).
//
// Size = the figure's overall W × D × H (arms slightly apart, feet included).
// Local axes: w along X, d along Y with the FRONT (face, toes) at y = 0,
// facing −Y, h along Z. Geometry: render/furniture-human.ts.
// Not furniture: no price, and collisions are off by default for new humans
// (`collideDefault`), like a person who can stand anywhere.
// ─────────────────────────────────────────────────────────────
import type { ObjectColor, ObjectDef, ObjectVariant } from './objects';
import type { Size3 } from './types';

export type HumanVariant = 'adult' | 'child';

/** Eye height above the floor (cm) — also the walk-mode camera height. */
export const HUMAN_EYE: Record<HumanVariant, number> = { adult: 168, child: 130 };
/** Overall standing height (cm). */
export const HUMAN_HEIGHT: Record<HumanVariant, number> = { adult: 180, child: 140 };

const S = (w: number, d: number, h: number): Size3 => ({ w, d, h });
const C = (id: string, hex: string): ObjectColor => ({ id, labelKey: `obj.human.c.${id}`, hex });

/** Neutral mannequin colours (first = default). */
const HUMAN_COLORS: ObjectColor[] = [
  C('lightGrey', '#d4d5d3'),
  C('sand', '#d6c2a4'),
  C('blue', '#8ea7c6'),
  C('graphite', '#5a5c60'),
];

export const HUMAN_VARIANTS: ObjectVariant[] = [
  { id: 'adult', labelKey: 'obj.human.adult', nameKey: 'obj.human.adult.name', noteKey: 'obj.human.adult.note', icon: 'human', size: S(53.5, 30.5, 180), colors: HUMAN_COLORS },
  { id: 'child', labelKey: 'obj.human.child', nameKey: 'obj.human.child.name', noteKey: 'obj.human.child.note', icon: 'humanChild', size: S(38, 23.5, 140), colors: HUMAN_COLORS },
];

export const HUMAN_DEF: ObjectDef = {
  shape: 'human', group: 'objects', labelKey: 'obj.human', icon: 'human',
  size: HUMAN_VARIANTS[0].size, editable: [],
  defaultVariant: 'adult',
  variants: HUMAN_VARIANTS,
  collideDefault: false,
};

export function humanVariant(id: string | undefined): HumanVariant {
  return id === 'child' ? 'child' : 'adult';
}
