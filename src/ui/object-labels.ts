// Translated labels / default names of catalogue objects (core/objects.ts).
import { OBJECT_BY_SHAPE, variantOf } from '../core/objects';
import type { BlockItem, BlockShape } from '../core/types';
import { t, locale, type TKey } from '../core/i18n';

const lower = (s: string) => s.charAt(0).toLocaleLowerCase(locale) + s.slice(1);

/** Translated type label ("Porte", "Lit"…). Legacy blocks without a shape are bricks. */
export function objLabel(shape: BlockShape | undefined): string {
  const def = OBJECT_BY_SHAPE[shape ?? 'box'];
  return def ? t(def.labelKey as TKey) : t('obj.brick');
}

/** Translated variant label ("Double 140", "28 cm"), or '' for free-size objects. */
export function variantLabel(shape: BlockShape | undefined, id: string | undefined): string {
  if (!shape) return '';
  const v = variantOf(shape, id);
  return v ? t(v.labelKey as TKey) : '';
}

/** Default item name: type label, plus the variant ("Lit double 140" / "Double 140 bed"). */
export function autoName(shape: BlockShape | undefined, variant?: string): string {
  const type = objLabel(shape);
  const v = variantLabel(shape, variant);
  if (!v) return type;
  return t('obj.variantName', { type, typeLower: lower(type), variant: v, variantLower: lower(v) });
}

/** Default name of an item, given its current shape / variant. */
export function isAutoName(it: BlockItem, name = it.name): boolean {
  return name === autoName(it.shape, it.variant) || name === objLabel(it.shape);
}

/** Base height of an object dropped on the floor (window sill, radiator…). */
export function baseZOf(shape: BlockShape | undefined): number {
  return (shape && OBJECT_BY_SHAPE[shape]?.baseZ) || 0;
}

/** Objects that stand on the floor even when dropped against a wall face. */
export function standsOnFloor(shape: BlockShape | undefined): boolean {
  return shape === 'door' || shape === 'skirting' || (!!shape && OBJECT_BY_SHAPE[shape]?.group === 'objects');
}
