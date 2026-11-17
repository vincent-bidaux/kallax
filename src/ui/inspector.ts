// Right inspector: composition summary / single item / multi-selection.
import { store } from '../core/store';
import type { BlockShape, Item, KallaxItem, Rotation } from '../core/types';
import { fmtCm, isOfficial, itemBox, kallaxNominal, unionBox, worldSize, boxesOverlap, MAX_CELLS, legsAvailable, KALLAX, cylinderDims, cylinderSize } from '../core/kallax';
import { BASKET_VARIANTS, DEFAULT_FINISH, buildBom, fmtEur, frameFinishes, frameSold, type BasketVariant, type FinishId } from '../core/finishes';
import { itemEuler, type Axis3 } from '../core/orient';
import { h, clear, toast } from './dom';
import { icon } from './icons';
import { button, numberField, segmented, stepper, switchRow, textField, tip, type NumberField } from './controls';
import { finishPicker } from './finish-picker';
import { bomList, bomText, buildTotalFooter, currentBom } from './bom';
import * as cmd from '../interaction/commands';
import { MOD } from './dom';
import { t, tn, type TKey } from '../core/i18n';
import { OBJECT_BY_SHAPE, variantOf } from '../core/objects';
import { autoName, isAutoName, objLabel, variantLabel } from './object-labels';

interface Panel { el: HTMLElement; update(): void }

/** Underframe suffix of auto-named units, in either language (" + piètement" / " + underframe"). */
const LEGS_SUFFIX_RE = / \+ (piètement|underframe)$/;

const dims3 = (w: number, d: number, hh: number) => `${fmtCm(w)} × ${fmtCm(d)} × ${fmtCm(hh)}`;

function dimsBlock(w: number, d: number, hh: number): HTMLElement {
  const cell = (k: string, v: number, axis: string) =>
    h('div', { class: 'dim-cell' }, h('span', { class: `dim-k axis-${axis}` }, k), h('span', { class: 'dim-v' }, fmtCm(v)));
  const sep = (t: string, cls: string) =>
    h('div', { class: `dim-cell ${cls}`, 'aria-hidden': 'true' }, h('span', { class: 'dim-k' }, '\u00a0'), h('span', { class: 'dim-v' }, t));
  return h('div', { class: 'dims-card', role: 'group', 'aria-label': t('dim.aria', { dims: dims3(w, d, hh) }) },
    cell(t('dim.w'), w, 'x'), sep('×', 'dim-x'), cell(t('dim.d'), d, 'y'), sep('×', 'dim-x'), cell(t('dim.h'), hh, 'z'),
    sep('cm', 'dim-unit'));
}

/** "Non proposée en 2×2, 1×4" when a finish is not sold for some of these (IKEA-sold) frames. */
function notSoldIn(ks: KallaxItem[], f: FinishId): string | null {
  const miss = new Set<string>();
  for (const k of ks) if (frameSold(k.cols, k.rows) && !frameFinishes(k.cols, k.rows).includes(f)) miss.add(`${k.cols}×${k.rows}`);
  return miss.size ? t('insp.notSoldIn', { list: [...miss].join(', ') }) : null;
}

