// Apple-style control factories: segmented control, switch, stepper,
// number/text fields, buttons, tooltips.
import { h, parseNum } from './dom';
import { icon } from './icons';
import { fmtCm } from '../core/kallax';

// ── tooltips ─────────────────────────────────────────────────
let tipEl: HTMLElement | null = null;
let tipTimer = 0;
let tipTarget: HTMLElement | null = null;
let tipWarm = false;
let warmTimer = 0;

/** Attach a tooltip (with optional shortcut). Also sets aria-label when the element has no text. */
export function tip<T extends HTMLElement>(el: T, text: string, kbd?: string): T {
  el.dataset.tip = text;
  if (kbd) el.dataset.kbd = kbd; else delete el.dataset.kbd;
  if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text);
  if (kbd) el.setAttribute('aria-keyshortcuts', kbd);
  return el;
}

function showTip(target: HTMLElement) {
  if (!tipEl) {
    tipEl = h('div', { class: 'tooltip', role: 'tooltip', id: 'app-tooltip' });
    document.body.appendChild(tipEl);
  }
  tipEl.replaceChildren(h('span', null, target.dataset.tip ?? ''));
  if (target.dataset.kbd) tipEl.appendChild(h('kbd', null, target.dataset.kbd));
  const r = target.getBoundingClientRect();
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  tipEl.classList.add('measure');
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  tipEl.classList.remove('measure');
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
  let y = r.bottom + 8;
  if (y + th > window.innerHeight - 8) y = r.top - th - 8;
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  tipEl.classList.add('visible');
  tipWarm = true;
  clearTimeout(warmTimer);
}

export function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  if (tipEl) tipEl.classList.remove('visible');
  clearTimeout(warmTimer);
  warmTimer = window.setTimeout(() => { tipWarm = false; }, 400);
}

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    const pe = e as PointerEvent;
    if (pe.pointerType === 'touch' || pe.buttons !== 0) return;
    const t = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (t === tipTarget) return;
    hideTip();
    if (!t || t.closest('.popover.open') && t.closest('.popover') !== t.closest('.popover')) return;
    if (document.body.classList.contains('dragging')) return;
    tipTarget = t;
    tipTimer = window.setTimeout(() => {
      const busy = document.body.classList.contains('dragging') || document.body.classList.contains('moving');
      if (tipTarget === t && t.isConnected && !busy) showTip(t);
    }, tipWarm ? 60 : 650);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (t?.dataset?.tip && t.matches(':focus-visible')) { tipTarget = t; showTip(t); }
  });
  document.addEventListener('focusout', hideTip);
}

// ── buttons ──────────────────────────────────────────────────
export interface ButtonOpts {
  icon?: string;
  label?: string;
  /** Hide the label visually (icon-only button), still used as aria-label. */
  iconOnly?: boolean;
  tip?: string;
  kbd?: string;
  cls?: string;
  onClick?: (e: MouseEvent) => void;
  iconSize?: number;
}

export function button(o: ButtonOpts): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `btn ${o.cls ?? ''} ${o.iconOnly ? 'icon-only' : ''}`.trim() });
  if (o.icon) b.appendChild(icon(o.icon, o.iconSize ?? 16));
  if (o.label) {
    if (o.iconOnly) b.setAttribute('aria-label', o.label);
    else b.appendChild(h('span', { class: 'btn-label' }, o.label));
  }
  if (o.tip || o.label) tip(b, o.tip ?? o.label!, o.kbd);
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

// ── segmented control ────────────────────────────────────────
export interface SegOption<T extends string | number> {
  value: T;
  label?: string;
  icon?: string;
  tip?: string;
  kbd?: string;
}

export interface Segmented<T extends string | number> {
  el: HTMLElement;
  set(v: T | null): void;
  get(): T | null;
  setDisabled(d: boolean): void;
}

