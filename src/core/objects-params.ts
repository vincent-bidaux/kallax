// ─────────────────────────────────────────────────────────────
// Parametric objects: TV, custom table, wall frames.
//
// Unlike the IKEA presets (beds, desks, chairs…), their size comes from a few
// parameters stored on the item (`variant` + `opts`, see core/types.ts
// ObjOpts) and is kept in `item.size` (so placement, collisions and
// dimensions work as for any block):
//   · TV ('tv'): screen diagonal in inches (16:9), with a central stand or
//     wall-mounted (variant 'stand' / 'wall'). Size fully derived.
//   · Table ('table'): free W × D × H, top thickness, leg section, leg style
//     (variant), optional round top (Ø = W, so D = W).
//   · Frame ('frame'): 'simple' / 'classic' profile, free outer W × H, depth
//     from the style; presets S / M / L name the OPENING (picture) format,
//     outer = opening + 2 × profile.
//
// Local axes: w along X, d along Y with the FRONT at y = 0, h along Z.
// Wall-hung items (frames, wall TV) have their BACK at y = d: placed against
// a wall face, they are turned so that y = d touches the wall (see
// interaction/placement.ts). The wall TV box includes the 5 cm bracket gap.
// ─────────────────────────────────────────────────────────────
import type { ObjectColor, ObjectDef, ObjectVariant } from './objects';
import type { BlockShape, ObjOpts, Size3 } from './types';

const S = (w: number, d: number, h: number): Size3 => ({ w, d, h });
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ── TV ───────────────────────────────────────────────────────
export const TV_INCHES = [32, 43, 50, 55, 65, 75, 85];
export const TV_DEFAULT_INCH = 55;
export const TV_MIN_INCH = 19, TV_MAX_INCH = 115;
/** Gap between the wall and the back of a wall-mounted TV (flat bracket). */
export const TV_WALL_GAP = 5;
/** Panel bottom above the surface, TV on its stand. */
export const TV_STAND_LIFT = 7;
/** Default height of the screen centre of a wall TV / of a frame centre (inserted away from a wall). */
export const TV_WALL_CENTRE = 115;
export const FRAME_CENTRE = 150;

export interface TvDims {
  /** Panel outer size (bezel included). */
  pw: number; ph: number; pd: number;
  /** Visible screen (16:9) and bezels. */
  sw: number; sh: number; bezel: number; chin: number;
  /** Panel slab depth (the rest of pd is the rear electronics bulge). */
  slab: number;
  /** Central stand base plate (stand variant). */
  baseW: number; baseD: number;
}

/**
 * Real-ish TV dimensions for a 16:9 diagonal: screen = diagonal × 16/√337 by
 * × 9/√337; bezels 0.6–1 cm (a slightly thicker bottom edge); panel depth
 * 5–6 cm with a 2.5 cm slab. 55″ → panel 123.2 × 70.5 × 5.4 cm.
 */
export function tvDims(inch: number): TvDims {
  const diag = inch * 2.54, k = Math.hypot(16, 9);
  const sw = diag * 16 / k, sh = diag * 9 / k;
  const bezel = clamp(0.5 + inch * 0.004, 0.6, 1);
  const chin = bezel + 0.6;
  const pd = r1(Math.min(6, 4.5 + inch / 60));
  return {
    pw: r1(sw + 2 * bezel), ph: r1(sh + bezel + chin), pd, sw, sh, bezel, chin, slab: Math.min(2.5, pd),
    baseW: Math.round(clamp((sw + 2 * bezel) * 0.3, 22, 40)), baseD: Math.round(clamp(14 + inch * 0.15, 18, 30)),
  };
}

export function tvSize(inch: number, stand: boolean): Size3 {
  const t = tvDims(inch);
  return stand ? S(t.pw, Math.max(t.baseD, t.pd), r1(t.ph + TV_STAND_LIFT)) : S(t.pw, r1(t.pd + TV_WALL_GAP), t.ph);
}