/** Price card for one or several KALLAX: total + breakdown + BOM warnings. */
function priceCard(ks: KallaxItem[], label: string): HTMLElement {
  const b = buildBom(ks, store.doc.finish, store.doc.basket);
  const sum = (kind: string) => b.lines.filter(l => l.kind === kind);
  const parts: string[] = [];
  const fr = sum('frame'), lg = sum('legs'), ins = sum('insert');
  const tot = (ls: typeof b.lines) => ls.reduce((s, l) => s + (l.total ?? 0), 0);
  const cnt = (ls: typeof b.lines) => ls.reduce((s, l) => s + l.qty, 0);
  const nb = (t: string) => t.replace(/ /g, '\u00a0');
  if (fr.length) parts.push(fr.every(l => l.total == null) ? t('insp.customFrame') : tn('insp.frames', cnt(fr), { price: fmtEur(tot(fr)) }));
  if (lg.length) parts.push(tn('insp.legs', cnt(lg), { price: lg.every(l => l.total == null) ? '—' : fmtEur(tot(lg)) }));
  if (ins.length) parts.push(tn('insp.inserts', cnt(ins), { price: fmtEur(tot(ins)) }));
  // insert notes don't name the fitting: prefix it ("Bloc 2 tiroirs : pas en noyer — brun noir")
  const notes = [...new Set(b.lines.filter(l => l.note).map(l => l.kind === 'insert'
    ? t('insp.insertNote', { label: l.label.replace(/^KALLAX /, '').replace(/^./, c => c.toUpperCase()), note: l.note!.replace(/^./, c => c.toLowerCase()) })
    : l.note!))];
  const priced = b.lines.some(l => l.total != null);
  return h('div', { class: 'price-card', role: 'group', 'aria-label': t('insp.priceAria', { label, price: priced ? fmtEur(b.total) : t('insp.unpriced') }) },
    h('div', { class: 'price-main' },
      h('span', { class: 'price-k' }, label),
      h('span', { class: `price-v${priced ? '' : ' none'}` }, priced ? fmtEur(b.total) : '—')),
    parts.length ? h('div', { class: 'price-break' }, parts.map(nb).join(' · ')) : null,
    ...notes.map(n => h('div', { class: 'price-note' }, icon('warning', 11), h('span', null, n))),
  );
}

function group(title: string | null, ...children: (Node | null)[]) {
  return h('div', { class: 'insp-group' }, title ? h('h4', { class: 'insp-title' }, title) : null, ...children);
}

// ── composition summary ──────────────────────────────────────
function summaryPanel(): Panel {
  const el = h('div', { class: 'insp-panel' });
  const update = () => {
    clear(el);
    const items = store.visibleItems();
    const all = store.items;
    const kallax = all.filter((i): i is KallaxItem => i.kind === 'kallax');
    const cells = kallax.reduce((n, k) => n + k.cols * k.rows, 0);
    const u = unionBox(items);
    el.append(
      h('div', { class: 'insp-hero' },
        h('div', { class: 'hero-icon' }, icon('cube', 22)),
        h('div', null, h('div', { class: 'hero-title' }, t('insp.composition')), h('div', { class: 'hero-sub' }, store.doc.name))),
      h('div', { class: 'stats' },
        stat(t('common.objects'), String(all.length)),
        stat(t('insp.cells'), String(cells)),
        stat(t('common.layers'), String(store.doc.layers.length))),
    );
    if (u) el.append(group(t('insp.overall'), dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z)));
    // finish (global) + basket variant
    const gf = store.doc.finish ?? DEFAULT_FINISH;
    const fp = finishPicker({
      title: t('common.finish'), ariaLabel: t('insp.globalFinishAria'),
      onPick: f => { if (f && f !== (store.doc.finish ?? DEFAULT_FINISH)) store.update(d => { d.finish = f; }); },
    });
    const visK = items.filter((i): i is KallaxItem => i.kind === 'kallax');
    fp.set({ value: gf, global: gf, unavailable: f => notSoldIn(visK, f) });
    const overrides = kallax.filter(k => k.finish && k.finish !== gf).length;
    if (overrides) fp.el.append(h('p', { class: 'hint finish-hint' },
      tn('insp.overrides', overrides)));
    const basket = segmented<BasketVariant>({
      ariaLabel: t('insp.basketsAria'), size: 'sm', value: store.doc.basket ?? 'naturel', cls: 'basket-seg',
      options: BASKET_VARIANTS.map(v => ({ value: v.id, label: v.id === 'naturel' ? t('basket.naturelShort') : t('basket.blancShort'), tip: `${v.label} · ${fmtEur(v.price)}` })),
      onChange: v => { if (v !== (store.doc.basket ?? 'naturel')) store.update(d => { d.basket = v; }); },
    });
    fp.el.append(h('div', { class: 'basket-row' }, h('span', { class: 'basket-label' }, t('insp.baskets')), basket.el));
    el.append(fp.el);

    // priced shopping list
    const bom = currentBom();
    const copy = bom.lines.length ? button({
      icon: 'duplicate', label: t('insp.copy'), cls: 'mini-btn text', iconSize: 13,
      tip: t('insp.copyTip'),
      onClick: () => {
        navigator.clipboard?.writeText(bomText(bom, store.doc.name)).then(() => toast(t('insp.copied')), () => toast(t('insp.copyFailed')));
      },
    }) : null;
    el.append(h('div', { class: 'insp-group bom-group' },
      h('div', { class: 'insp-title-row' }, h('h4', { class: 'insp-title' }, t('insp.shoppingList')), copy), bomList(bom)));
    el.append(h('p', { class: 'hint insp-hint' }, t('insp.selectHint')));
  };
  update();
  return { el, update };
}

