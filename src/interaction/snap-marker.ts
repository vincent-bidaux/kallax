// ─────────────────────────────────────────────────────────────
// Snap marker: while an item is moved / placed, when the cross-angle magnet
// (placement.ts — corner on a corner, corner on a face line, any angles)
// catches, the shared vertical edge is drawn as an accent line with a small
// dot at its foot. Screen-constant sizes, drawn over everything.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { ViewportAPI } from '../core/contracts';
import { store } from '../core/store';
import { LineSegments2, makeLineMaterial, disposeLineMaterial, type LineMaterial } from '../render/lines';
import { ui } from './context';

export function installSnapMarker(vp: ViewportAPI) {
  const group = new THREE.Group();
  group.name = 'kd-snap-marker';
  group.renderOrder = 33;
  group.visible = false;
  vp.overlay.add(group);

  let mat: LineMaterial | null = null;
  let theme = '';
  const color = () => (store.settings.theme === 'paper' ? '#007aff' : '#64d2ff');
  const material = () => {
    if (mat && theme === store.settings.theme) return mat;
    if (mat) disposeLineMaterial(mat);
    mat = makeLineMaterial({ color: color(), width: 2.5, opacity: 1, depthTest: false });
    mat.transparent = true; mat.depthWrite = false;
    theme = store.settings.theme;
    dot.style.background = color();
    return mat;
  };

  const dot = document.createElement('div');
  dot.className = 'kd-snap-dot';
  dot.setAttribute('aria-hidden', 'true');
  Object.assign(dot.style, {
    position: 'absolute', left: '0', top: '0', width: '9px', height: '9px', marginLeft: '-4.5px', marginTop: '-4.5px',
    borderRadius: '50%', border: '1.5px solid #fff', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '4',
    boxShadow: '0 0 0 .5px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.3)', display: 'none',
  } as Partial<CSSStyleDeclaration>);
  vp.container.appendChild(dot);
  const line = new LineSegments2(new LineSegmentsGeometry(), material());
  line.renderOrder = 33;
  line.frustumCulled = false;
  (line as any).raycast = () => { /* not pickable */ };
  group.add(line);

  let key = '';
  vp.onBeforeRender(() => {
    const m = ui.gesture === 'move' || ui.gesture === 'place' ? ui.snapMark : null;
    if (!m) { group.visible = false; key = ''; return; }
    line.material = material();
    const k = `${m.x},${m.y},${m.z0},${m.z1}`;
    if (k !== key) {
      key = k;
      line.geometry.dispose();
      const g = new LineSegmentsGeometry();
      g.setPositions([m.x, m.y, m.z0, m.x, m.y, Math.max(m.z1, m.z0 + 0.01)]);
      line.geometry = g;
    }
    group.visible = true;
  });
  vp.onAfterRender(() => {
    const m = ui.gesture === 'move' || ui.gesture === 'place' ? ui.snapMark : null;
    if (!m) { dot.style.display = 'none'; return; }
    const p = vp.worldToScreen({ x: m.x, y: m.y, z: m.z0 });
    if (!p.visible) { dot.style.display = 'none'; return; }
    dot.style.display = '';
    dot.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  });
  ui.on(ev => { if (ev === 'snap' || ev === 'gesture') vp.requestRender(); });
}
