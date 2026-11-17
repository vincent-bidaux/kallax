// Bottom status bar: cursor coordinates, snapping, selection, hints.
import { store } from '../core/store';
import { fmtCm } from '../core/kallax';
import { ui } from '../interaction/context';
import { h, MOD } from './dom';
import { icon } from './icons';

export function buildStatusbar(host: HTMLElement) {
  const cx = h('span', { class: 'coord-v' }, '—');
  const cy = h('span', { class: 'coord-v' }, '—');
  const coords = h('div', { class: 'sb-item sb-coords', 'aria-label': 'Coordonnées du curseur au sol' },
    icon('target', 12), h('span', { class: 'axis-x' }, 'X'), cx, h('span', { class: 'axis-y' }, 'Y'), cy);
  const snap = h('div', { class: 'sb-item sb-snap' });
  const sel = h('div', { class: 'sb-item sb-sel' });
  const hint = h('div', { class: 'sb-item sb-hint', 'aria-live': 'polite' });
  host.append(coords, h('div', { class: 'sb-sep' }), snap, h('div', { class: 'sb-sep' }), sel, h('div', { class: 'sb-spacer' }), hint);
  host.setAttribute('role', 'status');

  const updCursor = () => {
    const p = ui.cursor;
    cx.textContent = p ? fmtCm(p.x) : '—';
    cy.textContent = p ? fmtCm(p.y) : '—';
  };
  const updSnap = () => {
    const s = store.settings;
    snap.replaceChildren(icon('magnet', 12));
    if (ui.gesture !== 'none' && ui.snap) {
      snap.append(h('span', { class: 'snap-live' }, ui.snap));
    } else {
      const parts: string[] = [];
      if (s.snapGrid) parts.push(`grille ${fmtCm(s.gridCell)} cm`);
      if (s.snapItems) parts.push('objets');
      snap.append(h('span', null, parts.length ? `Aimant : ${parts.join(' + ')}` : 'Aimant désactivé'));
    }
    snap.classList.toggle('off', !s.snapGrid && !s.snapItems);
  };
  const updSel = () => {
    const n = store.selection.length;
    const total = store.items.length;
    sel.textContent = n ? `${n} sélectionné${n > 1 ? 's' : ''} sur ${total}` : `${total} objet${total > 1 ? 's' : ''}`;
  };
  const updHint = () => {
    hint.classList.toggle('bad', ui.gesture !== 'none' && !ui.gestureValid);
    if (ui.gesture === 'place') hint.textContent = ui.gestureValid ? 'Relâchez pour déposer · Échap pour annuler' : 'Emplacement occupé · Échap pour annuler';
    else if (ui.gesture === 'move') hint.textContent = ui.gestureValid ? 'Relâchez pour placer · Échap pour annuler' : 'Position invalide (chevauchement)';
    else if (ui.insertTool) hint.textContent = ui.toolHint ?? 'Habillage : cliquez dans une case d’un Kallax · Échap pour terminer';
    else if (store.selection.length) hint.textContent = `R/X/Y pivoter · ${MOD}D ou ⌥glisser dupliquer · ←↑→↓ déplacer (⌥ fin) · ⌫ supprimer`;
    else hint.textContent = 'Glisser : orbiter · clic : sélectionner · F cadrer · ? raccourcis';
  };
  ui.on(e => {
    if (e === 'cursor') updCursor();
    if (e === 'tool') updHint();
    if (e === 'snap' || e === 'gesture') { updSnap(); updHint(); }
  });
  store.on(e => {
    if (e === 'settings') updSnap();
    if (e === 'selection' || e === 'doc') { updSel(); updHint(); }
  });
  updCursor(); updSnap(); updSel(); updHint();
}
