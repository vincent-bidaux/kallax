// Translated labels / default names of catalogue objects (core/objects.ts).
import { OBJECT_BY_SHAPE, colorOf, variantOf } from '../core/objects';
import type { BlockItem, BlockShape, Item, ObjOpts } from '../core/types';
import { t, locale, type TKey, type Translator } from '../core/i18n';
import { isWallHung, tvInch, wallHungBaseZ } from '../core/objects-params';
import { fmtCm } from '../core/kallax';

/** Screen diagonal label: 55″. */
export const fmtInch = (v: number) => `${fmtCm(v)}\u2033`;

/** Lower-case the first letter, unless the first word is an acronym / IKEA name ("GRÖNSTA", "LACK"). */
const lower = (s: string) => {
  const w = s.split(/[\s/]/)[0];
  if (w.length > 1 && w === w.toLocaleUpperCase(locale) && w !== w.toLocaleLowerCase(locale)) return s;
  return s.charAt(0).toLocaleLowerCase(locale) + s.slice(1);
};

/** Translated type label ("Porte", "Lit"…). Legacy blocks without a shape are bricks. */
export function objLabel(shape: BlockShape | undefined, tr: Translator = t): string {
  const def = OBJECT_BY_SHAPE[shape ?? 'box'];
  return def ? tr(def.labelKey as TKey) : tr('obj.brick');
}

/** Translated variant label ("Double 140", "28 cm"), or '' for free-size objects. */
export function variantLabel(shape: BlockShape | undefined, id: string | undefined, tr: Translator = t): string {
  if (!shape) return '';
  const v = variantOf(shape, id);
  return v ? tr(v.labelKey as TKey) : '';
}

/** Translated type group of a variant ("Sur pied", "Tombante"…), or ''. */
export function groupLabel(shape: BlockShape | undefined, id: string | undefined): string {
  const g = shape ? variantOf(shape, id)?.groupKey : undefined;
  return g ? t(g as TKey) : '';
}

/** Translated colour name of an item's colour option (default colour when unset), or ''. */
export function colorLabel(shape: BlockShape | undefined, variant: string | undefined, color: string | undefined): string {
  const c = shape ? colorOf(shape, variant, color) : undefined;
  return c ? t(c.labelKey as TKey) : '';
}

/**
 * Default item name: the variant's own name when it has one ("Lampadaire arc",
 * "Bureau MICKE"), else type label + variant ("Lit double 140" / "Double 140 bed").
 */
export function autoName(shape: BlockShape | undefined, variant?: string, tr: Translator = t, opts?: ObjOpts): string {
  if (shape === 'tv') return tr('obj.tv.name', { inch: fmtInch(tvInch({ opts })) });
  const own = shape ? variantOf(shape, variant)?.nameKey : undefined;
  if (own) return tr(own as TKey);
  const type = objLabel(shape, tr);
  const v = variantLabel(shape, variant, tr);
  if (!v) return type;
  // the variant already names the type ("GRÖNSTA chair", "DYVLINGE swivel easy chair"): use it as is
  if (new RegExp(`(^|\\s)${type.toLocaleLowerCase(locale)}(\\s|$)`, 'u').test(v.toLocaleLowerCase(locale))) return v;
  return tr('obj.variantName', { type, typeLower: lower(type), variant: v, variantLower: lower(v) });
}

/** Default name of an item, given its current shape / variant. */
export function isAutoName(it: BlockItem, name = it.name): boolean {
  return name === autoName(it.shape, it.variant, t, it.opts) || name === objLabel(it.shape);
}

/** Base height of an object dropped on the floor (window sill, radiator…). */
export function baseZOf(shape: BlockShape | undefined): number {
  return (shape && OBJECT_BY_SHAPE[shape]?.baseZ) || 0;
}

/** Base height of a NEW item dropped on the floor: wall-hung objects at their default height (frame centre 150, wall TV 115), else baseZOf. */
export function itemBaseZ(it: Item): number {
  if (it.kind !== 'block') return 0;
  return wallHungBaseZ(it) ?? baseZOf(it.shape);
}

/** Item version of standsOnFloor: wall-hung objects (frames, wall TV) hang where the pointer is. */
export function itemStandsOnFloor(it: Item): boolean {
  return it.kind === 'block' && !isWallHung(it) && standsOnFloor(it.shape);
}

/** Objects that stand on the floor even when dropped against a wall face. */
export function standsOnFloor(shape: BlockShape | undefined): boolean {
  return shape === 'door' || shape === 'skirting' || (!!shape && OBJECT_BY_SHAPE[shape]?.group === 'objects');
}
