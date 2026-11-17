// Shared materials for item meshes, rebuilt whenever the theme or the render
// mode (shadows / transparency) changes. Items only swap references.
import * as THREE from 'three';
import type { ThemeTokens } from '../core/theme';
import { makeLineMaterial, disposeLineMaterial, LineMaterial } from './lines';

export type VisualState = 'normal' | 'hover' | 'select';
export interface RenderMode { shadows: boolean; transparency: boolean }

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

/**
 * Subtle 45° hatching in world space (used on custom blocks). The stripe
 * coordinate is taken in the plane of the face (picked from the normal), lines
 * are ~1 px, anti-aliased with fwidth, and fade out when they would get denser
 * than a few pixels.
 */
function addHatch(m: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, color: THREE.Color, alpha: number, spacing = 4) {
  const uniforms = {
    uHatchColor: { value: color },
    uHatchAlpha: { value: alpha },
    uHatchSpacing: { value: spacing },
  };
  m.userData.hatch = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;\nvarying vec3 vHatchN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHatchPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvHatchN = mat3(modelMatrix) * normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHatchPos;
varying vec3 vHatchN;
uniform vec3 uHatchColor;
uniform float uHatchAlpha;
uniform float uHatchSpacing;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 an = abs(normalize(vHatchN));
  // in-plane coordinates of the face (u, v)
  vec2 uvA = an.x > 0.5 ? vHatchPos.yz : (an.y > 0.5 ? vHatchPos.xz : vHatchPos.xy);
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
}`);
  };
  m.customProgramCacheKey = () => 'kd-hatch';
}

export class MaterialLibrary {
  readonly kallaxFace: Record<VisualState, THREE.Material>;
  readonly blockFace: Record<VisualState, THREE.Material>;
  readonly prepass: THREE.Material;
  readonly lines: Record<VisualState, LinePair>;
  readonly hidden: LineMaterial;
  readonly ghost: Record<'ok' | 'bad', GhostMaterials>;

  private meshMats: THREE.Material[] = [];
  private lineMats: LineMaterial[] = [];
  private dashed: LineMaterial[] = [];

  constructor(readonly theme: ThemeTokens, readonly mode: RenderMode) {
    const t = theme, W = t.widths;
    const transp = mode.transparency;

    // ── faces ───────────────────────────────────────────────
    const kBase = transp ? mixColor(t.fill, t.lineSoft, 0.32) : new THREE.Color(mode.shadows ? t.litFill : t.fill);
    const bBase = transp ? mixColor(t.blockFill, t.lineSoft, 0.32) : new THREE.Color(mode.shadows ? mixColor(t.litFill, t.blockFill, 0.35) : t.blockFill);
    const hatch = new THREE.Color(t.line);
    const selK = t.name === 'blueprint' ? 0.1 : 0.1;
    const hatchAlpha = t.name === 'blueprint' ? 0.16 : 0.2;
    // Selection / hover tint: on the blueprint a warm tint over blue turns muddy,
    // so lift the fill towards the light line colour and add just a hint of it.
    const tint = (base: THREE.Color, c: string, k: number) => t.name === 'blueprint'
      ? base.clone().lerp(new THREE.Color(t.lineSoft), k).lerp(new THREE.Color(c), k * 0.35)
      : base.clone().lerp(new THREE.Color(c), k);

    this.kallaxFace = {
      normal: this.face(kBase, null, 0),
      hover: this.face(tint(kBase, t.hover, 0.05), null, 0),
      select: this.face(tint(kBase, t.select, selK), null, 0),
    };
    this.blockFace = {
      normal: this.face(bBase, hatch, hatchAlpha),
      hover: this.face(tint(bBase, t.hover, 0.05), hatch, hatchAlpha),
      select: this.face(tint(bBase, t.select, selK), hatch, hatchAlpha),
    };
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

  private track<M extends THREE.Material>(m: M): M { this.meshMats.push(m); return m; }

  private face(color: THREE.Color, hatch: THREE.Color | null, hatchAlpha: number): THREE.Material {
    const transp = this.mode.transparency;
    const params = {
      color,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      transparent: transp,
      opacity: transp ? 0.2 : 1,
      depthWrite: !transp,
    };
    const m = this.mode.shadows ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params);
    if (hatch) addHatch(m, hatch, hatchAlpha * (transp ? 0.8 : 1));
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
  }
}
