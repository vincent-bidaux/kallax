// Global keyboard shortcuts (ignored while typing in a field).
import { store } from '../core/store';
import { isTyping, toast } from '../ui/dom';
import * as cmd from './commands';
import { cancelActiveDrag } from './drag-drop';
import { cancelActiveMove } from './select-move';
import { closeAllPopovers } from '../ui/popover';

export interface KeyboardHooks {
  openShortcuts(): void;
  isModalOpen(): boolean;
}

export function installKeyboard(hooks: KeyboardHooks) {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || hooks.isModalOpen()) return;
    if (isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const kl = k.length === 1 ? k.toLowerCase() : k;
    const grid = store.settings.gridCell;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    // focus inside a popover / segmented control: let arrows work natively
    const inWidget = (e.target as HTMLElement)?.closest?.('.popover, .segmented, [role=menu], .layers-list, .lib-grid');

    if (mod) {
      if (kl === 'z' && !e.shiftKey) { handled(); store.undo(); return; }
      if ((kl === 'z' && e.shiftKey) || kl === 'y') { handled(); store.redo(); return; }
      if (kl === 'd') { handled(); cmd.duplicate('x'); return; }
      if (kl === 'a') { handled(); cmd.selectAll(); return; }
      return;
    }
    if (e.altKey) return;

    switch (k) {
      case 'Escape':
        if (cancelActiveDrag() || cancelActiveMove()) { handled(); return; }
        closeAllPopovers();
        if (store.selection.length) { handled(); store.select([]); }
        return;
      case 'Delete':
      case 'Backspace':
        if (store.selection.length) { handled(); cmd.deleteSelection(); }
        return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (inWidget || !store.selection.length) return;
        handled();
        const s = grid * (e.shiftKey ? 10 : 1);
        if (k === 'ArrowLeft') cmd.nudge(-s, 0, 0);
        if (k === 'ArrowRight') cmd.nudge(s, 0, 0);
        if (k === 'ArrowUp') cmd.nudge(0, s, 0);
        if (k === 'ArrowDown') cmd.nudge(0, -s, 0);
        return;
      }
      case 'PageUp': case 'PageDown': {
        if (!store.selection.length) return;
        handled();
        const s = grid * (e.shiftKey ? 10 : 1);
        cmd.nudge(0, 0, k === 'PageUp' ? s : -s);
        return;
      }
    }
    if (inWidget && (k === ' ' || k === 'Enter')) return;
    switch (kl) {
      case 'r': handled(); cmd.rotateSelection(e.shiftKey ? -90 : 90); return;
      case '1': handled(); cmd.setView('iso'); return;
      case '2': handled(); cmd.setView('cavalier'); return;
      case 'f': handled(); cmd.zoomToFit(); return;
      case 'p': handled(); cmd.toggleProjection(); return;
      case 'm':
        handled(); cmd.toggleSetting('measureItems');
        toast(store.settings.measureItems ? 'Cotes par bloc affichées' : 'Cotes par bloc masquées', 1400);
        return;
      case 'g':
        handled(); cmd.toggleSetting('showGrid');
        toast(store.settings.showGrid ? 'Grille affichée' : 'Grille masquée', 1400);
        return;
      case '?': handled(); hooks.openShortcuts(); return;
    }
  });
}
