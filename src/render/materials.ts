// Shared materials for item meshes, rebuilt whenever the theme or the render
// mode (shadows / transparency) changes. Items only swap references.
import * as THREE from 'three';
import type { ThemeTokens } from '../core/theme';
import { makeLineMaterial, disposeLineMaterial, LineMaterial } from './lines';
import { FINISH_BY_ID, type BasketVariant, type FinishId } from '../core/finishes';
import type { Item } from '../core/types';
import { EKET_COLOR_BY_ID, type EketColorId } from '../core/eket';

export type VisualState = 'normal' | 'hover' | 'select';
export interface RenderMode {
  shadows: boolean;
  transparency: boolean;
  /** "Couleurs des finitions": KALLAX faces / edges take their finish colours. */
  finishColors: boolean;
}

/** Per-finish KALLAX materials ("Couleurs des finitions"). */
export interface FinishMaterials {
  face: Record<VisualState, THREE.Material>;
  lines: Record<VisualState, LinePair>;
}

/** Face opacity of finish-coloured faces in transparency (a bit more than the plain fill, to keep the tone). */
const FINISH_TRANSLUCENT = 0.36;

/** BRANÄS rattan tones. */
const BASKET_COLORS: Record<BasketVariant, { color: string; line: string }> = {
  naturel: { color: '#c8a26a', line: '#6a4f2a' },
  blanc: { color: '#f1efe9', line: '#7a776f' },
};

/** Render order (within the opaque and transparent lists three.js keeps). */
export const RO = {
  grid: -10,
  shadowGround: -9,
  prepass: -1,
  face: 0,
  line: 2,
  hidden: 3,
  axes: 4,
  axesHidden: 5,
  ghostPrepass: 6,
  ghostFace: 7,
  ghostLine: 8,
  ghostHidden: 9,
} as const;

export interface LinePair { outer: LineMaterial; inner: LineMaterial }
export interface GhostMaterials { face: THREE.Material; prepass: THREE.Material; outer: LineMaterial; inner: LineMaterial; hidden: LineMaterial }

/** Hidden edges dash pattern, in CSS px (dashScale is driven by the zoom). */
const DASH_PX = 5, GAP_PX = 4;

export function mixColor(a: string | THREE.Color, b: string | THREE.Color, t: number): THREE.Color {
  const ca = a instanceof THREE.Color ? a.clone() : new THREE.Color(a);
  const cb = b instanceof THREE.Color ? b : new THREE.Color(b);
  return ca.lerp(cb, t);
}

/** Parse 'rgba(r,g,b,a)' / '#hex' → colour + alpha. */
export function parseRgba(s: string): { color: THREE.Color; alpha: number } {
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (m) {
    const c = new THREE.Color().setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, THREE.SRGBColorSpace);
    return { color: c, alpha: m[4] !== undefined ? +m[4] : 1 };
  }
  return { color: new THREE.Color(s), alpha: 1 };
}

/** Face material families. */
export type FaceSet = 'kallax' | 'block' | 'wall' | 'plain';

/**
 * Which face family an item uses: KALLAX (finish colours), hatched blocks,
 * dotted walls, or clean fills (doors, skirting, radiators, objects).
 */
export function faceSetOf(item: Item): FaceSet {
  if (item.kind === 'kallax' || item.kind === 'eket') return 'kallax';
  switch (item.shape) {
    case 'wall': return 'wall';
    case 'door': case 'skirting': case 'radiator': case 'bed': case 'lamp': case 'plant': case 'chair': case 'desk': return 'plain';
    default: return 'block'; // box, beams, window
  }
}

/**
 * "Ombrage" key light, attached to the camera: a direction in WORLD space,
 * updated every frame by the viewport (shared by every shaded material).
 */
export const SHADE_UNIFORMS = {
  uKeyDir: { value: new THREE.Vector3(-0.3, -0.7, 0.65).normalize() },
};
/** Key light in VIEW space (x right, y up, z towards the viewer): from the viewer's upper-left. */
export const KEY_LIGHT_VIEW = new THREE.Vector3(-0.55, 0.62, 0.6).normalize();

/** Shading tints per theme: faces move towards `light` (lit) or `dark` (in shade), never to black. */
const SHADE_TINTS: Record<string, { light: string; dark: string; lightAmt: number; darkAmt: number }> = {
  blueprint: { light: '#dce9ff', dark: '#0b2452', lightAmt: 0.42, darkAmt: 0.6 },
  paper: { light: '#ffffff', dark: '#59606c', lightAmt: 1, darkAmt: 0.5 },
};