export function segmented<T extends string | number>(o: {
  options: SegOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  cls?: string;
}): Segmented<T> {
  let value = o.value;
  const el = h('div', {
    class: `segmented ${o.size === 'sm' ? 'seg-sm' : ''} ${o.cls ?? ''}`.trim(),
    role: 'radiogroup',
    'aria-label': o.ariaLabel,
    style: `--n:${o.options.length}`,
  });
  const thumb = h('div', { class: 'seg-thumb', 'aria-hidden': 'true' });
  el.appendChild(thumb);
  const btns = o.options.map((opt, i) => {
    const b = h('button', {
      type: 'button', role: 'radio', class: 'seg-btn',
      'aria-checked': 'false', tabindex: '-1', dataset: { i: String(i) },
    });
    if (opt.icon) b.appendChild(icon(opt.icon, 15));
    if (opt.label) b.appendChild(h('span', null, opt.label));
    if (opt.tip || opt.kbd) tip(b, opt.tip ?? opt.label ?? '', opt.kbd);
    else if (!opt.label) b.setAttribute('aria-label', String(opt.value));
    b.addEventListener('click', () => {
      if (el.classList.contains('disabled')) return;
      if (value !== opt.value) { set(opt.value); o.onChange(opt.value); }
      else o.onChange(opt.value);
    });
    b.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const j = (i + (k === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
      btns[j].focus();
      btns[j].click();
    });
    el.appendChild(b);
    return b;
  });

  function set(v: T | null) {
    value = v;
    const idx = o.options.findIndex(x => x.value === v);
    el.style.setProperty('--i', String(Math.max(0, idx)));
    el.classList.toggle('no-sel', idx < 0);
    btns.forEach((b, i) => {
      const on = i === idx;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
      b.tabIndex = on || (idx < 0 && i === 0) ? 0 : -1;
    });
  }
  set(value);
  // Enable thumb transition only after first paint (no slide-in on load).
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready')));

  return {
    el,
    set,
    get: () => value,
    setDisabled(d: boolean) {
      el.classList.toggle('disabled', d);
      el.setAttribute('aria-disabled', String(d));
      btns.forEach(b => { b.disabled = d; });
    },
  };
}

// ── switch ───────────────────────────────────────────────────
export interface Switch { el: HTMLElement; input: HTMLButtonElement; set(v: boolean): void }

export function switchRow(o: {
  label: string; value: boolean; onChange: (v: boolean) => void;
  icon?: string; hint?: string; kbd?: string;
}): Switch {
  const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
  const input = h('button', {
    type: 'button', role: 'switch', class: 'switch', id,
    'aria-checked': String(o.value), 'aria-labelledby': `${id}-l`,
  }, h('span', { class: 'switch-knob' }));
  if (o.kbd) input.setAttribute('aria-keyshortcuts', o.kbd);
  const set = (v: boolean) => { input.setAttribute('aria-checked', String(v)); input.classList.toggle('on', v); };
  set(o.value);
  input.addEventListener('click', () => {
    const v = input.getAttribute('aria-checked') !== 'true';
    set(v); o.onChange(v);
  });
  const labelEl = h('label', { class: 'row-label', id: `${id}-l`, for: id },
    o.icon ? icon(o.icon, 15, 'row-icon') : null,
    h('span', { class: 'row-text' }, o.label, o.hint ? h('small', null, o.hint) : null),
  );
  labelEl.addEventListener('click', (e) => { e.preventDefault(); input.click(); });
  const el = h('div', { class: 'row switch-row' }, labelEl,
    o.kbd ? h('kbd', { class: 'row-kbd' }, o.kbd) : null, input);
  return { el, input, set };
}

// ── stepper ──────────────────────────────────────────────────
export interface Stepper { el: HTMLElement; set(v: number): void; setDisabled(d: boolean): void }

export function stepper(o: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}): Stepper {
  let value = o.value;
  const out = h('output', { class: 'stepper-val', 'aria-live': 'polite' }, String(value));
  const dec = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `${o.label} : moins` }, icon('minus', 13));
  const inc = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `${o.label} : plus` }, icon('plus', 13));
  const group = h('div', { class: 'stepper', role: 'group', 'aria-label': o.label }, dec, out, inc);
  const el = h('div', { class: 'field field-stepper' }, h('span', { class: 'field-label' }, o.label), group);
  let disabled = false;
  const set = (v: number) => {
    value = v; out.textContent = String(v);
    dec.disabled = disabled || v <= o.min; inc.disabled = disabled || v >= o.max;
  };
  dec.addEventListener('click', () => { if (value > o.min) { set(value - 1); o.onChange(value); } });
  inc.addEventListener('click', () => { if (value < o.max) { set(value + 1); o.onChange(value); } });
  set(value);
  return { el, set, setDisabled(d) { disabled = d; set(value); } };
}