const TV_BLACK = '#1d1e21', TV_SCREEN = '#141821';
export const TV_VARIANTS: ObjectVariant[] = [
  { id: 'stand', labelKey: 'obj.tv.stand', icon: 'tv', noteKey: 'obj.tv.stand.note', size: tvSize(TV_DEFAULT_INCH, true), colors: [{ id: 'black', labelKey: 'obj.param.c.black', hex: TV_BLACK, hex2: TV_SCREEN }] },
  { id: 'wall', labelKey: 'obj.tv.wall', icon: 'tvWall', size: tvSize(TV_DEFAULT_INCH, false), noteKey: 'obj.tv.wall.note', colors: [{ id: 'black', labelKey: 'obj.param.c.black', hex: TV_BLACK, hex2: TV_SCREEN }] },
];
export const TV_DEF: ObjectDef = {
  shape: 'tv', group: 'objects', labelKey: 'obj.tv', icon: 'tv', size: TV_VARIANTS[0].size, editable: [],
  defaultVariant: 'stand', variants: TV_VARIANTS,
};

// ── table ────────────────────────────────────────────────────
export type TableLegStyle = 'square' | 'round' | 'tapered' | 'trestle' | 'pedestal' | 'hairpin';
export const TABLE_LEG_STYLES: TableLegStyle[] = ['square', 'round', 'tapered', 'trestle', 'pedestal', 'hairpin'];
/** Default leg section per style: square / round / tapered (top) side, trestle tube, pedestal column Ø, hairpin rod Ø. */
export const TABLE_LEG_DEFAULT: Record<TableLegStyle, number> = { square: 5, round: 5, tapered: 5, trestle: 4, pedestal: 10, hairpin: 1.2 };
export const TABLE_TOP_DEFAULT = 3;
/** Leg inset from the top edges (corner legs). */
export const TABLE_LEG_INSET = 3;
export const TABLE_SIZE = S(140, 80, 75);

const C = (id: string, hex: string, hex2?: string): ObjectColor => ({ id, labelKey: `obj.param.c.${id}`, hex, hex2 });
const WHITE = '#f1f1ee', BLACK = '#262627', OAK = '#c99c62', WALNUT = '#6a4426', BLACK_BROWN = '#3a3230';
const TABLE_COLORS = [
  C('oak', OAK, OAK), C('walnut', WALNUT, WALNUT), C('white', WHITE, WHITE), C('black', BLACK, BLACK), C('blackBrown', BLACK_BROWN, BLACK_BROWN),
  C('oakBlack', OAK, BLACK), C('walnutBlack', WALNUT, BLACK), C('whiteOak', WHITE, OAK),
];
// metal hairpin legs: black (or white) steel
const HAIRPIN_COLORS = [C('oakBlack', OAK, BLACK), C('walnutBlack', WALNUT, BLACK), C('whiteBlack', WHITE, BLACK), C('black', BLACK, BLACK), C('blackBrown', BLACK_BROWN, BLACK), C('white', WHITE, WHITE)];

export const TABLE_VARIANTS: ObjectVariant[] = TABLE_LEG_STYLES.map(id => ({
  id, labelKey: `obj.table.${id}`, nameKey: 'obj.table.name', size: TABLE_SIZE, icon: id === 'pedestal' ? 'tableRound' : 'tableParam',
  colors: id === 'hairpin' ? HAIRPIN_COLORS : TABLE_COLORS,
}));
export const TABLE_DEF: ObjectDef = {
  shape: 'table', group: 'objects', labelKey: 'obj.table', icon: 'tableParam', size: TABLE_SIZE, editable: ['w', 'd', 'h'],
  defaultVariant: 'square', variants: TABLE_VARIANTS,
};

