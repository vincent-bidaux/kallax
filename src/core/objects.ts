// ─────────────────────────────────────────────────────────────
// Object catalogue for the library: 3 groups (Blocks / House / Objects),
// default sizes and preset variants. Sizes in cm, local axes:
// w along X (width), d along Y (depth, front at y = 0), h along Z.
// ─────────────────────────────────────────────────────────────
import type { BlockShape, Size3 } from './types';

export type ObjectGroup = 'blocks' | 'house' | 'objects';

export interface ObjectColor {
  id: string;
  /** i18n key of the colour name. */
  labelKey: string;
  /** Main colour (sRGB hex). */
  hex: string;
  /** Optional secondary colour (frame / legs / cushion…). */
  hex2?: string;
}

export interface ObjectVariant {
  id: string;
  /** i18n key of the chip label. */
  labelKey: string;
  size: Size3;
  /** Optional chip group (i18n key), e.g. plant style "Fournie" — UI shows chips grouped. */
  groupKey?: string;
  /** Colour options for this variant (first = default). */
  colors?: ObjectColor[];
  /** Product link (IKEA page…). */
  url?: string;
  /** i18n key of the full default item name, when "type + variant" reads badly ("Lampadaire arc"). */
  nameKey?: string;
  /** i18n key of a short note shown under the size (e.g. "réglable 63–127 cm"). */
  noteKey?: string;
  /** Library / inspector glyph for this variant (else the type icon). */
  icon?: string;
  /**
   * Hanging part (cm) below the object's resting plane, on its FRONT side
   * (local −Y): trailing plants put on a shelf. The item box includes it;
   * drops put the resting plane (pot base) on the surface and only the front
   * strip `hangDepth` deep may go below it (see interaction/placement.ts).
   */
  hang?: number;
  hangDepth?: number;
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

/** Bed: base + mattress slab 20 cm thick, pillows (12 cm) on top → item box 32 cm high. */
export const BED_SLAB = 20;
export const BED_PILLOW = 12;
const BED = (w: number, d: number): Size3 => ({ w, d, h: BED_SLAB + BED_PILLOW });
const LAMP_TABLE = 'obj.lamp.gTable', LAMP_FLOOR = 'obj.lamp.gFloor';
const PLANT_CLASSIC = 'obj.plant.gClassic', PLANT_BUSHY = 'obj.plant.gBushy', PLANT_TRAIL = 'obj.plant.gTrailing';

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
    // Table lamps (28 / 50 cm) and floor lamps. Floor-lamp sizes follow common
    // models: ÅRSTID 155 cm (shade Ø36, base Ø28), tripod ~150, arc ~190 with
    // ~1 m reach, slim reading lamp ~140.
    shape: 'lamp', group: 'objects', labelKey: 'obj.lamp', icon: 'lamp', size: { w: 18, d: 18, h: 28 }, editable: [],
    defaultVariant: 'h28',
    variants: [
      { id: 'h28', groupKey: LAMP_TABLE, labelKey: 'obj.lamp.h28', size: { w: 18, d: 18, h: 28 } },
      { id: 'h50', groupKey: LAMP_TABLE, labelKey: 'obj.lamp.h50', size: { w: 30, d: 30, h: 50 } },
      {
        id: 'floor', groupKey: LAMP_FLOOR, labelKey: 'obj.lamp.floor', nameKey: 'obj.lamp.floor.name', icon: 'floorLamp',
        size: { w: 36, d: 36, h: 155 }, url: 'https://www.ikea.com/fr/fr/p/-00321317/',
      },
      { id: 'tripod', groupKey: LAMP_FLOOR, labelKey: 'obj.lamp.tripod', nameKey: 'obj.lamp.tripod.name', icon: 'floorLamp', size: { w: 58, d: 58, h: 150 } },
      { id: 'arc', groupKey: LAMP_FLOOR, labelKey: 'obj.lamp.arc', nameKey: 'obj.lamp.arc.name', noteKey: 'obj.lamp.arc.note', icon: 'arcLamp', size: { w: 40, d: 130, h: 190 } },
      { id: 'reading', groupKey: LAMP_FLOOR, labelKey: 'obj.lamp.reading', nameKey: 'obj.lamp.reading.name', icon: 'floorLamp', size: { w: 26, d: 40, h: 140 } },
    ],
  },
  {
    // Classic potted plant, bushy plant (dense, wider) and trailing plant
    // (pothos-like, for a shelf: the stems hang over the FRONT of the pot,
    // below its base — see ObjectVariant.hang).
    shape: 'plant', group: 'objects', labelKey: 'obj.plant', icon: 'plant', size: { w: 30, d: 30, h: 50 }, editable: [],
    defaultVariant: 'h50',
    variants: [
      { id: 'h35', groupKey: PLANT_CLASSIC, labelKey: 'obj.plant.h35', size: { w: 24, d: 24, h: 35 } },
      { id: 'h50', groupKey: PLANT_CLASSIC, labelKey: 'obj.plant.h50', size: { w: 32, d: 32, h: 50 } },
      { id: 'h75', groupKey: PLANT_CLASSIC, labelKey: 'obj.plant.h75', size: { w: 44, d: 44, h: 75 } },
      { id: 'b40', groupKey: PLANT_BUSHY, labelKey: 'obj.plant.b40', nameKey: 'obj.plant.b40.name', size: { w: 42, d: 42, h: 40 } },
      { id: 'b60', groupKey: PLANT_BUSHY, labelKey: 'obj.plant.b60', nameKey: 'obj.plant.b60.name', size: { w: 58, d: 58, h: 60 } },
      { id: 'b90', groupKey: PLANT_BUSHY, labelKey: 'obj.plant.b90', nameKey: 'obj.plant.b90.name', size: { w: 78, d: 78, h: 90 } },
      {
        id: 't40', groupKey: PLANT_TRAIL, labelKey: 'obj.plant.t40', nameKey: 'obj.plant.t40.name', noteKey: 'obj.plant.t40.note', icon: 'plantTrailing',
        size: { w: 30, d: 23, h: 52 }, hang: 30, hangDepth: 7,
      },
      {
        id: 't70', groupKey: PLANT_TRAIL, labelKey: 'obj.plant.t70', nameKey: 'obj.plant.t70.name', noteKey: 'obj.plant.t70.note', icon: 'plantTrailing',
        size: { w: 38, d: 29, h: 84 }, hang: 55, hangDepth: 8,
      },
    ],
  },
];

// Extra object definitions contributed by feature modules (chairs, desks…).
import { CHAIR_DEF } from './objects-chairs';
import { DESK_DEF } from './objects-desks';
OBJECT_DEFS.push(DESK_DEF, CHAIR_DEF);

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

export function colorOf(shape: BlockShape, variantId: string | undefined, colorId: string | undefined): ObjectColor | undefined {
  const v = variantOf(shape, variantId);
  if (!v?.colors?.length) return undefined;
  return v.colors.find(c => c.id === colorId) ?? v.colors[0];
}
