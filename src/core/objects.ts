// ─────────────────────────────────────────────────────────────
// Object catalogue for the library: 3 groups (Blocks / House / Objects),
// default sizes and preset variants. Sizes in cm, local axes:
// w along X (width), d along Y (depth, front at y = 0), h along Z.
// ─────────────────────────────────────────────────────────────
import type { BlockShape, Size3 } from './types';

export type ObjectGroup = 'blocks' | 'house' | 'objects';

export interface ObjectVariant {
  id: string;
  /** i18n key of the chip label. */
  labelKey: string;
  size: Size3;
}

export interface ObjectDef {
  shape: BlockShape;
  group: ObjectGroup;
  /** i18n key of the type label (also the default item name). */
  labelKey: string;
  icon: string;
  /** Free-size objects: default size; variant objects: size of the default variant. */
  size: Size3;
  variants?: ObjectVariant[];
  defaultVariant?: string;
  /** Which dimensions the user can edit (others come from the variant). */
  editable: ('w' | 'd' | 'h')[];
  /** Default base height when dropped on the floor. */
  baseZ?: number;
  /** Structure of the room: not furniture, not in the shopping list. */
  structure?: boolean;
  /** Openings cut through walls they are placed on. */
  cutsWalls?: boolean;
}

/** Bed: mattress + base slab 20 cm thick. */
const BED = (w: number, d: number): Size3 => ({ w, d, h: 20 });

export const OBJECT_DEFS: ObjectDef[] = [
  // ── Blocks ──
  { shape: 'box', group: 'blocks', labelKey: 'obj.brick', icon: 'box', size: { w: 40, d: 20, h: 20 }, editable: ['w', 'd', 'h'] },
  { shape: 'cylinder', group: 'blocks', labelKey: 'obj.roundBeam', icon: 'cylinder', size: { w: 200, d: 12, h: 12 }, editable: [] },
  { shape: 'square', group: 'blocks', labelKey: 'obj.squareBeam', icon: 'beamSquare', size: { w: 200, d: 10, h: 10 }, editable: [] },
  // ── House ──
  { shape: 'wall', group: 'house', labelKey: 'obj.wall', icon: 'wall', size: { w: 300, d: 0, h: 250 }, editable: ['w', 'h'], structure: true },
  { shape: 'window', group: 'house', labelKey: 'obj.window', icon: 'window', size: { w: 120, d: 7, h: 135 }, editable: ['w', 'd', 'h'], baseZ: 90, structure: true, cutsWalls: true },
  { shape: 'door', group: 'house', labelKey: 'obj.door', icon: 'door', size: { w: 83, d: 4, h: 204 }, editable: ['w', 'd', 'h'], structure: true, cutsWalls: true },
  { shape: 'skirting', group: 'house', labelKey: 'obj.skirting', icon: 'skirting', size: { w: 200, d: 1.5, h: 8 }, editable: ['w', 'd', 'h'], structure: true },
  { shape: 'radiator', group: 'house', labelKey: 'obj.radiator', icon: 'radiator', size: { w: 80, d: 10, h: 60 }, editable: ['w', 'd', 'h'], baseZ: 15, structure: true },
  // ── Objects ──
  {
    shape: 'bed', group: 'objects', labelKey: 'obj.bed', icon: 'bed', size: BED(140, 190), editable: [],
    defaultVariant: 'double',
    variants: [
      { id: 'single', labelKey: 'obj.bed.single', size: BED(90, 190) },
      { id: 'double', labelKey: 'obj.bed.double', size: BED(140, 190) },
      { id: 'queen', labelKey: 'obj.bed.queen', size: BED(160, 200) },
      { id: 'king', labelKey: 'obj.bed.king', size: BED(180, 200) },
    ],
  },
  {
    shape: 'lamp', group: 'objects', labelKey: 'obj.lamp', icon: 'lamp', size: { w: 18, d: 18, h: 28 }, editable: [],
    defaultVariant: 'h28',
    variants: [
      { id: 'h28', labelKey: 'obj.lamp.h28', size: { w: 18, d: 18, h: 28 } },
      { id: 'h50', labelKey: 'obj.lamp.h50', size: { w: 30, d: 30, h: 50 } },
    ],
  },
  {
    shape: 'plant', group: 'objects', labelKey: 'obj.plant', icon: 'plant', size: { w: 30, d: 30, h: 50 }, editable: [],
    defaultVariant: 'h50',
    variants: [
      { id: 'h35', labelKey: 'obj.plant.h35', size: { w: 24, d: 24, h: 35 } },
      { id: 'h50', labelKey: 'obj.plant.h50', size: { w: 32, d: 32, h: 50 } },
      { id: 'h75', labelKey: 'obj.plant.h75', size: { w: 44, d: 44, h: 75 } },
    ],
  },
];

export const OBJECT_BY_SHAPE = Object.fromEntries(OBJECT_DEFS.map(d => [d.shape, d])) as Record<BlockShape, ObjectDef>;
export const OBJECT_GROUPS: { id: ObjectGroup; labelKey: string }[] = [
  { id: 'blocks', labelKey: 'obj.group.blocks' },
  { id: 'house', labelKey: 'obj.group.house' },
  { id: 'objects', labelKey: 'obj.group.objects' },
];

export function variantOf(shape: BlockShape, id: string | undefined): ObjectVariant | undefined {
  const def = OBJECT_BY_SHAPE[shape];
  return def?.variants?.find(v => v.id === (id ?? def.defaultVariant));
}

/** Door / window cut holes in walls. */
export function cutsWalls(shape: BlockShape | undefined): boolean {
  return !!shape && !!OBJECT_BY_SHAPE[shape]?.cutsWalls;
}
