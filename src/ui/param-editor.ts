// Parameter editors of the parametric objects (TV, custom table, frame —
// core/objects-params.ts), shared by the library draft and the inspector.
// The editor never edits anything itself: every control hands a mutator to
// `change()`; the host applies it (draft, or store.update() = one undo step),
// re-derives the size (syncParam) and calls `set()` with the new state.
import type { BlockShape, ObjOpts, Size3 } from '../core/types';
import { t, type TKey } from '../core/i18n';
import { fmtCm } from '../core/kallax';
import {
  FRAME_CENTRE, FRAME_PRESETS, TABLE_LEG_DEFAULT, TV_WALL_CENTRE, TABLE_LEG_STYLES, TV_INCHES, TV_MAX_INCH, TV_MIN_INCH,
  frameOpening, framePortrait, framePreset, frameStyle, setFramePortrait, setFramePreset, setFrameStyle,
  tableLeg, tableStyle, tableTop, tvDims, tvInch, tvStand,
  type FramePresetId, type FrameStyle, type ParamShape, type TableLegStyle,
} from '../core/objects-params';
import { colorOf, variantOf } from '../core/objects';
import { h } from './dom';
import { numberField, segmented, switchRow, tip, type NumberField } from './controls';
import { colorPicker } from './variant-picker';
import { fmtInch } from './object-labels';

/** What the editors read and write (a BlockItem or a library draft). */
export interface ParamTarget { shape?: BlockShape; variant?: string; size: Size3; opts?: ObjOpts; color?: string }
export type ParamMutator = (st: ParamTarget) => void;

export interface ParamEditor {
  el: HTMLElement;
  set(st: ParamTarget, disabled?: boolean): void;
}

interface Chip { el: HTMLButtonElement; on: (st: ParamTarget) => boolean }

function chipRow(aria: string, defs: { label: string; tip?: string; on: (st: ParamTarget) => boolean; pick: ParamMutator }[], change: (m: ParamMutator) => void) {
  const chips: Chip[] = defs.map(d => {
    const el = h('button', { type: 'button', class: 'chip' }, d.label);
    if (d.tip) tip(el, d.tip);
    el.addEventListener('click', () => { if (!el.disabled) change(d.pick); });
    return { el, on: d.on };
  });
  const el = h('div', { class: 'chips param-chips', role: 'group', 'aria-label': aria }, chips.map(c => c.el));
  const set = (st: ParamTarget, disabled: boolean) => {
    for (const c of chips) {
      const on = c.on(st);
      c.el.classList.toggle('on', on);
      c.el.setAttribute('aria-pressed', String(on));
      c.el.disabled = disabled;
    }
  };
  return { el, set };
}

const row = (label: string, ctl: HTMLElement) => h('div', { class: 'obj-row' }, h('span', { class: 'obj-row-label' }, label), ctl);
const opt = (st: ParamTarget, patch: ObjOpts) => { st.opts = { ...st.opts, ...patch }; };

