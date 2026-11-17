// Finish picker ("Finition"): round colour swatches, optional "Globale" chip.
// Used by the Composition panel (global finish), the single-KALLAX
// inspector (per-unit override) and the multi-selection panel.
import { FINISHES, FINISH_BY_ID, type FinishId } from '../core/finishes';
import { h } from './dom';
import { tip } from './controls';

export interface FinishPickerState {
  /** Selected finish, or null (inheriting the global finish, or mixed selection). */
  value: FinishId | null;
  /** The global (document) finish — shown in the "Globale" chip and as a faint ring when inheriting. */
  global: FinishId;
  /** True when the item(s) follow the global finish (no override). */
  inherit?: boolean;
  /** True when several items with different finishes are selected. */
  mixed?: boolean;
  /** Returns a reason when the finish is not sold for the model(s) — the swatch is dimmed. */
  unavailable?: (f: FinishId) => string | null;
  disabled?: boolean;
}

export interface FinishPicker { el: HTMLElement; set(s: FinishPickerState): void }

export function finishPicker(o: {
  title?: string;
  ariaLabel: string;
  /** Show the leading "Globale · …" chip (per-unit overrides). Picking it calls onPick(null). */
  withGlobal?: boolean;
  onPick: (f: FinishId | null) => void;
}): FinishPicker {
  const current = h('span', { class: 'finish-current' });
  const head = h('div', { class: 'insp-title-row finish-head' }, h('h4', { class: 'insp-title' }, o.title ?? 'Finition'), current);

  let globalChip: HTMLButtonElement | null = null;
  const globalDot = h('span', { class: 'finish-dot', 'aria-hidden': 'true' });
  const globalText = h('span', null);
  if (o.withGlobal) {
    globalChip = h('button', { type: 'button', class: 'chip finish-global', role: 'radio', 'aria-checked': 'false' },
      globalDot, globalText);
    globalChip.addEventListener('click', () => { if (!globalChip!.disabled) o.onPick(null); });
  }

  const sw = FINISHES.map(f => {
    const b = h('button', {
      type: 'button', role: 'radio', class: `swatch sw-${f.id}`, 'aria-checked': 'false', tabindex: '-1',
      'aria-label': f.label, style: `--sw:${f.color}`,
    });
    b.addEventListener('click', () => { if (!b.disabled) o.onPick(f.id); });
    return { f, b };
  });
  const all = (): HTMLButtonElement[] => [...(globalChip ? [globalChip] : []), ...sw.map(s => s.b)];
  const group = h('div', { class: 'finish-group', role: 'radiogroup', 'aria-label': o.ariaLabel },
    globalChip ? h('div', { class: 'finish-global-row' }, globalChip) : null,
    h('div', { class: 'finish-swatches' }, sw.map(s => s.b)));
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = all();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[j].focus();
    list[j].click();
  });

  const el = h('div', { class: 'insp-group finish-picker' }, head, group);

  const set = (s: FinishPickerState) => {
    const gl = FINISH_BY_ID[s.global];
    const inherit = !!s.inherit && !s.mixed;
    if (globalChip) {
      globalDot.style.setProperty('--sw', gl.color);
      globalText.textContent = `Globale · ${gl.label}`;
      globalChip.classList.toggle('on', inherit);
      globalChip.setAttribute('aria-checked', String(inherit));
      globalChip.disabled = !!s.disabled;
      tip(globalChip, `Suivre la finition globale (${gl.label})`);
    }
    const shown = s.mixed ? null : inherit ? null : s.value;
    for (const { f, b } of sw) {
      const on = shown === f.id;
      const why = s.unavailable?.(f.id) ?? null;
      b.classList.toggle('on', on);
      b.classList.toggle('inherited', inherit && f.id === s.global);
      b.classList.toggle('na', !!why);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !!s.disabled;
      tip(b, why ? `${f.label} — ${why}` : f.label);
    }
    // roving tabindex
    const list = all();
    const sel = list.find(b => b.getAttribute('aria-checked') === 'true') ?? list[0];
    for (const b of list) b.tabIndex = b === sel ? 0 : -1;
    // label on the right
    const label = s.mixed ? 'Mixte' : inherit ? gl.label : s.value ? FINISH_BY_ID[s.value].label : gl.label;
    const why = !s.mixed && (inherit ? s.unavailable?.(s.global) : s.value ? s.unavailable?.(s.value) : null);
    current.replaceChildren(label);
    if (inherit && o.withGlobal) current.append(h('span', { class: 'finish-sub' }, ' · globale'));
    current.classList.toggle('na', !!why);
    el.classList.toggle('disabled', !!s.disabled);
  };
  return { el, set };
}