function stat(k: string, v: string) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, v), h('div', { class: 'stat-k' }, k));
}

// ── single item ──────────────────────────────────────────────
function itemPanel(id: string): Panel {
  const el = h('div', { class: 'insp-panel' });
  const it0 = store.getItem(id)!;
  const isK = it0.kind === 'kallax';
  const step = () => store.settings.gridCell;

  const nameField = textField({ value: it0.name, ariaLabel: t('insp.nameAria'), cls: 'hero-name', onCommit: v => store.patchItem(id, { name: v }) });
  const typeLabel = h('div', { class: 'hero-sub' });
  const heroIcon = h('div', { class: 'hero-icon' }, icon(isK ? 'grid' : shapeIcon(it0.shape), 22));
  const lockBanner = h('div', { class: 'banner', role: 'note' }, icon('lock', 13), t('insp.lockedBanner'));
  const overlapBanner = h('div', { class: 'banner warn', role: 'alert' }, icon('warning', 13), t('insp.overlap'));
  const dimsHost = h('div');

  const fx = numberField({ label: 'X', axis: 'x', ariaLabel: t('aria.posX'), value: it0.position.x, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { x: v }) });
  const fy = numberField({ label: 'Y', axis: 'y', ariaLabel: t('aria.posY'), value: it0.position.y, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { y: v }) });
  const fz = numberField({ label: 'Z', axis: 'z', ariaLabel: t('aria.posZ'), value: it0.position.z, step: step(), min: 0, suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { z: v }) });
  tip(fx.el, t('insp.tipX'));
  tip(fy.el, t('insp.tipY'));
  tip(fz.el, t('insp.tipZ'));

  const rotRows = (['x', 'y', 'z'] as Axis3[]).map(ax => {
    const val = h('output', { class: 'rot-val' });
    const kb = ax === 'z' ? 'R' : ax === 'x' ? 'X' : 'Y';
    const m = button({ icon: 'rotateCw', label: t('insp.rotMinus', { axis: ax.toUpperCase() }), iconOnly: true, kbd: `⇧${kb}`, cls: 'seg-like', onClick: () => rotateOne(-90, ax) });
    const p = button({ icon: 'rotateCcw', label: t('insp.rotPlus', { axis: ax.toUpperCase() }), iconOnly: true, kbd: kb, cls: 'seg-like', onClick: () => rotateOne(90, ax) });
    const row = h('div', { class: 'rot-row rot-axis' }, h('span', { class: `rot-ax ax-${ax}` }, ax.toUpperCase()), m, val, p);
    return { ax, val, m, p, row };
  });
  function rotateOne(d: 90 | -90, ax: Axis3) {
    if (!store.selection.includes(id)) store.select([id]);
    cmd.rotateSelection(d, ax);
  }

  let legsSw: ReturnType<typeof switchRow> | null = null;
  let colsSt: ReturnType<typeof stepper> | null = null;
  let rowsSt: ReturnType<typeof stepper> | null = null;
  let fw: NumberField | null = null, fd: NumberField | null = null, fh: NumberField | null = null;
  let sizeGroup: HTMLElement;
  let handleSeg: ReturnType<typeof segmented<'r' | 'l'>> | null = null;
  let variantChips: { sync(v: string | undefined): void; setDisabled(d: boolean): void } | null = null;
  if (it0.kind === 'kallax') {
    colsSt = stepper({ label: t('insp.columns'), value: it0.cols, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, v, x.rows); x.cols = v; } }) });
    rowsSt = stepper({ label: t('insp.rows'), value: it0.rows, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, x.cols, v); x.rows = v; } }) });
    legsSw = switchRow({
      label: t('insp.legs'), hint: `+${fmtCm(KALLAX.legs)} cm · 2×2, 2×4, 4×3, 4×4`, icon: 'arrowUp', value: !!it0.legs,
      onChange: v => store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (!x || x.kind !== 'kallax' || !!x.legs === v) return;
        // lift (or lower) everything stacked on top of this unit, transitively
        const dz = v ? KALLAX.legs : -KALLAX.legs;
        const top = itemBox(x).max.z;
        const moved = [itemBox(x)];
        const xyOverlap = (a: ReturnType<typeof itemBox>, b: ReturnType<typeof itemBox>) =>
          a.min.x < b.max.x - 0.01 && a.max.x > b.min.x + 0.01 && a.min.y < b.max.y - 0.01 && a.max.y > b.min.y + 0.01;
        const above = d.items.filter(o => o.id !== x.id && itemBox(o).min.z >= top - 0.01).sort((a, b) => a.position.z - b.position.z);
        for (const o of above) {
          const ob = itemBox(o);
          if (moved.some(m => xyOverlap(m, ob))) { moved.push(ob); o.position = { ...o.position, z: o.position.z + dz }; }
        }
        x.legs = v;
        x.name = x.name.replace(LEGS_SUFFIX_RE, '') + (v && /^Kallax \d×\d/.test(x.name) ? t('kallax.legsSuffix') : '');
      }),
    });
    sizeGroup = group(t('insp.cells'), h('div', { class: 'steppers' }, colsSt.el, rowsSt.el), legsSw.el);
  } else if (it0.shape === 'cylinder' || it0.shape === 'square') {
    const patchCyl = (k: 'diameter' | 'length', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id);
      if (!x || x.kind !== 'block') return;
      const c = cylinderDims(x);
      x.size = cylinderSize(k === 'diameter' ? v : c.diameter, k === 'length' ? v : c.length, c.axis);
    });
    const c0 = cylinderDims(it0);
    const sq = it0.shape === 'square';
    fw = numberField({ label: sq ? '□' : 'Ø', ariaLabel: sq ? t('aria.side') : t('aria.diameter'), value: c0.diameter, step: 0.5, min: 0.5, suffix: 'cm', onCommit: v => patchCyl('diameter', v) });
    fh = numberField({ label: t('dim.len'), ariaLabel: t('aria.length'), value: c0.length, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchCyl('length', v) });
    sizeGroup = group(sq ? t('obj.squareBeam') : t('obj.roundBeam'), h('div', { class: 'fields-2' }, fw.el, fh.el));
  } else if (it0.shape === 'wall') {
    const patchSize = (k: 'w' | 'h', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.size = { ...x.size, [k]: v };
    });
    fw = numberField({ label: t('dim.w'), axis: 'x', ariaLabel: t('aria.width'), value: it0.size.w, step: 1, min: 1, suffix: 'cm', onCommit: v => patchSize('w', v) });
    fh = numberField({ label: t('dim.h'), axis: 'z', ariaLabel: t('aria.height'), value: it0.size.h, step: 1, min: 1, suffix: 'cm', onCommit: v => patchSize('h', v) });
    sizeGroup = group(t('insp.wallPlane'), h('div', { class: 'fields-2' }, fw.el, fh.el));
  } else if (it0.shape && OBJECT_BY_SHAPE[it0.shape]?.variants) {
    // preset objects (bed, lamp, plant): pick a size, no free dimensions
    const shape = it0.shape;
    const setVariant = (vid: string) => store.update(d => {
      const x = d.items.find(i => i.id === id);
      if (!x || x.kind !== 'block' || !x.shape) return;
      const v = variantOf(x.shape, vid);
      if (!v || (variantOf(x.shape, x.variant)?.id === v.id && x.size.w === v.size.w && x.size.d === v.size.d && x.size.h === v.size.h)) return;
      const wasAuto = isAutoName(x);
      // position is the min corner: it stays put, the object grows / shrinks from there
      x.variant = v.id;
      x.size = { ...v.size };
      if (wasAuto) x.name = autoName(x.shape, v.id);
    });
    const chipBtns = OBJECT_BY_SHAPE[shape].variants!.map(v => {
      const el = h('button', { type: 'button', class: 'chip' }, t(v.labelKey as TKey));
      tip(el, `${fmtCm(v.size.w)} × ${fmtCm(v.size.d)} × ${fmtCm(v.size.h)} cm`);
      el.addEventListener('click', () => setVariant(v.id));
      return { el, id: v.id };
    });
    variantChips = {
      sync(vid) { for (const c of chipBtns) { const on = c.id === vid; c.el.classList.toggle('on', on); c.el.setAttribute('aria-pressed', String(on)); } },
      setDisabled(d) { for (const c of chipBtns) c.el.disabled = d; },
    };
    sizeGroup = group(t('insp.variant'), h('div', { class: 'chips insp-chips', role: 'group', 'aria-label': t('obj.variantsAria') }, chipBtns.map(c => c.el)));
  } else {
    const patchSize = (k: 'w' | 'd' | 'h', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.size = { ...x.size, [k]: v };
    });
    fw = numberField({ label: t('dim.w'), axis: 'x', ariaLabel: t('aria.width'), value: it0.size.w, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('w', v) });
    fd = numberField({ label: t('dim.d'), axis: 'y', ariaLabel: t('aria.depth'), value: it0.size.d, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('d', v) });
    fh = numberField({ label: t('dim.h'), axis: 'z', ariaLabel: t('aria.height'), value: it0.size.h, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('h', v) });
    if (it0.shape === 'door') {
      handleSeg = segmented<'r' | 'l'>({
        ariaLabel: t('obj.handleAria'), size: 'sm', value: it0.mirror ? 'l' : 'r', cls: 'handle-seg',
        options: [{ value: 'r', label: t('obj.handleRight') }, { value: 'l', label: t('obj.handleLeft') }],
        onChange: v => store.update(d => {
          const x = d.items.find(i => i.id === id);
          if (!x || x.kind !== 'block' || !!x.mirror === (v === 'l')) return;
          if (v === 'l') x.mirror = true; else delete x.mirror;
        }),
      });
    }
    sizeGroup = group(objLabel(it0.shape), h('div', { class: 'fields-3' }, fw.el, fd.el, fh.el),
      handleSeg ? h('div', { class: 'obj-row insp-row' }, h('span', { class: 'obj-row-label' }, t('obj.handle')), handleSeg.el) : null);
  }

  const priceHost = h('div', { class: 'price-host' });
  const finishP = isK ? finishPicker({
    withGlobal: true, ariaLabel: t('insp.thisFinishAria'),
    onPick: f => {
      const cur = store.getItem(id);
      if (!cur || cur.kind !== 'kallax' || store.isLocked(cur) || (cur.finish ?? null) === f) return;
      store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (x && x.kind === 'kallax') { if (f) x.finish = f; else delete x.finish; }
      });
    },
  }) : null;

  const layerSel = h('select', { class: 'popup', 'aria-label': t('common.layer') });
  layerSel.addEventListener('change', () => store.patchItem(id, { layerId: layerSel.value }));
  const layerWrap = h('div', { class: 'popup-wrap' }, layerSel, icon('chevronDown', 12, 'popup-chev'));

  const dupBtns = dupRow();
  const delBtn = button({ icon: 'trash', label: t('common.delete'), kbd: '⌫', cls: 'btn-destructive wide', onClick: () => { if (!store.selection.includes(id)) store.select([id]); cmd.deleteSelection(); } });

  el.append(
    h('div', { class: 'insp-hero' }, heroIcon, h('div', { class: 'hero-text' }, nameField.el, typeLabel)),
    lockBanner, overlapBanner,
    dimsHost,
    priceHost,
    group(t('common.position'), h('div', { class: 'fields-3' }, fx.el, fy.el, fz.el)),
    group(t('insp.rotation'), h('div', { class: 'rot-rows' }, rotRows.map(r => r.row))),
    sizeGroup,
    ...(finishP ? [finishP.el] : []),
    group(t('common.layer'), layerWrap),
    group(t('common.duplicate'), dupBtns),
    h('div', { class: 'insp-group' }, delBtn),
  );

  const editables: { setDisabled(d: boolean): void }[] = [fx, fy, fz, nameField];
  if (colsSt) editables.push(colsSt, rowsSt!);
  for (const f of [fw, fd, fh]) if (f) editables.push(f);
  if (handleSeg) editables.push(handleSeg);
  if (variantChips) editables.push(variantChips);

  const update = () => {
    const it = store.getItem(id);
    if (!it) return;
    const s = worldSize(it);
    const locked = store.isLocked(it);
    nameField.set(it.name);
    if (it.kind === 'kallax') {
      const off = isOfficial(it.cols, it.rows);
      typeLabel.replaceChildren(`Kallax ${it.cols}×${it.rows} · ${kallaxNominal(it.cols)}×${kallaxNominal(it.rows)} cm `,
        h('span', { class: `pill ${off ? 'pill-ikea' : 'pill-custom'}` }, off ? t('common.ikea') : t('common.custom')));
      colsSt!.set(it.cols); rowsSt!.set(it.rows);
      const can = legsAvailable(it.cols, it.rows) || !!it.legs;
      legsSw!.set(!!it.legs);
      legsSw!.input.disabled = !can || locked;
      legsSw!.el.classList.toggle('disabled', !can);
      legsSw!.el.title = can ? '' : t('insp.legsTitle');
      finishP!.set({
        value: it.finish ?? null, inherit: !it.finish, global: store.doc.finish ?? DEFAULT_FINISH,
        unavailable: f => notSoldIn([it], f), disabled: locked,
      });
      priceHost.replaceChildren(priceCard([it], t('insp.price')));
    } else if (it.shape === 'cylinder' || it.shape === 'square') {
      const c = cylinderDims(it);
      typeLabel.textContent = it.shape === 'square'
        ? t('insp.typeSquare', { d: fmtCm(c.diameter), l: fmtCm(c.length) })
        : t('insp.typeRound', { d: fmtCm(c.diameter), l: fmtCm(c.length) });
      fw!.set(c.diameter); fh!.set(c.length);
    } else if (it.shape === 'window') {
      typeLabel.textContent = t('insp.typeWindow');
      fw!.set(it.size.w); fd!.set(it.size.d); fh!.set(it.size.h);
    } else if (it.shape === 'wall') {
      typeLabel.textContent = t('insp.typeWall');
      fw!.set(it.size.w); fh!.set(it.size.h);
    } else if (variantChips) {
      const v = variantOf(it.shape!, it.variant);
      typeLabel.textContent = `${objLabel(it.shape)} · ${variantLabel(it.shape, it.variant)}`;
      variantChips.sync(v?.id);
    } else {
      typeLabel.textContent = it.shape === 'door'
        ? `${objLabel(it.shape)} · ${it.mirror ? t('obj.handleLeftLong') : t('obj.handleRightLong')}`
        : objLabel(it.shape);
      fw!.set(it.size.w); fd!.set(it.size.d); fh!.set(it.size.h);
      handleSeg?.set(it.mirror ? 'l' : 'r');
    }
    dimsHost.replaceChildren(dimsBlock(s.w, s.d, s.h));
    fx.set(it.position.x); fy.set(it.position.y); fz.set(it.position.z);
    for (const f of [fx, fy, fz]) f.setStep(step());
    const eul = itemEuler(it);
    for (const r of rotRows) {
      r.val.textContent = `${eul[r.ax]}°`;
      r.val.setAttribute('aria-label', t('insp.rotAria', { axis: r.ax.toUpperCase(), deg: eul[r.ax] }));
    }
    // layer picker
    const opts = store.doc.layers.map(l => `${l.id}|${l.name}`).join(';');
    if (layerSel.dataset.opts !== opts) {
      layerSel.replaceChildren(...store.doc.layers.map(l => h('option', { value: l.id }, l.name)));
      layerSel.dataset.opts = opts;
    }
    layerSel.value = it.layerId;
    // locked state
    lockBanner.hidden = !locked;
    for (const e of editables) e.setDisabled(locked);
    for (const r of rotRows) r.m.disabled = r.p.disabled = locked;
    delBtn.disabled = locked;
    layerSel.disabled = false;
    // overlap
    const b = itemBox(it);
    overlapBanner.hidden = !store.visibleItems().some(o => o.id !== it.id && boxesOverlap(b, itemBox(o)));
  };
  update();
  return { el, update };
}