export function paramEditor(shape: ParamShape, o: { change: (m: ParamMutator) => void; cls?: string }): ParamEditor {
  const { change } = o;
  const fields: { setDisabled(d: boolean): void }[] = [];
  const parts: HTMLElement[] = [];
  const setters: ((st: ParamTarget, disabled: boolean) => void)[] = [];
  const colors = colorPicker({ cls: 'param-colors', onPick: id => change(st => { st.color = id; }) });

  if (shape === 'tv') {
    const chips = chipRow(t('obj.tv.sizesAria'), TV_INCHES.map(n => {
      const d = tvDims(n);
      return {
        label: fmtInch(n), tip: t('obj.tv.sizeTip', { w: fmtCm(d.pw), h: fmtCm(d.ph) }),
        on: st => Math.abs(tvInch(st) - n) < 0.05, pick: st => opt(st, { inch: n }),
      };
    }), change);
    const diag = numberField({
      label: t('obj.tv.diagonal'), ariaLabel: t('obj.tv.diagAria'), value: 55, step: 1, min: TV_MIN_INCH, max: TV_MAX_INCH, suffix: '″',
      onCommit: v => change(st => opt(st, { inch: v })),
    });
    const panel = h('p', { class: 'hint variant-note param-note' });
    const mount = segmented<'stand' | 'wall'>({
      ariaLabel: t('obj.tv.mountAria'), size: 'sm', value: 'stand', cls: 'param-seg',
      options: [{ value: 'stand', label: t('obj.tv.stand'), tip: t('obj.tv.standTip') }, { value: 'wall', label: t('obj.tv.wall'), tip: t('obj.tv.wallTip') }],
      onChange: v => change(st => { st.variant = v; }),
    });
    fields.push(diag, mount);
    // read-only companion of the diagonal: the panel's outer size
    const panelV = h('span', { class: 'param-ro-v' });
    const panelField = h('div', { class: 'field param-ro' }, h('span', { class: 'field-label' }, t('obj.tv.screen')),
      h('div', { class: 'num-box param-ro-box' }, panelV, h('span', { class: 'num-suffix', 'aria-hidden': 'true' }, 'cm')));
    parts.push(chips.el, h('div', { class: 'fields-2 param-diag' }, diag.el, panelField), row(t('obj.tv.mount'), mount.el), panel);
    setters.push((st, dis) => {
      chips.set(st, dis);
      diag.set(tvInch(st));
      const d = tvDims(tvInch(st));
      panelV.textContent = `${fmtCm(d.pw)} × ${fmtCm(d.ph)}`;
      panel.textContent = tvStand(st) ? t('obj.tv.standTip') : t('obj.tv.wallHint', { cm: TV_WALL_CENTRE });
      mount.set(tvStand(st) ? 'stand' : 'wall');
    });
  } else if (shape === 'table') {
    const styles = chipRow(t('obj.table.legsAria'), TABLE_LEG_STYLES.map(s => ({
      label: t(`obj.table.${s}` as TKey), tip: t(`obj.table.${s}Tip` as TKey),
      on: st => tableStyle(st) === s,
      pick: st => { if (tableStyle(st) !== s) { st.variant = s; opt(st, { leg: TABLE_LEG_DEFAULT[s as TableLegStyle] }); } },
    })), change);
    const dim = (k: 'w' | 'd' | 'h', label: string, aria: string, axis: 'x' | 'y' | 'z', min: number): NumberField => numberField({
      label, ariaLabel: aria, axis, value: 0, step: 1, min, max: 1000, suffix: 'cm',
      onCommit: v => change(st => { st.size = { ...st.size, [k]: v }; if (k === 'w' && st.opts?.round) st.size.d = v; }),
    });
    const fw = dim('w', t('dim.w'), t('aria.width'), 'x', 20), fd = dim('d', t('dim.d'), t('aria.depth'), 'y', 20), fh = dim('h', t('dim.h'), t('aria.height'), 'z', 10);
    const top = numberField({ label: t('obj.table.top'), ariaLabel: t('obj.table.topAria'), value: 3, step: 0.5, min: 0.5, max: 20, suffix: 'cm', onCommit: v => change(st => opt(st, { top: v })) });
    const leg = numberField({ label: t('obj.table.leg'), ariaLabel: t('obj.table.legAria'), value: 5, step: 0.5, min: 0.5, max: 30, suffix: 'cm', onCommit: v => change(st => opt(st, { leg: v })) });
    const round = switchRow({
      label: t('obj.table.roundTop'), hint: t('obj.table.roundTopHint'), icon: 'tableRound', value: false,
      onChange: v => change(st => { opt(st, { round: v || undefined }); if (!v) delete st.opts!.round; else st.size = { ...st.size, d: st.size.w }; }),
    });
    fields.push(fw, fd, fh, top, leg);
    parts.push(h('div', { class: 'fields-3' }, fw.el, fd.el, fh.el), h('div', { class: 'fields-2' }, top.el, leg.el),
      h('div', { class: 'param-sub' }, h('span', { class: 'obj-row-label' }, t('obj.table.legs'))), styles.el, round.el);
    setters.push((st, dis) => {
      styles.set(st, dis);
      fw.set(st.size.w); fd.set(st.size.d); fh.set(st.size.h);
      fd.setDisabled(dis || !!st.opts?.round);
      top.set(tableTop(st)); leg.set(tableLeg(st));
      round.set(!!st.opts?.round);
      round.input.disabled = dis;
    });
  } else {
    const style = segmented<FrameStyle>({
      ariaLabel: t('obj.frame.styleAria'), size: 'sm', value: 'simple', cls: 'param-seg',
      options: [{ value: 'simple', label: t('obj.frame.simple'), tip: t('obj.frame.simpleTip') }, { value: 'classic', label: t('obj.frame.classic'), tip: t('obj.frame.classicTip') }],
      onChange: v => change(st => { if (frameStyle(st) !== v) setFrameStyle(st, v); }),
    });
    const presets = segmented<FramePresetId>({
      ariaLabel: t('obj.frame.sizesAria'), size: 'sm', value: 'M', cls: 'param-seg param-presets',
      options: FRAME_PRESETS.map(f => ({ value: f.id, label: `${f.id} ${f.w}×${f.h}`, tip: t('obj.frame.presetTip', { name: f.id, w: f.w, h: f.h }) })),
      onChange: id => change(st => setFramePreset(st, id)),
    });
    const orient = segmented<'p' | 'l'>({
      ariaLabel: t('obj.frame.orientAria'), size: 'sm', value: 'p', cls: 'param-seg',
      options: [{ value: 'p', label: t('obj.frame.portrait') }, { value: 'l', label: t('obj.frame.landscape') }],
      onChange: v => change(st => setFramePortrait(st, v === 'p')),
    });
    const fw = numberField({ label: t('dim.w'), ariaLabel: t('aria.width'), axis: 'x', value: 0, step: 1, min: 8, max: 400, suffix: 'cm', onCommit: v => change(st => { st.size = { ...st.size, w: v }; }) });
    const fh = numberField({ label: t('dim.h'), ariaLabel: t('aria.height'), axis: 'z', value: 0, step: 1, min: 8, max: 400, suffix: 'cm', onCommit: v => change(st => { st.size = { ...st.size, h: v }; }) });
    const opening = h('p', { class: 'hint variant-note param-note' });
    fields.push(style, presets, orient, fw, fh);
    parts.push(row(t('obj.frame.style'), style.el), presets.el, row(t('obj.frame.orient'), orient.el), h('div', { class: 'fields-2' }, fw.el, fh.el), opening);
    setters.push((st, dis) => {
      style.set(frameStyle(st));
      presets.set(framePreset(st));
      orient.set(st.size.w === st.size.h ? null : framePortrait(st) ? 'p' : 'l');
      fw.set(st.size.w); fh.set(st.size.h);
      const op = frameOpening(st);
      const txt = t('obj.frame.opening', { w: fmtCm(op.w), h: fmtCm(op.h) });
      opening.textContent = `${txt.charAt(0).toLocaleUpperCase()}${txt.slice(1)} · ${t('obj.wallHung', { cm: FRAME_CENTRE })}`;
    });
  }
  parts.push(colors.el);

  const el = h('div', { class: `param-editor ${o.cls ?? ''}`.trim() }, ...parts);
  return {
    el,
    set(st, disabled = false) {
      for (const f of fields) f.setDisabled(disabled);
      for (const s of setters) s(st, disabled);
      const v = variantOf(shape, st.variant);
      // a single colour (TV: black) needs no picker
      colors.set((v?.colors?.length ?? 0) > 1 ? v!.colors : undefined, colorOf(shape, st.variant, st.color)?.id, disabled);
    },
  };
}
