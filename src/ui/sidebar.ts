// Left sidebar: segmented tabs Bibliothèque | Calques.
import { h } from './dom';
import { segmented } from './controls';
import { t } from '../core/i18n';
import { buildLibrary } from './sidebar-library';
import { buildLayers } from './sidebar-layers';

const LS_TAB = 'kallax-designer:sidebar-tab';

export function buildSidebar(host: HTMLElement) {
  const libPane = h('div', { class: 'pane', id: 'pane-lib', role: 'tabpanel', 'aria-label': t('common.library') });
  const layPane = h('div', { class: 'pane', id: 'pane-layers', role: 'tabpanel', 'aria-label': t('common.layers') });
  let tab = (localStorage.getItem(LS_TAB) as 'lib' | 'layers') || 'lib';
  const show = (t: 'lib' | 'layers') => {
    tab = t;
    libPane.hidden = t !== 'lib';
    layPane.hidden = t !== 'layers';
    try { localStorage.setItem(LS_TAB, t); } catch { /* ignore */ }
  };
  const tabs = segmented<'lib' | 'layers'>({
    ariaLabel: t('sidebar.panelAria'), value: tab,
    options: [{ value: 'lib', label: t('common.library'), icon: 'books' }, { value: 'layers', label: t('common.layers'), icon: 'layers' }],
    onChange: show,
    cls: 'sidebar-tabs',
  });
  host.append(h('div', { class: 'sidebar-head' }, tabs.el), h('div', { class: 'sidebar-scroll' }, libPane, layPane));
  buildLibrary(libPane);
  buildLayers(layPane);
  show(tab);
  return {
    showTab(t: 'lib' | 'layers') { tabs.set(t); show(t); },
  };
}
