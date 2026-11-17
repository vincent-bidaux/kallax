// Kallax Designer — wiring.
import './styles.css';
import { store } from './core/store';
import { THEMES } from './core/theme';
import { Viewport } from './render/viewport';
import { Measurements } from './render/measurements';
import { ViewCube } from './render/viewcube';
import { ui } from './interaction/context';
import { installSelectMove } from './interaction/select-move';
import { installKeyboard } from './interaction/keyboard';
import { h } from './ui/dom';
import { installTooltips } from './ui/controls';
import { installPopoverDismiss } from './ui/popover';
import { buildToolbar } from './ui/toolbar';
import { buildSidebar } from './ui/sidebar';
import { buildInspector } from './ui/inspector';
import { buildStatusbar } from './ui/statusbar';
import { buildViewportOverlays } from './ui/viewport-overlays';
import { buildShortcutsSheet } from './ui/shortcuts';
import { seedIfFirstLaunch } from './ui/seed';

const LS_LAYOUT = 'kallax-designer:layout';

function applyTheme() {
  const t = store.settings.theme;
  const root = document.documentElement;
  root.classList.toggle('theme-paper', t === 'paper');
  root.classList.toggle('theme-blueprint', t !== 'paper');
  root.style.setProperty('--canvas-bg', THEMES[t].bg);
  root.style.setProperty('--canvas-vignette', THEMES[t].bgVignette);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'paper' ? '#ececee' : '#1e1e21');
}

function boot() {
  applyTheme();
  const root = document.getElementById('app') ?? document.body.appendChild(h('div', { id: 'app' }));
  root.replaceChildren();

  const toolbar = h('header', { class: 'toolbar', id: 'toolbar' });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Bibliothèque et calques' });
  const viewportEl = h('div', { id: 'viewport', class: 'viewport' });
  const main = h('main', { class: 'stage', 'aria-label': 'Vue 3D' }, viewportEl);
  const inspector = h('aside', { class: 'inspector', id: 'inspector', 'aria-label': 'Inspecteur' });
  const status = h('footer', { class: 'statusbar', id: 'statusbar' });
  root.append(toolbar, sidebar, main, inspector, status);

  // layout persistence (sidebar / inspector collapsed)
  let layout = { sidebar: true, inspector: true };
  try { layout = { ...layout, ...JSON.parse(localStorage.getItem(LS_LAYOUT) || '{}') }; } catch { /* ignore */ }
  const applyLayout = () => {
    root.classList.toggle('no-sidebar', !layout.sidebar);
    root.classList.toggle('no-inspector', !layout.inspector);
    sidebar.inert = !layout.sidebar;
    inspector.inert = !layout.inspector;
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(layout)); } catch { /* ignore */ }
  };
  applyLayout();

  // 3D
  const viewport = new Viewport(viewportEl);
  ui.viewport = viewport;
  new Measurements(viewport);
  new ViewCube(viewport, viewportEl);

  // chrome
  const sheet = buildShortcutsSheet();
  buildToolbar(toolbar, {
    toggleSidebar: () => { layout.sidebar = !layout.sidebar; applyLayout(); },
    toggleInspector: () => { layout.inspector = !layout.inspector; applyLayout(); },
    openShortcuts: () => sheet.open(),
  });
  buildSidebar(sidebar);
  buildInspector(inspector);
  buildStatusbar(status);
  buildViewportOverlays(viewportEl);

  installTooltips();
  installPopoverDismiss();
  installSelectMove(viewport);
  installKeyboard({ openShortcuts: () => sheet.open(), isModalOpen: () => sheet.isOpen() });

  store.on(ev => { if (ev === 'settings') applyTheme(); });

  // keep the canvas sized while sidebars animate
  root.addEventListener('transitionend', (e) => {
    if (e.target === root || e.target === sidebar || e.target === inspector) viewport.requestRender();
  });

  if (seedIfFirstLaunch()) {
    requestAnimationFrame(() => viewport.zoomToFit(false));
  }
  requestAnimationFrame(() => document.documentElement.classList.add('ready'));
}

boot();