interface Decor {
  /** 45° hatching (custom blocks). */
  hatch?: { color: THREE.Color; alpha: number; spacing?: number };
  /** Regular dot pattern, masonry / concrete poché (walls). */
  dots?: { color: THREE.Color; alpha: number; spacing?: number; radiusPx?: number };
  /** Camera-relative technical-illustration shading ("Ombrage"). */
  shade?: { light: THREE.Color; dark: THREE.Color; lightAmt: number; darkAmt: number };
}

/**
 * Face shader decorations, all computed in world space on the face plane
 * (picked from the normal), anti-aliased with fwidth, with a level of detail
 * that keeps them from getting denser than a few pixels:
 * - hatch: ~1 px 45° stripes;
 * - dots: ~2 px round dots on a staggered (quincunx) lattice;
 * - shade: tone from the face orientation relative to a camera-attached key
 *   light + a sky term (tops lightest, faces turned to the key light mid,
 *   sides darker, undersides darkest), mixed towards in-palette tints.
 */
function decorate(m: THREE.MeshBasicMaterial, o: Decor) {
  const uniforms: Record<string, { value: unknown }> = {};
  if (o.hatch) {
    uniforms.uHatchColor = { value: o.hatch.color };
    uniforms.uHatchAlpha = { value: o.hatch.alpha };
    uniforms.uHatchSpacing = { value: o.hatch.spacing ?? 4 };
  }
  if (o.dots) {
    uniforms.uDotColor = { value: o.dots.color };
    uniforms.uDotAlpha = { value: o.dots.alpha };
    uniforms.uDotSpacing = { value: o.dots.spacing ?? 3 };
    uniforms.uDotRadius = { value: o.dots.radiusPx ?? 0.95 };
  }
  if (o.shade) {
    uniforms.uShadeLight = { value: o.shade.light };
    uniforms.uShadeDark = { value: o.shade.dark };
    uniforms.uShadeAmt = { value: new THREE.Vector2(o.shade.lightAmt, o.shade.darkAmt) };
    uniforms.uKeyDir = SHADE_UNIFORMS.uKeyDir;
  }
  if (!o.hatch && !o.dots && !o.shade) return;
  m.userData.decor = uniforms;
  const tag = `kd-${o.hatch ? 'h' : ''}${o.dots ? 'd' : ''}${o.shade ? 's' : ''}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDecoPos;\nvarying vec3 vDecoN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDecoPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvDecoN = mat3(modelMatrix) * normal;');
    let body = `
{
  vec3 decoN = normalize(vDecoN);
  vec3 an = abs(decoN);
  // in-plane coordinates of the face (u, v)
  vec2 uvA = an.x > 0.5 ? vDecoPos.yz : (an.y > 0.5 ? vDecoPos.xz : vDecoPos.xy);`;
    if (o.hatch) body += `
  {
    // Level of detail: stripe spacing doubles whenever it would fall under ~7 px,
    // cross-fading between the two nearest levels (no moiré, no popping).
    float s0 = (uvA.x - uvA.y) / uHatchSpacing;   // '/' stripes on vertical faces
    float fw0 = max(fwidth(s0), 1e-6);
    float lod = max(0.0, log2(fw0 * 7.0));
    float l0 = floor(lod);
    float k = fract(lod);
    float s1 = s0 / exp2(l0);
    float s2 = s1 * 0.5;
    float d1 = min(fract(s1), 1.0 - fract(s1)) / (fw0 / exp2(l0));
    float d2 = min(fract(s2), 1.0 - fract(s2)) / (fw0 / exp2(l0 + 1.0));
    float line = max(clamp(1.0 - d1 * 0.9, 0.0, 1.0) * (1.0 - k), clamp(1.0 - d2 * 0.9, 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, uHatchColor, line * uHatchAlpha);
  }`;
    if (o.dots) body += `
  {
    // Quincunx lattice = square lattice turned 45°: integer points of c are
    // dots at (s(i+j), s(i-j)) → rows every s, staggered by s. Halving c keeps
    // a subset of the dots, so the LOD fade never shifts the pattern.
    vec2 c = vec2(uvA.x + uvA.y, uvA.x - uvA.y) / (2.0 * uDotSpacing);
    // cm per pixel (largest screen axis: grazing faces fade instead of aliasing)
    float cmPx = max(max(length(dFdx(uvA)), length(dFdy(uvA))), 1e-6);
    float pitchPx = uDotSpacing * 1.41421356 / cmPx;        // nearest-dot distance, px
    float lod = max(0.0, log2(11.0 / pitchPx));             // keep ≥ ~11 px between dots
    float l0 = floor(lod);
    float k = fract(lod);
    float cov = 0.0;
    for (int i = 0; i < 2; i++) {
      float sc = exp2(l0 + float(i));
      vec2 q = c / sc;
      vec2 dq = abs(fract(q + 0.5) - 0.5);                  // lattice units to the nearest dot
      float dpx = length(dq) * sc * uDotSpacing * 1.41421356 / cmPx;   // → round dots in px
      float a = clamp(uDotRadius + 0.5 - dpx, 0.0, 1.0);
      cov = max(cov, i == 0 ? a * (1.0 - k) : a);
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, uDotColor, cov * uDotAlpha);
  }`;
    if (o.shade) body += `
  {
    vec3 n = gl_FrontFacing ? decoN : -decoN;
    float key = max(dot(n, uKeyDir), 0.0);
    float sky = n.z * 0.5 + 0.5;
    float s = clamp(0.14 + 0.46 * key + 0.42 * sky * sky, 0.0, 1.0);
    // tones mixed in (approximate) sRGB so the steps look even
    vec3 base = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
    vec3 lit = mix(base, pow(uShadeLight, vec3(1.0 / 2.2)), uShadeAmt.x);
    vec3 shd = mix(base, pow(uShadeDark, vec3(1.0 / 2.2)), uShadeAmt.y);
    vec3 toned = s < 0.5 ? mix(shd, base, s * 2.0) : mix(base, lit, s * 2.0 - 1.0);
    diffuseColor.rgb = pow(toned, vec3(2.2));
  }`;
    body += '\n}';
    const decl = [
      'varying vec3 vDecoPos;', 'varying vec3 vDecoN;',
      o.hatch ? 'uniform vec3 uHatchColor; uniform float uHatchAlpha; uniform float uHatchSpacing;' : '',
      o.dots ? 'uniform vec3 uDotColor; uniform float uDotAlpha; uniform float uDotSpacing; uniform float uDotRadius;' : '',
      o.shade ? 'uniform vec3 uShadeLight; uniform vec3 uShadeDark; uniform vec2 uShadeAmt; uniform vec3 uKeyDir;' : '',
    ].join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${body}`);
  };
  m.customProgramCacheKey = () => tag;
}

