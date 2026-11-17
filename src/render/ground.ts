// Ground grid (z = 0), shadow-catcher floor and the origin axis gizmo.
//
// The grid is a single shader plane: anti-aliased 1 px lines computed with
// fwidth (minor every `gridCell`, major every 50 cm, accentuated every metre,
// faint red/green lines on the X / Y axes). Minor (then major) lines fade out
// per pixel when they would be denser than ~6 px on screen, which also handles
// grazing angles and perspective for free. Works under the sheared cavalier
// projection since it only depends on world positions.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ThemeTokens } from '../core/theme';
import { makeLines, disposeObject, LineSegments2 } from './lines';
import { parseRgba, RO } from './materials';

const GRID_VERT = /* glsl */`
varying vec2 vXY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXY = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const GRID_FRAG = /* glsl */`
uniform vec3 uMinorC; uniform float uMinorA;
uniform vec3 uMajorC; uniform float uMajorA;
uniform vec3 uMeterC; uniform float uMeterA;
uniform vec3 uAxisXC; uniform vec3 uAxisYC; uniform float uAxisA;
uniform float uCell;
uniform vec4 uBounds;   // minX, minY, maxX, maxY
uniform float uFade;    // edge fade distance (cm)
varying vec2 vXY;

// x: lines of constant x, y: lines of constant y. Returns coverage (0..1) with
// a density fade (px between two lines: fade in from lo to hi).
vec2 gridLines(vec2 p, float stepv, float lo, float hi) {
  vec2 c = p / stepv;
  vec2 w = max(fwidth(c), vec2(1e-6));
  vec2 d = abs(fract(c - 0.5) - 0.5) / w;
  vec2 cov = clamp(1.0 - d, 0.0, 1.0);
  vec2 dens = smoothstep(vec2(lo), vec2(hi), 1.0 / w);
  return cov * dens;
}

vec4 over(vec4 dst, vec3 c, float a) {
  float oa = a + dst.a * (1.0 - a);
  vec3 oc = (c * a + dst.rgb * dst.a * (1.0 - a)) / max(oa, 1e-5);
  return vec4(oc, oa);
}

