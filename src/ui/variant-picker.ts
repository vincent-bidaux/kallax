// Variant + colour pickers for catalogue objects with presets (bed, lamp,
// plant, desk, chair…), shared by the library editor and the inspector.
//  · variants with a `groupKey` → a small type segmented control, then the
//    size / model chips of the selected type; otherwise one chip row
//  · colours (ObjectVariant.colors) → round swatches (two-tone when hex2)
import { OBJECT_BY_SHAPE, variantOf, type ObjectColor, type ObjectVariant } from '../core/objects';
import type { BlockShape } from '../core/types';
import { fmtCm } from '../core/kallax';
import { t, type TKey } from '../core/i18n';
import { h } from './dom';
import { segmented, tip } from './controls';
import { icon } from './icons';

export const variantDims = (v: ObjectVariant) => `${fmtCm(v.size.w)} × ${fmtCm(v.size.d)} × ${fmtCm(v.size.h)} cm`;
export const variantNote = (v: ObjectVariant | undefined) => (v?.noteKey ? t(v.noteKey as TKey) : '');
const variantTip = (v: ObjectVariant) => [variantDims(v), variantNote(v)].filter(Boolean).join(' · ');

/** Ordered type groups of a shape's variants ([] when the variants are not grouped). */
export function variantGroups(shape: BlockShape): string[] {
  const vs = OBJECT_BY_SHAPE[shape]?.variants ?? [];
  if (!vs.some(v => v.groupKey)) return [];
  return [...new Set(vs.map(v => v.groupKey ?? ''))];
}

export interface VariantPicker { el: HTMLElement; set(id: string | undefined): void; setDisabled(d: boolean): void }

export function variantPicker(o: { shape: BlockShape; value: string | undefined; onPick: (id: string) => void; cls?: string }): VariantPicker {
  const def = OBJECT_BY_SHAPE[o.shape];
  const vs = def.variants ?? [];
  const groups = variantGroups(o.shape);
  /** Last variant picked in each group (switching type comes back to it). */
  const lastIn = new Map<string, string>();
  let current = variantOf(o.shape, o.value)?.id;
  let shownGroup = variantOf(o.shape, current)?.groupKey ?? groups[0] ?? '';
  let disabled = false;

  const seg = groups.length > 1 ? segmented<string>({
    ariaLabel: t('obj.typeGroupAria'), size: 'sm', value: shownGroup, cls: 'variant-groups',
    options: groups.map(g => ({ value: g, label: t(g as TKey) })),
    onChange: g => {
      if (g === shownGroup) return;
      shownGroup = g;
      const pick = lastIn.get(g) ?? vs.find(v => (v.groupKey ?? '') === g)?.id;
      renderChips();
      if (pick && pick !== current) o.onPick(pick);
    },
  }) : null;
  const chipsEl = h('div', { class: 'chips variant-chips', role: 'group', 'aria-label': t('obj.variantsAria') });
  let chipBtns: { el: HTMLButtonElement; id: string }[] = [];
  const renderChips = () => {
    const list = groups.length ? vs.filter(v => (v.groupKey ?? '') === shownGroup) : vs;
    chipBtns = list.map(v => {
      const el = h('button', { type: 'button', class: 'chip' }, t(v.labelKey as TKey));
      tip(el, variantTip(v));
      el.addEventListener('click', () => { if (v.id !== current) o.onPick(v.id); });
      return { el, id: v.id };
    });
    chipsEl.replaceChildren(...chipBtns.map(c => c.el));
    sync();
  };
  const sync = () => {
    for (const c of chipBtns) {
      const on = c.id === current;
      c.el.classList.toggle('on', on);
      c.el.setAttribute('aria-pressed', String(on));
      c.el.disabled = disabled;
    }
  };
  const el = h('div', { class: `variant-picker ${o.cls ?? ''}`.trim() }, seg?.el ?? null, chipsEl);

  const set = (id: string | undefined) => {
    const v = variantOf(o.shape, id);
    current = v?.id;
    if (v) lastIn.set(v.groupKey ?? '', v.id);
    const g = v?.groupKey ?? groups[0] ?? '';
    if (g !== shownGroup || !chipBtns.length) { shownGroup = g; seg?.set(g); renderChips(); } else sync();
  };
  set(current);
  return {
    el, set,
    setDisabled(d) { disabled = d; seg?.setDisabled(d); sync(); },
  };
}

// ── colours ──────────────────────────────────────────────────
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200;
}

export interface ColorPicker { el: HTMLElement; set(colors: ObjectColor[] | undefined, id: string | undefined, disabled?: boolean): void }

/** Round colour swatches with the colour name on the right (like the KALLAX finish picker). */
export function colorPicker(o: { onPick: (id: string) => void; cls?: string }): ColorPicker {
  const name = h('span', { class: 'finish-current color-current' });
  const head = h('div', { class: 'insp-title-row finish-head' }, h('h4', { class: 'insp-title' }, t('obj.colorTitle')), name);
  const row = h('div', { class: 'finish-swatches color-swatches', role: 'radiogroup', 'aria-label': t('obj.colorAria') });
  let btns: { b: HTMLButtonElement; c: ObjectColor }[] = [];
  let listKey = '';
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = btns.findIndex(x => x.b === document.activeElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    btns[j].b.focus(); btns[j].b.click();
  });
  const el = h('div', { class: `color-picker ${o.cls ?? ''}`.trim() }, head, row);
  const set = (colors: ObjectColor[] | undefined, id: string | undefined, disabled = false) => {
    el.hidden = !colors?.length;
    if (!colors?.length) return;
    const key = colors.map(c => `${c.id}:${c.hex}:${c.hex2 ?? ''}`).join('|');
    if (key !== listKey) {
      listKey = key;
      btns = colors.map(c => {
        const label = t(c.labelKey as TKey);
        const two = c.hex2 && c.hex2.toLowerCase() !== c.hex.toLowerCase();
        const b = h('button', {
          type: 'button', role: 'radio', class: `swatch obj-swatch${isLight(c.hex) ? ' light' : ''}${two ? ' two' : ''}`,
          'aria-checked': 'false', 'aria-label': label,
          style: two ? `--sw:${c.hex};--sw2:${c.hex2}` : `--sw:${c.hex}`,
        });
        tip(b, label);
        b.addEventListener('click', () => { if (!b.disabled) o.onPick(c.id); });
        return { b, c };
      });
      row.replaceChildren(...btns.map(x => x.b));
    }
    const cur = colors.find(c => c.id === id) ?? colors[0];
    for (const { b, c } of btns) {
      const on = c === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = disabled;
    }
    name.textContent = t(cur.labelKey as TKey);
    el.classList.toggle('disabled', disabled);
  };
  return { el, set };
}

/** "Voir sur IKEA ↗" product link (null when the variant has none). */
export function productLink(url: string | undefined): HTMLElement | null {
  if (!url) return null;
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'product-link' },
    h('span', null, t('obj.seeOnIkea')), icon('arrowUpRight', 12));
}
