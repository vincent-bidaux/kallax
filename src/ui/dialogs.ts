// macOS-style alert and text-prompt sheets (modal <dialog>), shared by
// projects and components.
import { h } from './dom';
import { icon } from './icons';
import { t } from '../core/i18n';

export interface AlertBtn { label: string; value: string; kind: 'plain' | 'primary' | 'destructive' }

/** Alert with buttons. Resolves with the value of the button pressed (Escape = 'cancel' if offered). */
export function alertSheet(o: { title: string; message?: string; buttons: AlertBtn[]; icon?: string }): Promise<string> {
  return new Promise(resolve => {
    const btns = o.buttons.map(b => h('button', { type: 'button', class: `alert-btn ${b.kind}` }, b.label));
    const dlg = h('dialog', { class: 'alert', 'aria-labelledby': 'alert-title', 'aria-describedby': o.message ? 'alert-msg' : undefined },
      h('div', { class: 'alert-icon' }, icon(o.icon ?? 'cube', 26)),
      h('h2', { class: 'alert-title', id: 'alert-title' }, o.title),
      o.message ? h('p', { class: 'alert-msg', id: 'alert-msg' }, o.message) : null,
      h('div', { class: 'alert-btns' }, btns),
    );
    const finish = (v: string) => { dlg.close(); dlg.remove(); resolve(v); };
    btns.forEach((b, i) => b.addEventListener('click', () => finish(o.buttons[i].value)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(o.buttons.some(b => b.value === 'cancel') ? 'cancel' : o.buttons[0].value); });
    document.body.appendChild(dlg);
    dlg.showModal();
    const def = o.buttons.findIndex(b => b.kind !== 'plain');
    (btns[def >= 0 ? def : btns.length - 1]).focus();
  });
}

/** Ask for a name. Resolves with the trimmed text (empty → `fallback`), or null when cancelled. */
export function promptName(o: {
  title: string; value: string; note?: string; noteIcon?: string;
  icon?: string; okLabel?: string; ariaLabel?: string; fallback?: string; message?: string;
}): Promise<string | null> {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', class: 'alert-input', value: o.value, spellcheck: 'false', 'aria-label': o.ariaLabel ?? t('prj.nameAria') });
    const cancel = h('button', { type: 'button', class: 'alert-btn plain' }, t('common.cancel'));
    const ok = h('button', { type: 'submit', class: 'alert-btn primary' }, o.okLabel ?? t('common.save'));
    const form = h('form', { method: 'dialog', class: 'alert-form' }, input,
      o.note ? h('p', { class: 'alert-where' }, icon(o.noteIcon ?? 'laptop', 13), o.note) : null,
      h('div', { class: 'alert-btns' }, cancel, ok));
    const dlg = h('dialog', { class: 'alert', 'aria-labelledby': 'prompt-title' },
      h('div', { class: 'alert-icon' }, icon(o.icon ?? 'floppy', 26)),
      h('h2', { class: 'alert-title', id: 'prompt-title' }, o.title),
      o.message ? h('p', { class: 'alert-msg' }, o.message) : null,
      form,
    );
    const finish = (v: string | null) => { dlg.close(); dlg.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(input.value.trim() || o.fallback || t('doc.untitled')); });
    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    input.addEventListener('keydown', e => e.stopPropagation());
    document.body.appendChild(dlg);
    dlg.showModal();
    input.select();
  });
}