function renameKallax(x: Item, c0: number, r0: number, c1: number, r1: number): string {
  return x.name === `Kallax ${c0}×${r0}` ? `Kallax ${c1}×${r1}` : x.name;
}

function dupRow(): HTMLElement {
  const b = (axis: 'x' | 'y' | 'z', ic: string, label: string, sub: string, kbd?: string) => {
    const el = h('button', { type: 'button', class: 'dup-btn' }, icon(ic, 18), h('span', { class: 'dup-label' }, label), h('span', { class: 'dup-sub' }, sub));
    tip(el, t(axis === 'x' ? 'insp.dupTipX' : axis === 'y' ? 'insp.dupTipY' : 'insp.dupTipZ'), kbd);
    el.addEventListener('click', () => cmd.duplicate(axis));
    return el;
  };
  return h('div', { class: 'dup-row' },
    b('x', 'arrowRight', t('insp.dupRight'), '+X', `${MOD}D`),
    b('y', 'arrowBack', t('insp.dupBehind'), '+Y'),
    b('z', 'arrowUp', t('insp.dupTop'), '+Z'));
}

// ── multi selection ──────────────────────────────────────────
function multiPanel(): Panel {
  const el = h('div', { class: 'insp-panel' });
  const title = h('div', { class: 'hero-title' });
  const sub = h('div', { class: 'hero-sub' });
  const dimsHost = h('div');
  const alignRow = h('div', { class: 'dup-row' },
    alignBtn('x', 'alignLeft', t('insp.alignLeft'), 'min X'),
    alignBtn('y', 'alignFront', t('insp.alignFront'), 'min Y'),
    alignBtn('z', 'alignBottom', t('insp.alignBottom'), 'min Z'));
  const delBtn = button({ icon: 'trash', label: t('insp.deleteSel'), kbd: '⌫', cls: 'btn-destructive wide', onClick: () => cmd.deleteSelection() });
  const selKallax = () => store.selectedItems().filter((i): i is KallaxItem => i.kind === 'kallax' && !store.isLocked(i));
  const finishP = finishPicker({
    withGlobal: true, ariaLabel: t('insp.selFinishAria'),
    onPick: f => {
      const ids = new Set(selKallax().filter(k => (k.finish ?? null) !== f).map(k => k.id));
      if (!ids.size) return;
      store.update(d => {
        for (const x of d.items) if (ids.has(x.id) && x.kind === 'kallax') { if (f) x.finish = f; else delete x.finish; }
      });
    },
  });
  const priceHost = h('div', { class: 'price-host' });
  el.append(
    h('div', { class: 'insp-hero' }, h('div', { class: 'hero-icon' }, icon('duplicate', 22)), h('div', null, title, sub)),
    group(t('insp.groupSize'), dimsHost),
    priceHost,
    finishP.el,
    group(t('insp.align'), alignRow),
    group(t('insp.dupGroup'), dupRow()),
    h('div', { class: 'insp-group' }, delBtn),
  );
  const update = () => {
    const sel = store.selectedItems();
    title.textContent = t('insp.selCount', { n: sel.length });
    const k = sel.filter(i => i.kind === 'kallax').length;
    sub.textContent = tn('insp.selSub', sel.length - k, { k });
    const u = unionBox(sel);
    if (u) dimsHost.replaceChildren(dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z));
    // finish of the selected KALLAX (one undo step for all)
    const ks = sel.filter((i): i is KallaxItem => i.kind === 'kallax');
    finishP.el.hidden = !ks.length;
    priceHost.replaceChildren(...(ks.length ? [priceCard(ks, ks.length > 1 ? t('insp.nKallax', { n: ks.length }) : 'Kallax')] : []));
    if (ks.length) {
      const fs = ks.map(k => k.finish ?? null);
      const same = fs.every(f => f === fs[0]);
      finishP.set({
        value: same ? fs[0] : null, inherit: same && fs[0] === null, mixed: !same,
        global: store.doc.finish ?? DEFAULT_FINISH,
        unavailable: f => notSoldIn(ks, f),
        disabled: ks.every(k => store.isLocked(k)),
      });
    }
  };
  update();
  return { el, update };
}