// ── number field ─────────────────────────────────────────────
export interface NumberField {
  el: HTMLElement; input: HTMLInputElement;
  set(v: number): void; setStep(s: number): void; setDisabled(d: boolean): void;
}

/**
 * Text input for cm values: accepts "12,5" or "12.5", Enter/blur commits,
 * ↑/↓ add ±step (⇧ ×10). `set()` never overwrites while the user is typing.
 * Dragging the label horizontally scrubs the value.
 */
export function numberField(o: {
  label: string; value: number; step: number; onCommit: (v: number) => void;
  min?: number; max?: number; suffix?: string; axis?: 'x' | 'y' | 'z'; ariaLabel?: string;
}): NumberField {
  let value = o.value;
  let step = o.step;
  const input = h('input', {
    type: 'text', inputmode: 'decimal', class: 'num-input', autocomplete: 'off', spellcheck: 'false',
    'aria-label': o.ariaLabel ?? o.label,
  });
  const lab = h('span', { class: `field-label ${o.axis ? `axis axis-${o.axis}` : ''}`, 'aria-hidden': 'true' }, o.label);
  const box = h('div', { class: 'num-box' }, input, o.suffix ? h('span', { class: 'num-suffix', 'aria-hidden': 'true' }, o.suffix) : null);
  const el = h('div', { class: 'field field-num' }, lab, box);
  const show = () => { input.value = fmtCm(value); };
  const clamp = (v: number) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const commit = () => {
    const v = parseNum(input.value);
    if (v === null) { show(); return; }
    const c = clamp(Math.round(v * 10) / 10);
    if (Math.abs(c - value) > 1e-6) { value = c; o.onCommit(c); }
    show();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.select(); }
    else if (e.key === 'Escape') { e.preventDefault(); show(); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseNum(input.value) ?? value;
      const s = step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      input.value = fmtCm(clamp(Math.round((cur + s) * 10) / 10));
      commit();
    }
    e.stopPropagation();
  });
  input.addEventListener('focus', () => { requestAnimationFrame(() => input.select()); });
  input.addEventListener('blur', commit);

  // Scrub on label drag
  lab.addEventListener('pointerdown', (e) => {
    if (input.disabled) return;
    e.preventDefault();
    const x0 = e.clientX; const v0 = value; let moved = false;
    lab.setPointerCapture(e.pointerId);
    document.body.classList.add('scrubbing');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      if (!moved) return;
      const v = clamp(Math.round((v0 + Math.round(dx / 4) * step) * 10) / 10);
      input.value = fmtCm(v);
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      document.body.classList.remove('scrubbing');
      if (moved) commit(); else input.focus();
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up, { once: true });
    lab.addEventListener('pointercancel', up, { once: true });
  });

  show();
  return {
    el, input,
    set(v) { value = v; if (document.activeElement !== input) show(); },
    setStep(s) { step = s; },
    setDisabled(d) { input.disabled = d; el.classList.toggle('disabled', d); },
  };
}

// ── text field ───────────────────────────────────────────────
export interface TextField { el: HTMLElement; input: HTMLInputElement; set(v: string): void; setDisabled(d: boolean): void }

export function textField(o: { label?: string; value: string; onCommit: (v: string) => void; placeholder?: string; cls?: string; ariaLabel?: string }): TextField {
  let value = o.value;
  const input = h('input', {
    type: 'text', class: 'text-input', value, placeholder: o.placeholder ?? '', spellcheck: 'false',
    'aria-label': o.ariaLabel ?? o.label ?? o.placeholder ?? '',
  });
  const commit = () => {
    const v = input.value.trim();
    if (!v) { input.value = value; return; }
    if (v !== value) { value = v; o.onCommit(v); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.value = value; input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', commit);
  const el = o.label
    ? h('div', { class: `field field-text ${o.cls ?? ''}` }, h('span', { class: 'field-label' }, o.label), input)
    : h('div', { class: `field-text-bare ${o.cls ?? ''}` }, input);
  return {
    el, input,
    set(v) { value = v; if (document.activeElement !== input) input.value = v; },
    setDisabled(d) { input.disabled = d; },
  };
}

/** Section with uppercase small heading (macOS sidebar style). */
export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, title), ...children);
}