// ── frames ───────────────────────────────────────────────────
export type FrameStyle = 'simple' | 'classic';
/** Profile width and frame depth per style. */
export const FRAME_PROFILE: Record<FrameStyle, { p: number; d: number }> = { simple: { p: 2, d: 2 }, classic: { p: 6, d: 4 } };
/** Opening (picture) formats, portrait. */
export const FRAME_PRESETS = [
  { id: 'S', w: 30, h: 40 },
  { id: 'M', w: 50, h: 70 },
  { id: 'L', w: 70, h: 100 },
] as const;
export type FramePresetId = typeof FRAME_PRESETS[number]['id'];
const MAT = '#f3f0e8';
const GOLD = '#cfa646';
const FRAME_COLORS_SIMPLE = [C('black', '#232325', MAT), C('white', '#f4f4f1', MAT), C('oak', '#c9a477', MAT), C('gold', GOLD, MAT)];
const FRAME_COLORS_CLASSIC = [C('gold', GOLD, '#ece6d6'), C('black', '#232325', '#ece6d6'), C('white', '#f4f4f1', '#ece6d6'), C('oak', '#b88d5c', '#ece6d6')];
const frameSize = (st: FrameStyle, w: number, h: number) => { const f = FRAME_PROFILE[st]; return S(w + 2 * f.p, f.d, h + 2 * f.p); };
export const FRAME_VARIANTS: ObjectVariant[] = [
  { id: 'simple', labelKey: 'obj.frame.simple', icon: 'frame', size: frameSize('simple', 50, 70), colors: FRAME_COLORS_SIMPLE },
  { id: 'classic', labelKey: 'obj.frame.classic', icon: 'frameClassic', size: frameSize('classic', 50, 70), colors: FRAME_COLORS_CLASSIC },
];
export const FRAME_DEF: ObjectDef = {
  shape: 'frame', group: 'objects', labelKey: 'obj.frame', icon: 'frame', size: FRAME_VARIANTS[0].size, editable: ['w', 'h'],
  defaultVariant: 'simple', variants: FRAME_VARIANTS,
};

export const PARAM_DEFS = [TV_DEF, TABLE_DEF, FRAME_DEF];

// ── helpers ──────────────────────────────────────────────────
export type ParamShape = 'tv' | 'table' | 'frame';
export function isParamShape(s: BlockShape | undefined): s is ParamShape {
  return s === 'tv' || s === 'table' || s === 'frame';
}

/** The parametric state of an item / library draft. */
export interface ParamState { shape: ParamShape; variant?: string; size: Size3; opts?: ObjOpts; color?: string }

export const tvInch = (o: { opts?: ObjOpts }) => clamp(o.opts?.inch ?? TV_DEFAULT_INCH, TV_MIN_INCH, TV_MAX_INCH);
export const tvStand = (o: { variant?: string }) => o.variant !== 'wall';
export const tableStyle = (o: { variant?: string }): TableLegStyle => (TABLE_LEG_STYLES as string[]).includes(o.variant ?? '') ? o.variant as TableLegStyle : 'square';
export const tableTop = (o: { opts?: ObjOpts; size: Size3 }) => clamp(o.opts?.top ?? TABLE_TOP_DEFAULT, 0.5, Math.max(0.5, o.size.h - 1));
export const tableLeg = (o: { opts?: ObjOpts; variant?: string }) => clamp(o.opts?.leg ?? TABLE_LEG_DEFAULT[tableStyle(o)], 0.5, 30);
export const frameStyle = (o: { variant?: string }): FrameStyle => o.variant === 'classic' ? 'classic' : 'simple';

/** Default state of a parametric shape (library draft). */
export function paramDefaults(shape: ParamShape): ParamState {
  if (shape === 'tv') return { shape, variant: 'stand', size: tvSize(TV_DEFAULT_INCH, true), opts: { inch: TV_DEFAULT_INCH } };
  if (shape === 'table') return { shape, variant: 'square', size: { ...TABLE_SIZE }, opts: { top: TABLE_TOP_DEFAULT, leg: TABLE_LEG_DEFAULT.square } };
  return { shape, variant: 'simple', size: frameSize('simple', 50, 70) };
}

/**
 * Re-derive the size from the parameters (after any edit): TV = f(inch,
 * stand); table: round top forces D = W; frame: depth from the style and an
 * outer size at least twice the profile + 4 cm.
 */
export function syncParam(st: { shape?: BlockShape; variant?: string; size: Size3; opts?: ObjOpts }): void {
  if (st.shape === 'tv') {
    const inch = tvInch(st);
    st.opts = { ...st.opts, inch };
    st.size = tvSize(inch, tvStand(st));
  } else if (st.shape === 'table') {
    const s = { w: Math.max(20, st.size.w), d: Math.max(20, st.size.d), h: Math.max(10, st.size.h) };
    if (st.opts?.round) s.d = s.w;
    st.size = s;
    st.opts = { ...st.opts, top: tableTop({ ...st, size: s }), leg: tableLeg(st) };
  } else if (st.shape === 'frame') {
    const f = FRAME_PROFILE[frameStyle(st)];
    const min = 2 * f.p + 4;
    st.size = { w: Math.max(min, st.size.w), d: f.d, h: Math.max(min, st.size.h) };
  }
}

