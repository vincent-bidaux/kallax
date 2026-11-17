// Injected CSS + icon for the ViewCube widget. Scoped by `kd-cube-` classes.
const STYLE_ID = 'kd-cube-style';

const CSS = `
.kd-cube {
  position: absolute; top: 16px; right: 16px;
  width: 110px; height: 110px;
  pointer-events: auto;
  z-index: 5;
  -webkit-user-select: none; user-select: none;
  touch-action: none;
}
.kd-cube-canvas {
  display: block; width: 110px; height: 110px;
  filter: drop-shadow(0 2px 5px rgba(0,0,0,0.16)) drop-shadow(0 0.5px 1px rgba(0,0,0,0.10));
}
.kd-cube[data-theme="blueprint"] .kd-cube-canvas {
  filter: drop-shadow(0 3px 7px rgba(4,18,44,0.40)) drop-shadow(0 0.5px 1px rgba(4,18,44,0.30));
}
.kd-cube-home {
  position: absolute; left: -22px; top: 4px;
  width: 24px; height: 24px; padding: 0; margin: 0;
  display: grid; place-items: center;
  border-radius: 7px;
  border: 0.5px solid rgba(0,0,0,0.10);
  background: rgba(255,255,255,0.72);
  -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
  color: #3a3a3c;
  box-shadow: 0 1px 2px rgba(0,0,0,0.10);
  cursor: pointer;
  opacity: 0.72;
  transition: opacity .18s ease, transform .18s ease, background-color .18s ease, color .18s ease;
}
.kd-cube:hover .kd-cube-home { opacity: 1; }
.kd-cube-home:hover { background: rgba(255,255,255,0.95); color: #0a84ff; }
.kd-cube-home:active { transform: scale(0.92); }
.kd-cube-home:focus-visible { outline: 2px solid #0a84ff; outline-offset: 1px; }
.kd-cube-home svg { width: 14px; height: 14px; display: block; }
.kd-cube[data-theme="blueprint"] .kd-cube-home {
  background: rgba(16,52,104,0.62);
  border-color: rgba(255,255,255,0.22);
  color: #e8f1ff;
  box-shadow: 0 1px 3px rgba(4,18,44,0.35);
}
.kd-cube[data-theme="blueprint"] .kd-cube-home:hover { background: rgba(28,79,148,0.9); color: #ffd166; }
`;

export const HOME_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 7.4 8 2.6l5.8 4.8"/><path d="M3.8 6.3v6.6c0 .35.28.6.6.6h2.5V9.6h2.2v3.9h2.5c.33 0 .6-.25.6-.6V6.3"/></svg>`;

export function ensureCubeStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