export class MaterialLibrary {
  readonly kallaxFace: Record<VisualState, THREE.Material>;
  /** Custom blocks (bricks, beams, windows): 45° hatching. */
  readonly blockFace: Record<VisualState, THREE.Material>;
  /** Walls: dot poché. */
  readonly wallFace: Record<VisualState, THREE.Material>;
  /** Doors, skirting, radiators, objects: clean fill. */
  readonly plainFace: Record<VisualState, THREE.Material>;
  readonly prepass: THREE.Material;
  readonly lines: Record<VisualState, LinePair>;
  readonly hidden: LineMaterial;
  readonly ghost: Record<'ok' | 'bad', GhostMaterials>;

  private finishSets = new Map<string, FinishMaterials>();
  private meshMats: THREE.Material[] = [];
  private lineMats: LineMaterial[] = [];
  private dashed: LineMaterial[] = [];

  constructor(readonly theme: ThemeTokens, readonly mode: RenderMode) {
    const t = theme, W = t.widths;
    const transp = mode.transparency;

    // ── faces ───────────────────────────────────────────────
    // "Ombrage": the shader spreads tones around the base colour (lighter tops,
    // darker sides), so the base sits between the plain fill and the lit fill.
    // On paper the base is pulled down to a light grey so the white is left to the tops.
    const shaded = (c: string) => t.name === 'blueprint' ? mixColor(c, t.litFill, 0.5) : mixColor(c, '#aab1bd', 0.42);
    const kBase = transp ? mixColor(t.fill, t.lineSoft, 0.32) : (mode.shadows ? shaded(t.fill) : new THREE.Color(t.fill));
    const bBase = transp ? mixColor(t.blockFill, t.lineSoft, 0.32) : (mode.shadows ? shaded(t.blockFill) : new THREE.Color(t.blockFill));
    const hatch = new THREE.Color(t.line);
    const selK = t.name === 'blueprint' ? 0.1 : 0.1;
    const hatchAlpha = t.name === 'blueprint' ? 0.16 : 0.2;
    // Selection / hover tint: on the blueprint a warm tint over blue turns muddy,
    // so lift the fill towards the light line colour and add just a hint of it.
    const tint = (base: THREE.Color, c: string, k: number) => t.name === 'blueprint'
      ? base.clone().lerp(new THREE.Color(t.lineSoft), k).lerp(new THREE.Color(c), k * 0.35)
      : base.clone().lerp(new THREE.Color(c), k);

    const set = (base: THREE.Color, deco: Decor) => ({
      normal: this.face(base, deco),
      hover: this.face(tint(base, t.hover, 0.05), deco),
      select: this.face(tint(base, t.select, selK), deco),
    });
    const hatchK = transp ? 0.8 : 1;
    this.kallaxFace = set(kBase, {});
    this.blockFace = set(bBase, { hatch: { color: hatch, alpha: hatchAlpha * hatchK } });
    // Walls: a quiet regular dot poché (light dots on the blueprint, grey on paper).
    const dot = t.name === 'blueprint'
      ? { color: new THREE.Color(t.lineSoft), alpha: 0.34 * hatchK }
      : { color: new THREE.Color('#8a8b90'), alpha: 0.45 * hatchK };
    this.wallFace = set(bBase, { dots: dot });
    this.plainFace = set(bBase, {});
    this.prepass = this.track(new THREE.MeshBasicMaterial({
      colorWrite: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
    }));

    // ── lines ───────────────────────────────────────────────
    this.lines = {
      normal: {
        outer: this.line({ color: t.line, width: W.model }),
        inner: this.line({ color: t.lineSoft, width: W.modelInner }),
      },
      hover: {
        outer: this.line({ color: t.hover, width: W.model + 0.4 }),
        inner: this.line({ color: mixColor(t.lineSoft, t.hover, 0.6).getStyle(), width: W.modelInner }),
      },
      select: {
        outer: this.line({ color: t.select, width: W.select }),
        inner: this.line({ color: mixColor(t.lineSoft, t.select, 0.75).getStyle(), width: W.modelInner + 0.4 }),
      },
    };
    // Hidden edges: discreet — thin, faded towards the fill colour.
    this.hidden = this.hiddenLine(mixColor(t.lineSoft, t.fill, 0.35).getStyle(), Math.max(0.75, W.hidden - 0.25), 0.38);

    // ── ghost ───────────────────────────────────────────────
    const ghost = (c: string): GhostMaterials => ({
      face: this.track(new THREE.MeshBasicMaterial({
        color: new THREE.Color(c), transparent: true, opacity: 0.14, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      })),
      prepass: this.track(new THREE.MeshBasicMaterial({
        colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
      })),
      outer: this.line({ color: c, width: W.model }),
      inner: this.line({ color: c, width: W.modelInner, opacity: 0.85 }),
      hidden: this.hiddenLine(c, W.hidden, 0.6),
    });
    this.ghost = { ok: ghost(t.ghostOk), bad: ghost(t.ghostBad) };
  }