void main() {
  vec2 mi = gridLines(vXY, uCell, 6.0, 11.0);
  vec2 ma = gridLines(vXY, 50.0, 5.0, 9.0);
  vec2 me = gridLines(vXY, 100.0, 3.0, 6.0);
  // strongest level wins (coincident lines don't stack up)
  float aMi = max(mi.x, mi.y) * uMinorA;
  float aMa = max(ma.x, ma.y) * uMajorA;
  float aMe = max(me.x, me.y) * uMeterA;
  vec4 acc = vec4(uMinorC, aMi);
  if (aMa > acc.a) acc = vec4(uMajorC, aMa);
  if (aMe > acc.a) acc = vec4(uMeterC, aMe);
  // world axes on the floor: X axis = line y = 0, Y axis = line x = 0
  vec2 fw = max(fwidth(vXY), vec2(1e-6));
  float ax = clamp(1.6 - abs(vXY.y) / fw.y, 0.0, 1.0);
  float ay = clamp(1.6 - abs(vXY.x) / fw.x, 0.0, 1.0);
  acc = over(acc, uAxisXC, ax * uAxisA);
  acc = over(acc, uAxisYC, ay * uAxisA);
  // soft edges
  float ex = smoothstep(uBounds.x, uBounds.x + uFade, vXY.x) * (1.0 - smoothstep(uBounds.z - uFade, uBounds.z, vXY.x));
  float ey = smoothstep(uBounds.y, uBounds.y + uFade, vXY.y) * (1.0 - smoothstep(uBounds.w - uFade, uBounds.w, vXY.y));
  gl_FragColor = vec4(acc.rgb, acc.a * ex * ey);
  #include <colorspace_fragment>
}`;

/** Blending usable with transparent = false (keeps the object in the opaque list). */
function alphaBlend<M extends THREE.Material>(m: M): M {
  m.transparent = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.depthWrite = false;
  return m;
}

const AXIS_LEN = 40;

export class Ground {
  readonly group = new THREE.Group();
  /** Separate scene for the CSS2D axis labels (so other CSS2D renderers never touch them). */
  readonly labelScene = new THREE.Scene();

  private gridMat: THREE.ShaderMaterial;
  private grid: THREE.Mesh;
  private shadowMat: THREE.ShadowMaterial;
  private shadowPlane: THREE.Mesh;
  private axes = new THREE.Group();
  private labels: CSS2DObject[] = [];
  private theme: ThemeTokens;
  private bounds = new THREE.Vector4(-300, -300, 300, 300);

  constructor(theme: ThemeTokens) {
    this.theme = theme;
    this.gridMat = alphaBlend(new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: {
        uMinorC: { value: new THREE.Color() }, uMinorA: { value: 0 },
        uMajorC: { value: new THREE.Color() }, uMajorA: { value: 0 },
        uMeterC: { value: new THREE.Color() }, uMeterA: { value: 0 },
        uAxisXC: { value: new THREE.Color() }, uAxisYC: { value: new THREE.Color() }, uAxisA: { value: 0 },
        uCell: { value: 5 },
        uBounds: { value: this.bounds },
        uFade: { value: 80 },
      },
      side: THREE.DoubleSide,
    }));
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.gridMat);
    this.grid.renderOrder = RO.grid;
    this.grid.name = 'grid';
    this.grid.frustumCulled = false;

    this.shadowMat = alphaBlend(new THREE.ShadowMaterial({ opacity: theme.shadowOpacity }));
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shadowMat);
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = RO.shadowGround;
    this.shadowPlane.position.z = -0.02;
    this.shadowPlane.visible = false;
    this.shadowPlane.name = 'shadow-catcher';

    this.group.add(this.grid, this.shadowPlane, this.axes);
    this.group.name = 'ground';
    this.setExtent(-300, -300, 300, 300);
    this.setTheme(theme);
  }

  setTheme(theme: ThemeTokens) {
    this.theme = theme;
    const u = this.gridMat.uniforms;
    const minor = parseRgba(theme.gridMinor), major = parseRgba(theme.gridMajor);
    u.uMinorC.value.copy(minor.color); u.uMinorA.value = minor.alpha;
    u.uMajorC.value.copy(major.color); u.uMajorA.value = major.alpha;
    u.uMeterC.value.copy(major.color); u.uMeterA.value = Math.min(1, major.alpha * 1.45);
    u.uAxisXC.value.set(theme.axisX); u.uAxisYC.value.set(theme.axisY);
    u.uAxisA.value = theme.name === 'blueprint' ? 0.4 : 0.45;
    this.shadowMat.color.set(theme.name === 'blueprint' ? '#04152e' : '#2a2a35');
    this.shadowMat.opacity = theme.shadowOpacity;
    this.buildAxes();
  }

  setCell(cell: number) {
    this.gridMat.uniforms.uCell.value = Math.max(0.5, cell);
  }

  /** Grid / shadow-catcher rectangle (world cm, on z = 0). */
  setExtent(minX: number, minY: number, maxX: number, maxY: number) {
    this.bounds.set(minX, minY, maxX, maxY);
    const w = maxX - minX, h = maxY - minY, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.grid.scale.set(w, h, 1);
    this.grid.position.set(cx, cy, 0);
    this.shadowPlane.scale.set(w, h, 1);
    this.shadowPlane.position.set(cx, cy, -0.02);
    this.gridMat.uniforms.uFade.value = Math.min(120, Math.min(w, h) * 0.12);
  }

  setGridVisible(on: boolean) { this.grid.visible = on; }
  setShadowsVisible(on: boolean) {
    this.shadowPlane.visible = on;
    this.shadowMat.needsUpdate = true;
  }
  setAxesVisible(on: boolean) {
    this.axes.visible = on;
    for (const l of this.labels) l.visible = on;
  }

  private buildAxes() {
    const t = this.theme;
    const visible = this.axes.visible;
    for (const c of [...this.axes.children]) { this.axes.remove(c); disposeObject(c); }
    for (const l of this.labels) { l.element.remove(); l.removeFromParent(); }
    this.labels = [];

    const defs: { dir: THREE.Vector3; color: string; label: string }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: t.axisX, label: 'X' },
      { dir: new THREE.Vector3(0, 1, 0), color: t.axisY, label: 'Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: t.axisZ, label: 'Z' },
    ];
    const coneGeo = new THREE.ConeGeometry(1.5, 6, 20);
    for (const d of defs) {
      const end = d.dir.clone().multiplyScalar(AXIS_LEN);
      const pos = [0, 0, 0, end.x, end.y, end.z];
      const vis = makeLines(pos, { color: d.color, width: t.widths.axis, renderOrder: RO.axes });
      const occ = makeLines(pos, { color: d.color, width: t.widths.axis * 0.75, opacity: 0.35, renderOrder: RO.axesHidden });
      occ.material.depthFunc = THREE.GreaterDepth;
      occ.material.depthWrite = false;
      this.axes.add(vis, occ);

      const cone = new THREE.Mesh(coneGeo.clone(), new THREE.MeshBasicMaterial({ color: d.color }));
      cone.position.copy(d.dir).multiplyScalar(AXIS_LEN + 3);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.dir);
      cone.renderOrder = RO.axes;
      this.axes.add(cone);

      const el = document.createElement('div');
      el.textContent = d.label;
      el.style.cssText = `font: 600 10px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;` +
        `color:${d.color};letter-spacing:.02em;pointer-events:none;user-select:none;` +
        `text-shadow:0 0 3px ${t.bg}, 0 0 2px ${t.bg};`;
      const lbl = new CSS2DObject(el);
      lbl.position.copy(d.dir).multiplyScalar(AXIS_LEN + 11);
      lbl.visible = visible;
      this.labelScene.add(lbl);
      this.labels.push(lbl);
    }
    coneGeo.dispose();

    // origin marker: small circle + dot on the floor
    const ring: number[] = [];
    const R = 2.6, N = 40;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      ring.push(Math.cos(a0) * R, Math.sin(a0) * R, 0.01, Math.cos(a1) * R, Math.sin(a1) * R, 0.01);
    }
    const circle = makeLines(ring, { color: t.line, width: 1.4, renderOrder: RO.axes });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshBasicMaterial({ color: t.line, side: THREE.DoubleSide }));
    dot.position.z = 0.01;
    dot.renderOrder = RO.axes;
    this.axes.add(circle, dot);
    this.axes.visible = visible;
  }

  dispose() {
    for (const l of this.labels) l.element.remove();
    disposeObject(this.group);
  }
}

export type { LineSegments2 };
