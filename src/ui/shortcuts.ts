// Keyboard shortcuts sheet (modal <dialog>).
import { h, MOD, SHIFT } from './dom';
import { icon } from './icons';

const GROUPS: [string, [string, string[]][]][] = [
  ['Édition', [
    ['Annuler', [`${MOD}Z`]],
    ['Rétablir', [`${SHIFT}${MOD}Z`, `${MOD}Y`]],
    ['Dupliquer à droite', [`${MOD}D`]],
    ['Tout sélectionner', [`${MOD}A`]],
    ['Supprimer', ['⌫', 'Suppr']],
    ['Désélectionner / annuler', ['Échap']],
  ]],
  ['Objets', [
    ['Pivoter +90°', ['R']],
    ['Pivoter −90°', [`${SHIFT}R`]],
    ['Basculer autour de X / Y', ['X', 'Y']],
    ['Déplacer d’un pas de grille', ['←', '↑', '→', '↓']],
    ['Déplacer ×10', [SHIFT, '←↑→↓']],
    ['Monter / descendre', ['Page↑', 'Page↓']],
    ['Sélection multiple', [`${SHIFT}clic`, `${MOD}clic`]],
  ]],
  ['Vue', [
    ['Isométrique', ['1']],
    ['Cavalière', ['2']],
    ['Cadrer', ['F']],
    ['Perspective / ortho', ['P']],
    ['Cotes par bloc', ['M']],
    ['Grille', ['G']],
    ['Raccourcis', ['?']],
  ]],
];

export function buildShortcutsSheet() {
  const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Fermer' }, icon('xmark', 14));
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-head' }, icon('keyboard', 18), h('h2', { id: 'sheet-title' }, 'Raccourcis clavier'), close),
    h('div', { class: 'sheet-cols' }, GROUPS.map(([title, rows]) =>
      h('div', { class: 'sheet-group' }, h('h3', null, title),
        h('dl', null, rows.map(([label, keys]) => [
          h('dt', null, label),
          h('dd', null, keys.map(k => h('kbd', null, k))),
        ]).flat())))),
  );
  close.addEventListener('click', () => closeSheet());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeSheet(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  document.body.appendChild(dlg);
  function closeSheet() {
    dlg.classList.add('closing');
    setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 160);
  }
  return {
    open() { if (!dlg.open) dlg.showModal(); },
    isOpen: () => dlg.open,
  };
}