  /** KALLAX materials in a finish's colours (lazily created, cached until the library is disposed). */
  kallaxFinish(id: FinishId): FinishMaterials {
    const f = FINISH_BY_ID[id] ?? FINISH_BY_ID.blanc;
    return this.colourSet(`f:${f.id}`, f.color, f.line);
  }

  /** EKET materials in one of its colours ("Couleurs des finitions"). */
  eketFinish(id: EketColorId): FinishMaterials {
    const c = EKET_COLOR_BY_ID[id] ?? EKET_COLOR_BY_ID.blanc;
    return this.colourSet(`e:${c.id}`, c.color, c.line);
  }

  /** BRANÄS basket materials (rattan tone of the chosen variant). */
  basket(variant: BasketVariant | undefined): FinishMaterials {
    const b = BASKET_COLORS[variant ?? 'naturel'] ?? BASKET_COLORS.naturel;
    return this.colourSet(`b:${variant ?? 'naturel'}`, b.color, b.line);
  }

  /**
   * Materials in an object's own colour (IKEA chair colours…), for the
   * "finish colours" mode: face in `hex`, edges in a darker / lighter tone of it.
   */
  objectFinish(hex: string): FinishMaterials {
    const lightBg = new THREE.Color(this.theme.bg).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
    return this.colourSet(`o:${hex}`, hex, objectLineColor(hex, lightBg));
  }

