// ─────────────────────────────────────────────────────────────
// Kallax Designer — shared model types
// Units: centimetres everywhere.
// World axes (Z-up, like an architecture / CAD tool):
//   X → right (width)   Y → back (depth)   Z → up (height)
// Origin (0,0,0) is the grid origin, drawn with an axis gizmo.
// An item's `position` is the MIN corner of its world AABB
// (left / front / bottom corner).
// ─────────────────────────────────────────────────────────────

export interface Vec3 { x: number; y: number; z: number }
export interface Size3 { w: number; d: number; h: number } // along X, Y, Z (world, after rotation)

/** Rotation about the vertical Z axis, degrees, counter-clockwise seen from above. */
export type Rotation = 0 | 90 | 180 | 270;

interface ItemBase {
  id: string;
  name: string;
  position: Vec3;
  /** Rotation about Z (vertical). */
  rotation: Rotation;
  /** Extra 90° steps about X and Y (see core/orient.ts). Absent = upright. */
  tilt?: { x: Rotation; y: Rotation };
  layerId: string;
}

/** A KALLAX shelving unit: `cols` cells wide × `rows` cells high. Open front and back. */
export interface KallaxItem extends ItemBase {
  kind: 'kallax';
  cols: number;
  rows: number;
  /** KALLAX underframe ("piètement" / "support"): raises the unit by KALLAX.legs. */
  legs?: boolean;
  /** Underframe colour (absent = white). */
  legsColor?: import('./finishes').KallaxLegsColor;
  /** Cell fittings, keyed "col,row" (col from the left, row from the bottom, as seen from the front). */
  inserts?: Record<string, InsertType>;
  /** Finish override (else the document's global finish). */
  finish?: import('./finishes').FinishId;
}

/** KALLAX cell fittings ("habillage"). */
export type InsertType = 'door' | 'drawers' | 'basket' | 'shelf';

/** Free rectangular block to simulate custom objects (radiator, window sill, bed…). */
export interface BlockItem extends ItemBase {
  kind: 'block';
  /** Local size before rotation: w along local X, d along local Y, h along Z. */
  size: Size3;
  /**
   * 'cylinder' = round beam ("poutre ronde"). Its axis is local X when
   * `axis === 'x'` (size = length × Ø × Ø) or Z when `axis === 'z'` (Ø × Ø × length).
   * 'square' = square-section beam (same size convention as the cylinder, side = Ø).
   * 'wall' = opaque plane (no thickness: size.d = 0) that masks what is behind it.
   * 'window' = 2-casement window: frame w × d × h, glazed openings.
   */
  shape?: BlockShape;
  axis?: 'x' | 'z';
  /** Preset variant for objects with options (bed size, lamp / plant height). See core/objects.ts. */
  variant?: string;
  /** Door: handle on the left instead of the right (as seen from the front). */
  mirror?: boolean;
  /** Colour option id for objects that have colours (e.g. IKEA chair colours). See ObjectVariant.colors. */
  color?: string;
  /**
   * Collisions ("Collisions" switch). Absent = on. `false`: the object may
   * overlap anything and anything may overlap it (magnetic snapping unchanged).
   */
  collide?: false;
}

/**
 * An EKET cube cabinet (35 × 35 × 35 cm): open, with a door, a glass door or
 * 2 drawers (see core/eket.ts). Furniture: priced, finish-coloured, collides.
 */
export interface EketItem extends ItemBase {
  kind: 'eket';
  /** Version id (core/eket.ts EKET_VARIANTS). */
  variant: import('./eket').EketVariant;
  /** Colour override (else the document's EKET colour). */
  finish?: import('./eket').EketColorId;
  /** EKET legs (4 × 10 cm), raising the unit by EKET.legs. Absent = none. */
  legs?: import('./eket').EketLegId;
}

/**
 * Block shapes. Blocks: 'box' (brique), 'cylinder' (round beam), 'square' (square beam).
 * House: 'wall', 'window', 'door', 'skirting', 'radiator'. Objects: 'bed', 'lamp', 'plant'.
 */
export type BlockShape =
  | 'box' | 'cylinder' | 'square'
  | 'wall' | 'window' | 'door' | 'skirting' | 'radiator'
  | 'bed' | 'lamp' | 'plant' | 'desk' | 'chair';

export type Item = KallaxItem | BlockItem | EketItem;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface DesignDoc {
  version: 1;
  name: string;
  items: Item[];
  layers: Layer[];
  activeLayerId: string;
  /** Global finish for every KALLAX (each unit can override it). */
  finish?: import('./finishes').FinishId;
  /** BRANÄS basket variant. */
  basket?: import('./finishes').BasketVariant;
  /** Default colour of every EKET cube (each one can override it). */
  eketFinish?: import('./eket').EketColorId;
}

export type ThemeName = 'blueprint' | 'paper';
export type Projection = 'perspective' | 'orthographic';
/** Camera presets. 'free' = user orbited away from any preset. */
export type ViewPreset =
  | 'iso' | 'cavalier' | 'free'
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Settings {
  theme: ThemeName;
  /** Lit faces + cast shadows on the floor. */
  shadows: boolean;
  /** Translucent faces, hidden edges drawn dashed. */
  transparency: boolean;
  /** Dimension lines per item. */
  measureItems: boolean;
  /** Overall (global) dimension lines of the whole composition. */
  measureGlobal: boolean;
  projection: Projection;
  view: ViewPreset;
  /** Cavalier receding-axis angle in degrees (30 / 45 / 60). */
  cavalierAngle: number;
  /** Cavalier depth ratio: 1 = cavalière, 0.5 = cabinet. */
  cavalierRatio: number;
  /** Grid cell in cm (visual + snap step). */
  gridCell: number;
  /** Snap positions to the grid cell. */
  snapGrid: boolean;
  /** Magnetic snapping to other items' faces. */
  snapItems: boolean;
  showGrid: boolean;
  showAxes: boolean;
  /** Fill KALLAX faces with their finish colour (wood, white, black-brown…). */
  finishColors: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'blueprint',
  shadows: false,
  transparency: false,
  measureItems: true,
  measureGlobal: true,
  projection: 'orthographic',
  view: 'iso',
  cavalierAngle: 45,
  cavalierRatio: 1,
  gridCell: 5,
  snapGrid: true,
  snapItems: true,
  showGrid: true,
  showAxes: true,
  finishColors: false,
};
