// Finish picker ("Finition"): round colour swatches, optional "Globale" chip.
// Used by the Composition panel (global finish), the single-KALLAX
// inspector (per-unit override) and the multi-selection panel.
import { FINISHES, type FinishId } from '../core/finishes';
import { h } from './dom';
import { tip } from './controls';
import { t } from '../core/i18n';

/** A swatch: KALLAX finishes by default, or another palette (EKET colours). */
export interface Swatch<T extends string> { id: T; label: string; color: string }

export interface FinishPickerState<T extends string = FinishId> {
  /** Selected finish, or null (inheriting the global finish, or mixed selection). */
  value: T | null;
  /** The global (document) finish — shown in the "Globale" chip and as a faint ring when inheriting. */
  global: T;
  /** True when the item(s) follow the global finish (no override). */
  inherit?: boolean;
  /** True when several items with different finishes are selected. */
  mixed?: boolean;
  /** Returns a reason when the finish is not sold for the model(s) — the swatch is dimmed. */
  unavailable?: (f: T) => string | null;
  disabled?: boolean;
}

export interface FinishPicker<T extends string = FinishId> { el: HTMLElement; set(s: FinishPickerState<T>): void }

export function finishPicker<T extends string = FinishId>(o: {
  title?: string;
  ariaLabel: string;
  /** Show the leading "Globale · …" chip (per-unit overrides). Picking it calls onPick(null). */
  withGlobal?: boolean;
  /** Swatches (default: the KALLAX finishes). */
  list?: Swatch<T>[];
  onPick: (f: T | null) => void;
}): FinishPicker<T> {
  const LIST = (o.list ?? FINISHES) as Swatch<T>[];
  const BY_ID = Object.fromEntries(LIST.map(f => [f.id, f])) as Record<T, Swatch<T>>;
  const current = h('span', { class: 'finish-current' });
  const head = h('div', { class: 'insp-title-row finish-head' }, h('h4', { class: 'insp-title' }, o.title ?? t('common.finish')), current);

  let globalChip: HTMLButtonElement | null = null;
  const globalDot = h('span', { class: 'finish-dot', 'aria-hidden': 'true' });
  const globalText = h('span', null);
  if (o.withGlobal) {
    globalChip = h('button', { type: 'button', class: 'chip finish-global', role: 'radio', 'aria-checked': 'false' },
      globalDot, globalText);
    globalChip.addEventListener('click', () => { if (!globalChip!.disabled) o.onPick(null); });
  }

  const sw = LIST.map(f => {
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

  const set = (s: FinishPickerState<T>) => {
    const gl = BY_ID[s.global] ?? LIST[0];
    const inherit = !!s.inherit && !s.mixed;
    if (globalChip) {
      globalDot.style.setProperty('--sw', gl.color);
      globalText.textContent = t('fp.global', { label: gl.label });
      globalChip.classList.toggle('on', inherit);
      globalChip.setAttribute('aria-checked', String(inherit));
      globalChip.disabled = !!s.disabled;
      tip(globalChip, t('fp.globalTip', { label: gl.label }));
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
    const label = s.mixed ? t('fp.mixed') : inherit ? gl.label : s.value ? (BY_ID[s.value]?.label ?? gl.label) : gl.label;
    const why = !s.mixed && (inherit ? s.unavailable?.(s.global) : s.value ? s.unavailable?.(s.value) : null);
    current.replaceChildren(label);
    if (inherit && o.withGlobal) current.append(h('span', { class: 'finish-sub' }, t('fp.globalSuffix')));
    current.classList.toggle('na', !!why);
    el.classList.toggle('disabled', !!s.disabled);
  };
  return { el, set };
}