function alignBtn(axis: 'x' | 'y' | 'z', ic: string, label: string, sub: string) {
  const el = h('button', { type: 'button', class: 'dup-btn' }, icon(ic, 18), h('span', { class: 'dup-label' }, label), h('span', { class: 'dup-sub' }, sub));
  tip(el, t(axis === 'x' ? 'insp.alignTipX' : axis === 'y' ? 'insp.alignTipY' : 'insp.alignTipZ'));
  el.addEventListener('click', () => cmd.align(axis));
  return el;
}

// ── host ─────────────────────────────────────────────────────
export function buildInspector(host: HTMLElement) {
  const head = h('div', { class: 'insp-head' }, h('span', { class: 'insp-head-title' }, t('inspector.title')));
  const scroll = h('div', { class: 'insp-scroll' });
  const footer = buildTotalFooter(() => {
    // Show the composition details and bring the priced list into view.
    if (store.selection.length) store.select([]);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const g = scroll.querySelector<HTMLElement>('.bom-group');
      if (!g) return;
      g.scrollIntoView({ behavior: 'smooth', block: 'start' });
      g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash');
    }));
  });
  host.append(head, scroll, footer);
  let key = '';
  let panel: Panel | null = null;

  const render = () => {
    const sel = store.selectedItems();
    const k = sel.length === 0 ? 'none' : sel.length === 1 ? `one:${sel[0].id}:${sel[0].kind}` : 'multi';
    if (k !== key || !panel) {
      key = k;
      panel = k === 'none' ? summaryPanel() : k === 'multi' ? multiPanel() : itemPanel(sel[0].id);
      scroll.replaceChildren(panel.el);
      panel.el.classList.add('enter');
      requestAnimationFrame(() => panel?.el.classList.remove('enter'));
    } else panel.update();
  };
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  store.on(ev => { if (ev === 'doc' || ev === 'selection' || ev === 'settings') schedule(); });
  render();
}

export type { Rotation };

/** Glyph of a block shape (catalogue icon; legacy shape-less blocks are bricks). */
export function shapeIcon(shape: BlockShape | undefined): string {
  return OBJECT_BY_SHAPE[shape ?? 'box']?.icon ?? 'box';
}
