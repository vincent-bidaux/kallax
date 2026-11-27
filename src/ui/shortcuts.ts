// Keyboard shortcuts sheet (modal <dialog>).
import { h, MOD, SHIFT } from './dom';
import { icon } from './icons';
import { t } from '../core/i18n';

const GROUPS: [string, [string, string[]][]][] = [
  [t('sc.edit'), [
    [t('sc.undo'), [`${MOD}Z`]],
    [t('sc.redo'), [`${SHIFT}${MOD}Z`, `${MOD}Y`]],
    [t('sc.dupRight'), [`${MOD}D`]],
    [t('sc.selectAll'), [`${MOD}A`]],
    [t('sc.delete'), ['⌫', t('key.del')]],
    [t('sc.deselect'), [t('key.esc')]],
  ]],
  [t('sc.groups'), [
    [t('sc.group'), [`${MOD}G`]],
    [t('sc.ungroup'), [`${SHIFT}${MOD}G`]],
    [t('sc.enterGroup'), [t('key.dblclick'), `⌥${t('key.click')}`]],
    [t('sc.exitGroup'), [t('key.esc')]],
  ]],
  [t('sc.objects'), [
    [t('sc.rotCw'), ['R']],
    [t('sc.rotCcw'), [`${SHIFT}R`]],
    [t('sc.rotHandle'), [t('key.drag')]],
    [t('sc.rotPick'), [t('key.esc')]],
    [t('sc.tilt'), ['X', 'Y']],
    [t('sc.nudge'), ['←', '↑', '→', '↓']],
    [t('sc.nudge10'), [SHIFT, '←↑→↓']],
    [t('sc.nudgeFine'), ['⌥', '←↑→↓']],
    [t('sc.dupDrag'), ['⌥', t('key.drag')]],
    [t('sc.upDown'), ['Page↑', 'Page↓']],
    [t('sc.multi'), [`${SHIFT}${t('key.click')}`, `${MOD}${t('key.click')}`]],
  ]],
  [t('sc.view'), [
    [t('sc.iso'), ['1']],
    [t('sc.cavalier'), ['2']],
    [t('sc.fit'), ['F']],
    [t('sc.proj'), ['P']],
    [t('sc.dims'), ['M']],
    [t('sc.grid'), ['G']],
    [t('sc.shortcuts'), ['?']],
  ]],
];

export function buildShortcutsSheet() {
  const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': t('common.close') }, icon('xmark', 14));
  const dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title' },
    h('div', { class: 'sheet-head' }, icon('keyboard', 18), h('h2', { id: 'sheet-title' }, t('sc.title')), close),
    // three columns: Édition + Groupes | Objets | Vue
    h('div', { class: 'sheet-cols' }, [[0, 1], [2], [3]].map(col => h('div', { class: 'sheet-col' }, col.map(i => {
      const [title, rows] = GROUPS[i];
      return h('div', { class: 'sheet-group' }, h('h3', null, title),
        h('dl', null, rows.map(([label, keys]) => [
          h('dt', null, label),
          h('dd', null, keys.map(k => h('kbd', null, k))),
        ]).flat()));
    })))),
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