  private colourSet(key: string, color: string, line: string): FinishMaterials {
    const hit = this.finishSets.get(key);
    if (hit) return hit;
    const t = this.theme, W = this.theme.widths;
    const base = finishFaceColor(t, color, this.mode);
    const edge = finishLineColor(t, line, color, this.mode, true);
    const edgeIn = finishLineColor(t, line, color, this.mode, false);
    // Light tints, mixed in sRGB (a linear mix would turn dark finishes into
    // another wood): the selected unit keeps reading as its own finish.
    const tint = (c: string, k: number) => {
      const a = base.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      const b = new THREE.Color(c).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      return new THREE.Color().setRGB(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, THREE.SRGBColorSpace);
    };
    // Hover / select edges keep the theme's hue, darkened just enough to read on light finishes.
    const ref = new THREE.Color(color);
    const sel = legibleOn(new THREE.Color(t.select), ref), hov = legibleOn(new THREE.Color(t.hover), ref);
    // "Ombrage" on a finish: shade towards a deeper tone of the finish itself
    // (keeps the wood / colour hue instead of turning muddy), light towards white.
    const own = { light: '#ffffff', dark: new THREE.Color(color).multiplyScalar(0.18).lerp(new THREE.Color(t.bgVignette), 0.25).getStyle() };
    const set: FinishMaterials = {
      face: {
        normal: this.face(base, {}, FINISH_TRANSLUCENT, own),
        hover: this.face(tint(t.hover, 0.05), {}, FINISH_TRANSLUCENT, own),
        select: this.face(tint(t.select, 0.1), {}, FINISH_TRANSLUCENT, own),
      },
      lines: {
        normal: {
          outer: this.line({ color: edge.getStyle(), width: W.model }),
          inner: this.line({ color: edgeIn.getStyle(), width: W.modelInner, opacity: 0.9 }),
        },
        hover: {
          outer: this.line({ color: hov.getStyle(), width: W.model + 0.4 }),
          inner: this.line({ color: mixColor(edgeIn, hov, 0.6).getStyle(), width: W.modelInner }),
        },
        select: {
          outer: this.line({ color: sel.getStyle(), width: W.select }),
          inner: this.line({ color: mixColor(edgeIn, sel, 0.8).getStyle(), width: W.modelInner + 0.4 }),
        },
      },
    };
    this.finishSets.set(key, set);
    return set;
  }

  private track<M extends THREE.Material>(m: M): M { this.meshMats.push(m); return m; }

  faceSet(set: FaceSet): Record<VisualState, THREE.Material> {
    return set === 'kallax' ? this.kallaxFace : set === 'wall' ? this.wallFace : set === 'plain' ? this.plainFace : this.blockFace;
  }

  private face(color: THREE.Color, deco: Decor, translucentOpacity = 0.2, shadeTints?: { light: string; dark: string }): THREE.Material {
    const transp = this.mode.transparency;
    const params = {
      color,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      transparent: transp,
      opacity: transp ? translucentOpacity : 1,
      depthWrite: !transp,
    };
    const m = new THREE.MeshBasicMaterial(params);
    const tints = SHADE_TINTS[this.theme.name] ?? SHADE_TINTS.blueprint;
    const light = shadeTints?.light ?? tints.light, dark = shadeTints?.dark ?? tints.dark;
    const lightAmt = shadeTints ? 0.45 : tints.lightAmt, darkAmt = shadeTints ? 0.5 : tints.darkAmt;
    decorate(m, this.mode.shadows ? {
      ...deco,
      shade: { light: new THREE.Color(light), dark: new THREE.Color(dark), lightAmt, darkAmt: darkAmt * (transp ? 0.7 : 1) },
    } : deco);
    return this.track(m);
  }

  private line(o: { color: string; width: number; opacity?: number }): LineMaterial {
    const m = makeLineMaterial({ color: o.color, width: o.width, opacity: o.opacity });
    this.lineMats.push(m);
    return m;
  }

