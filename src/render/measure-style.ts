// Injected CSS for the dimension labels ("cotes"). Scoped by `kd-dim-` classes.
import type { ThemeTokens } from '../core/theme';

const STYLE_ID = 'kd-dim-style';

const CSS = `
.kd-dim-layer {
  position: absolute; left: 0; top: 0;
  pointer-events: none; overflow: hidden;
  z-index: 2;
  -webkit-user-select: none; user-select: none;
}
.kd-dim-layer * { pointer-events: none !important; }
.kd-dim-anchor { will-change: transform; }
.kd-dim-pill {
  display: inline-flex; align-items: baseline; gap: 0;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Helvetica Neue", sans-serif;
  font-size: 11px; font-weight: 500; line-height: 1;
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
  letter-spacing: -0.005em;
  padding: 2.5px 5.5px 2.5px;
  border-radius: 999px;
  white-space: nowrap;
  color: var(--kd-dim-fg);
  background: var(--kd-dim-bg);
  border: 1px solid var(--kd-dim-border);
  box-shadow: var(--kd-dim-shadow);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  opacity: 0;
  transition: opacity .18s ease, border-color .18s ease, color .18s ease, background-color .18s ease;
}
.kd-dim-pill.kd-dim-on { opacity: 1; }
.kd-dim-unit { font-size: .8em; font-weight: 400; opacity: .68; margin-left: .18em; }
.kd-dim-pill.kd-dim-global {
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
  padding: 3px 7.5px 3px;
  border-color: var(--kd-dim-border-strong);
}
.kd-dim-pill.kd-dim-sel { border-color: var(--kd-dim-sel); color: var(--kd-dim-sel-fg); }
.kd-dim-pill.kd-dim-name {
  font-size: 9.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--kd-dim-muted); background: transparent; border-color: transparent; box-shadow: none;
  padding: 1px 2px;
}
`;

export function ensureMeasureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function rgba(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return c;
}

/** CSS custom properties for the label layer, per theme. */
export function applyMeasureTheme(el: HTMLElement, t: ThemeTokens) {
  const s = el.style;
  if (t.name === 'blueprint') {
    s.setProperty('--kd-dim-bg', t.bg);
    s.setProperty('--kd-dim-fg', '#ffffff');
    s.setProperty('--kd-dim-border', rgba(t.info, 0.6));
    s.setProperty('--kd-dim-border-strong', rgba(t.info, 0.85));
    s.setProperty('--kd-dim-shadow', `0 1px 2px ${rgba('#06152b', 0.25)}`);
    s.setProperty('--kd-dim-muted', t.infoMuted);
  } else {
    s.setProperty('--kd-dim-bg', '#ffffff');
    s.setProperty('--kd-dim-fg', t.info);
    s.setProperty('--kd-dim-border', rgba(t.info, 0.28));
    s.setProperty('--kd-dim-border-strong', rgba(t.info, 0.5));
    s.setProperty('--kd-dim-shadow', `0 0.5px 1.5px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)`);
    s.setProperty('--kd-dim-muted', t.infoMuted);
  }
  s.setProperty('--kd-dim-sel', t.select);
  s.setProperty('--kd-dim-sel-fg', t.name === 'blueprint' ? '#ffffff' : t.info);
}
