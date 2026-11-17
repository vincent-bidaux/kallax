// Floating UI inside the viewport: "Revenir en" pill (free view) and empty state.
import { store } from '../core/store';
import { h } from './dom';
import { icon } from './icons';
import { tip } from './controls';
import * as cmd from '../interaction/commands';

export function buildViewportOverlays(host: HTMLElement) {
  const isoBtn = h('button', { type: 'button', class: 'pill-btn' }, icon('iso', 14), 'Isométrique');
  const cavBtn = h('button', { type: 'button', class: 'pill-btn' }, icon('cavalier', 14), 'Cavalière');
  tip(isoBtn, 'Revenir à la vue isométrique', '1');
  tip(cavBtn, 'Revenir à la perspective cavalière', '2');
  isoBtn.addEventListener('click', () => cmd.setView('iso'));
  cavBtn.addEventListener('click', () => cmd.setView('cavalier'));
  const pill = h('div', { class: 'vp-pill', role: 'group', 'aria-label': 'Revenir à une vue prédéfinie', 'data-ui-overlay': '' },
    h('span', { class: 'pill-text' }, icon('orbit', 14), 'Revenir en'), isoBtn, cavBtn);

  const empty = h('div', { class: 'vp-empty', 'data-ui-overlay': '' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon('cube', 34)),
    h('div', { class: 'empty-title' }, 'Glissez un KALLAX depuis la bibliothèque'),
    h('div', { class: 'empty-sub' }, 'Les meubles s’aimantent à la grille et entre eux. Empilez-les à côté, derrière ou dessus.'));

  host.append(pill, empty);

  const sync = () => {
    pill.classList.toggle('show', store.settings.view === 'free' || !['iso', 'cavalier'].includes(store.settings.view));
    empty.classList.toggle('show', store.items.length === 0);
  };
  store.on(e => { if (e === 'settings' || e === 'doc') sync(); });
  sync();
}
