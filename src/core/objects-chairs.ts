// Chairs (IKEA models). OWNED BY THE CHAIRS AGENT — placeholder.
import type { ObjectDef } from './objects';
export const CHAIR_DEF: ObjectDef = {
  shape: 'chair', group: 'objects', labelKey: 'obj.chair', icon: 'chair', size: { w: 45, d: 50, h: 80 }, editable: [],
  defaultVariant: 'basic',
  variants: [{ id: 'basic', labelKey: 'obj.chair', size: { w: 45, d: 50, h: 80 } }],
};