/** Frame: change style keeping the opening (outer size grows / shrinks by the profile difference). */
export function setFrameStyle(st: { variant?: string; size: Size3 }, style: FrameStyle) {
  const a = FRAME_PROFILE[frameStyle(st)].p, b = FRAME_PROFILE[style].p;
  st.variant = style;
  st.size = { ...st.size, w: st.size.w + 2 * (b - a), h: st.size.h + 2 * (b - a) };
}
export function frameOpening(st: { variant?: string; size: Size3 }) {
  const p = FRAME_PROFILE[frameStyle(st)].p;
  return { w: st.size.w - 2 * p, h: st.size.h - 2 * p };
}
export const framePortrait = (st: { size: Size3 }) => st.size.h >= st.size.w;
/** Frame preset (opening format) matching the current size, in either orientation. */
export function framePreset(st: { variant?: string; size: Size3 }): FramePresetId | null {
  const o = frameOpening(st);
  const p = FRAME_PRESETS.find(f => (Math.abs(f.w - o.w) < 0.05 && Math.abs(f.h - o.h) < 0.05) || (Math.abs(f.h - o.w) < 0.05 && Math.abs(f.w - o.h) < 0.05));
  return p?.id ?? null;
}
export function setFramePreset(st: { variant?: string; size: Size3 }, id: FramePresetId) {
  const f = FRAME_PRESETS.find(x => x.id === id)!, p = FRAME_PROFILE[frameStyle(st)].p;
  const portrait = framePortrait(st);
  const [w, h] = portrait ? [f.w, f.h] : [f.h, f.w];
  st.size = { ...st.size, w: w + 2 * p, h: h + 2 * p };
}
export function setFramePortrait(st: { size: Size3 }, portrait: boolean) {
  if (st.size.w !== st.size.h && framePortrait(st) !== portrait) st.size = { ...st.size, w: st.size.h, h: st.size.w };
}

/** Wall-hung objects: frames and wall-mounted TVs (back flat to the wall, height follows the cursor). */
export function isWallHung(it: { kind?: string; shape?: BlockShape; variant?: string }): boolean {
  if (it.kind !== undefined && it.kind !== 'block') return false;
  return it.shape === 'frame' || (it.shape === 'tv' && it.variant === 'wall');
}

/** Default base height of a NEW wall-hung item (centre at 115 cm for a TV, 150 for a frame), else undefined. */
export function wallHungBaseZ(it: { kind?: string; shape?: BlockShape; variant?: string; size?: Size3 }): number | undefined {
  if (!isWallHung(it) || !it.size) return undefined;
  const c = it.shape === 'tv' ? TV_WALL_CENTRE : FRAME_CENTRE;
  return Math.max(0, Math.round((c - it.size.h / 2) * 10) / 10);
}

/**
 * After a parameter edit of a wall-hung item (frame, wall TV — before or
 * after the edit), keep it in place on its wall: same back plane, same centre
 * across the width and the height (instead of growing from the min corner).
 */
export function keepWallAnchor(
  before: { size: Size3; rotation: number; tilt?: { x: number; y: number } },
  after: { size: Size3; rotation: number; position: { x: number; y: number; z: number } },
): void {
  if (before.tilt && (before.tilt.x || before.tilt.y)) return;
  // any angle about Z: local +Y (the back) = (−sin r, cos r); keep the centre across
  // the width and the height, and the back plane (the centre moves by −Δd/2 along it)
  const r = (after.rotation * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  const ac = Math.abs(snap(c)), as = Math.abs(snap(s));
  const aabb = (z: Size3) => ({ w: ac * z.w + as * z.d, d: as * z.w + ac * z.d });
  const w0 = aabb(before.size), w1 = aabb(after.size);
  const p = after.position;
  const dd = after.size.d - before.size.d, dh = after.size.h - before.size.h;
  const cx = p.x + w0.w / 2 - snap(-s) * dd / 2, cy = p.y + w0.d / 2 - snap(c) * dd / 2;
  p.x = cx - w1.w / 2;
  p.y = cy - w1.d / 2;
  p.z = Math.max(0, p.z - dh / 2);
  for (const k of ['x', 'y', 'z'] as const) p[k] = Math.round(p[k] * 1000) / 1000;
}