  /** Dashed, drawn only where occluded (depth GREATER than what's in the buffer). */
  private hiddenLine(color: string, width: number, opacity: number): LineMaterial {
    const m = makeLineMaterial({ color, width, opacity, dashed: true, dashSize: DASH_PX, gapSize: GAP_PX });
    m.depthFunc = THREE.GreaterDepth;
    m.depthWrite = false;
    m.transparent = true;
    this.lineMats.push(m);
    this.dashed.push(m);
    return m;
  }

  /** Keep dashes a constant pixel length: dashScale = screen px per cm. */
  setPxPerCm(pxPerCm: number) {
    for (const m of this.dashed) m.dashScale = pxPerCm;
  }

  dispose() {
    for (const m of this.meshMats) m.dispose();
    for (const m of this.lineMats) disposeLineMaterial(m);
    this.meshMats = []; this.lineMats = []; this.dashed = [];
    this.finishSets.clear();
  }
}

/** WCAG relative luminance / contrast ratio (THREE.Color components are already linear sRGB). */
function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
function contrast(a: THREE.Color, b: THREE.Color): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `c` made legible on the face colour `on`: darkened (same hue) on light
 * finishes, lightened on dark ones, until the contrast ratio reaches `min`
 * (low on purpose: the saturated select / hover hue also helps).
 */
function legibleOn(c: THREE.Color, on: THREE.Color, min = 1.6): THREE.Color {
  const white = new THREE.Color(1, 1, 1);
  const darken = luminance(on) > 0.3;
  for (let i = 0; i < 14 && contrast(c, on) < min; i++) {
    if (darken) c.offsetHSL(0, 0.02, -0.035); else c.lerp(white, 0.12);
  }
  return c;
}

/**
 * Face colour of a finish for the current theme / mode. Slightly muted towards
 * the drawing background so the plan keeps reading as a drawing (white units
 * do not glare on the blueprint). With "Ombrage" the camera-relative shading
 * spreads tones around this colour (fronts close to the real tone, tops
 * lighter, sides darker), so no pre-brightening is needed.
 */
function finishFaceColor(t: ThemeTokens, color: string, mode: RenderMode): THREE.Color {
  const c = new THREE.Color(color);
  c.lerp(new THREE.Color(t.bg), t.name === 'blueprint' ? 0.1 : 0.04);
  void mode;
  return c;
}

/**
 * Edge colour of a finish. Normally its `line` tone (contrasts with the face).
 * - Transparency: faces nearly vanish, so edges sit on the background: take
 *   whichever of the face / line tones stands out more from it (keeps the hue
 *   on the blueprint: white and oak edges, light edges for dark brown units).
 * - Light edges on a dark unit over a light background (paper): darken them a
 *   little so the silhouette stays crisp.
 */
function finishLineColor(t: ThemeTokens, line: string, face: string, mode: RenderMode, outer: boolean): THREE.Color {
  const bg = new THREE.Color(t.bg);
  const l = new THREE.Color(line), f = new THREE.Color(face);
  if (mode.transparency) {
    const pick = contrast(f, bg) >= contrast(l, bg) ? f : l;
    return pick.lerp(new THREE.Color(t.line), 0.12);
  }
  if (outer && luminance(l) > luminance(f) && contrast(l, bg) < 2) l.lerp(new THREE.Color(t.line), 0.25);
  return l;
}

/**
 * Edge tone for an object colour (same family, enough contrast): a darker
 * shade on light / mid colours (white → grey, ash → brown, orange → rust).
 * Dark colours (black upholstery, black frames): a lighter tint on a dark
 * drawing background (blueprint), like the KALLAX black-brown finish, but a
 * near-black on a light one (paper), where light edges would read as a halo.
 */
export function objectLineColor(hex: string, lightBg = false): string {
  const c = new THREE.Color(hex);
  const s = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const perceived = 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
  const k = lightBg && perceived <= 0.36 ? 0.35 : 0.42;
  const out = perceived > 0.36 || lightBg
    ? new THREE.Color().setRGB(s.r * k, s.g * k, s.b * k, THREE.SRGBColorSpace)
    : new THREE.Color().setRGB(s.r + (1 - s.r) * 0.62, s.g + (1 - s.g) * 0.62, s.b + (1 - s.b) * 0.6, THREE.SRGBColorSpace);
  return '#' + out.getHexString(THREE.SRGBColorSpace);
}
