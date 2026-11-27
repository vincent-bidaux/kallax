// Left sidebar: segmented tabs Bibliothèque | Composants | Calques.
import { h } from './dom';
import { segmented } from './controls';
import { t } from '../core/i18n';
import { buildLibrary } from './sidebar-library';
import { buildLayers } from './sidebar-layers';
import { buildComponents } from './sidebar-components';

type Tab = 'lib' | 'comp' | 'layers';

const LS_TAB = 'kallax-designer:sidebar-tab';

let sidebarApi: { showTab(v: Tab): void } | null = null;
/** Switch the sidebar to a tab (e.g. Composants after adding one). */
export function showSidebarTab(v: Tab) { sidebarApi?.showTab(v); }

export function buildSidebar(host: HTMLElement) {
  const libPane = h('div', { class: 'pane', id: 'pane-lib', role: 'tabpanel', 'aria-label': t('common.library') });
  const compPane = h('div', { class: 'pane', id: 'pane-comp', role: 'tabpanel', 'aria-label': t('comp.tab') });
  const layPane = h('div', { class: 'pane', id: 'pane-layers', role: 'tabpanel', 'aria-label': t('common.layers') });
  let tab: Tab = (() => { try { const v = localStorage.getItem(LS_TAB); return v === 'layers' || v === 'comp' ? v : 'lib'; } catch { return 'lib'; } })();
  const show = (v: Tab) => {
    tab = v;
    libPane.hidden = v !== 'lib';
    compPane.hidden = v !== 'comp';
    layPane.hidden = v !== 'layers';
    try { localStorage.setItem(LS_TAB, v); } catch { /* ignore */ }
  };
  const tabs = segmented<Tab>({
    ariaLabel: t('sidebar.panelAria'), value: tab,
    options: [
      { value: 'lib', label: t('common.library'), tip: t('sidebar.libTip') },
      { value: 'comp', label: t('comp.tab'), tip: t('comp.tabTip') },
      { value: 'layers', label: t('common.layers'), tip: t('sidebar.layersTip') },
    ],
    onChange: show,
    cls: 'sidebar-tabs',
  });
  host.append(h('div', { class: 'sidebar-head' }, tabs.el), h('div', { class: 'sidebar-scroll' }, libPane, compPane, layPane));
  buildLibrary(libPane);
  buildComponents(compPane);
  buildLayers(layPane);
  show(tab);
  sidebarApi = { showTab(v: Tab) { tabs.set(v); show(v); } };
  return sidebarApi;
}
