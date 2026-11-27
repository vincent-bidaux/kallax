// Global keyboard shortcuts (ignored while typing in a field).
import { store } from '../core/store';
import { isTyping, toast } from '../ui/dom';
import { t } from '../core/i18n';
import * as cmd from './commands';
import { ui } from './context';
import { cancelActiveDrag } from './drag-drop';
import { cancelActiveMove } from './select-move';
import { cancelActiveRotate } from './rotate-tool';
import { closeAllPopovers } from '../ui/popover';

const FINE_STEP = 0.5;

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
      if (kl === 'g') { handled(); if (e.shiftKey) cmd.ungroupSelection(); else cmd.groupSelection(); return; }
      if (kl === 'a') { handled(); cmd.selectAll(); return; }
      return;
    }
    if (e.altKey && !k.startsWith('Arrow') && !k.startsWith('Page')) return;
    /** Nudge step: ⌥ = fine (0,5 cm), ⇧ = ×10 grid, else one grid cell. */
    const nudgeStep = e.altKey ? FINE_STEP : grid * (e.shiftKey ? 10 : 1);

    switch (k) {
      case 'Escape':
        if (cancelActiveDrag() || cancelActiveMove() || cancelActiveRotate()) { handled(); return; }
        if (ui.eyedropper) { handled(); ui.setEyedropper(false); return; }
        if (ui.insertTool) { handled(); ui.setInsertTool(null); return; }
        closeAllPopovers();
        if (store.exitGroup()) { handled(); return; }
        if (store.selection.length) { handled(); store.select([]); }
        return;
      case 'Delete':
      case 'Backspace':
        if (store.selection.length) { handled(); cmd.deleteSelection(); }
        return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (inWidget || !store.selection.length) return;
        handled();
        const s = nudgeStep;
        if (k === 'ArrowLeft') cmd.nudge(-s, 0, 0);
        if (k === 'ArrowRight') cmd.nudge(s, 0, 0);
        if (k === 'ArrowUp') cmd.nudge(0, s, 0);
        if (k === 'ArrowDown') cmd.nudge(0, -s, 0);
        return;
      }
      case 'PageUp': case 'PageDown': {
        if (!store.selection.length) return;
        handled();
        const s = nudgeStep;
        cmd.nudge(0, 0, k === 'PageUp' ? s : -s);
        return;
      }
    }
    if (inWidget && (k === ' ' || k === 'Enter')) return;
    switch (kl) {
      case 'r': case 'R': handled(); cmd.rotateSelection(e.shiftKey ? -cmd.ROT_STEP : cmd.ROT_STEP, 'z'); return;
      case 'x': case 'X': handled(); cmd.rotateSelection(e.shiftKey ? -90 : 90, 'x'); return;
      case 'y': case 'Y': handled(); cmd.rotateSelection(e.shiftKey ? -90 : 90, 'y'); return;
      case '1': handled(); cmd.setView('iso'); return;
      case '2': handled(); cmd.setView('cavalier'); return;
      case 'f': handled(); cmd.zoomToFit(); return;
      case 'p': handled(); cmd.toggleProjection(); return;
      case 'm':
        handled(); cmd.toggleSetting('measureItems');
        toast(store.settings.measureItems ? t('cmd.dimsShown') : t('cmd.dimsHidden'), 1400);
        return;
      case 'g':
        handled(); cmd.toggleSetting('showGrid');
        toast(store.settings.showGrid ? t('cmd.gridShown') : t('cmd.gridHidden'), 1400);
        return;
      case '?': handled(); hooks.openShortcuts(); return;
    }
  });
}
