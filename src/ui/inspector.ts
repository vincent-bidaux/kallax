// Right inspector: composition summary / single item / multi-selection.
import { store } from '../core/store';
import type { BlockItem, BlockShape, EketItem, Item, KallaxItem, Rotation } from '../core/types';
import { fmtCm, isOfficial, itemBox, kallaxNominal, unionBox, worldSize, boxesOverlap, MAX_CELLS, legsAvailable, KALLAX, cylinderDims, cylinderSize, collides, nextOfficial } from '../core/kallax';
import { DEFAULT_EKET_COLOR, EKET, EKET_COLORS, EKET_LEGS, EKET_LEG_BY_ID, eketLegsAllowed, type EketLegId, EKET_VARIANTS, eketColorSold, eketDef, eketDims, eketDisplayName, eketMinPrice, eketPrice, effectiveEketColor, type EketColorId, type EketVariant } from '../core/eket';
import { BASKET_VARIANTS, DEFAULT_FINISH, KALLAX_LEGS_COLORS, type KallaxLegsColor, buildBom, fmtEur, frameFinishes, frameSold, type BasketVariant, type FinishId } from '../core/finishes';
import { itemEuler, type Axis3 } from '../core/orient';
import { h, clear, toast } from './dom';
import { icon } from './icons';
import { button, numberField, segmented, stepper, switchRow, textField, tip, type NumberField } from './controls';
import { finishPicker } from './finish-picker';
import { bomList, bomText, buildTotalFooter, currentBom } from './bom';
import * as cmd from '../interaction/commands';
import { MOD } from './dom';
import { t, tn, type TKey } from '../core/i18n';
import { OBJECT_BY_SHAPE, colorOf, variantOf } from '../core/objects';
import { autoName, groupLabel, isAutoName, objLabel, variantLabel } from './object-labels';
import { colorPicker, productLink, variantNote, variantPicker, type ColorPicker, type VariantPicker } from './variant-picker';
import { collisionBoxes } from '../interaction/placement';
import { groupName, soleGroup, selectionHasGroups } from '../core/groups';
import { addSelectionToComponents } from './components';
import { SHIFT } from './dom';

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

/** "Non proposée en version porte, 2 tiroirs" when an EKET colour is not sold for some of these versions. */
function eketNotSoldIn(es: EketItem[], c: EketColorId): string | null {
  const miss = new Set<string>();
  for (const e of es) if (!eketColorSold(eketDef(e.variant).id, c)) miss.add(eketDef(e.variant).label.toLowerCase());
  return miss.size ? t('insp.eketNotSold', { list: [...miss].join(', ') }) : null;
}

const isEket = (i: Item): i is EketItem => i.kind === 'eket';
const isKallax = (i: Item): i is KallaxItem => i.kind === 'kallax';
const isBlock = (i: Item): i is BlockItem => i.kind === 'block';

/** Price card for one or several pieces of furniture (KALLAX, EKET): total + breakdown + BOM warnings. */
function priceCard(ks: Item[], label: string): HTMLElement {
  const b = buildBom(ks, store.doc.finish, store.doc.basket, store.doc.eketFinish);
  const sum = (kind: string) => b.lines.filter(l => l.kind === kind);
  const parts: string[] = [];
  const fr = sum('frame'), lg = sum('legs'), ins = sum('insert'), ek = sum('eket');
  const tot = (ls: typeof b.lines) => ls.reduce((s, l) => s + (l.total ?? 0), 0);
  const cnt = (ls: typeof b.lines) => ls.reduce((s, l) => s + l.qty, 0);
  const nb = (t: string) => t.replace(/ /g, '\u00a0');
  if (fr.length) parts.push(fr.every(l => l.total == null) ? t('insp.customFrame') : tn('insp.frames', cnt(fr), { price: fmtEur(tot(fr)) }));
  const klg = lg.filter(l => !l.key.startsWith('el:')), elg = lg.filter(l => l.key.startsWith('el:'));
  if (klg.length) parts.push(tn('insp.legs', cnt(klg), { price: klg.every(l => l.total == null) ? '—' : fmtEur(tot(klg)) }));
  if (ins.length) parts.push(tn('insp.inserts', cnt(ins), { price: fmtEur(tot(ins)) }));
  if (ek.length && (fr.length || ek.length > 1 || cnt(ek) > 1 || elg.length)) parts.push(tn('insp.eket', cnt(ek), { price: fmtEur(tot(ek)) }));
  if (elg.length) parts.push(tn('insp.eketLegsPart', cnt(elg), { price: fmtEur(tot(elg)) }));
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
    // EKET colour (global), when the composition has EKET units
    const ekets = all.filter(isEket);
    if (ekets.length) {
      const ge = store.doc.eketFinish ?? DEFAULT_EKET_COLOR;
      const ep = finishPicker<EketColorId>({
        title: t('insp.eketColorGlobal'), ariaLabel: t('insp.eketGlobalAria'), list: EKET_COLORS,
        onPick: c => { if (c && c !== (store.doc.eketFinish ?? DEFAULT_EKET_COLOR)) store.update(d => { d.eketFinish = c; }); },
      });
      const visE = items.filter(isEket);
      ep.set({ value: ge, global: ge, unavailable: c => eketNotSoldIn(visE, c) });
      const eo = ekets.filter(e => e.finish && e.finish !== ge).length;
      if (eo) ep.el.append(h('p', { class: 'hint finish-hint' }, tn('insp.eketOverrides', eo)));
      el.append(ep.el);
    }

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
  const heroIcon = h('div', { class: 'hero-icon' }, icon(itemIcon(it0), 22));
  const lockBanner = h('div', { class: 'banner', role: 'note' }, icon('lock', 13), t('insp.lockedBanner'));
  const overlapBanner = h('div', { class: 'banner warn', role: 'alert' }, icon('warning', 13), t('insp.overlap'));
  let collideSw: ReturnType<typeof switchRow> | null = null;
  let eketChips: { el: HTMLButtonElement; v: EketVariant }[] = [];
  let eketP: ReturnType<typeof finishPicker<EketColorId>> | null = null;
  let legsColorSeg: ReturnType<typeof segmented<KallaxLegsColor>> | null = null;
  let legsColorRow: HTMLElement | null = null;
  let eketLegsSw: ReturnType<typeof switchRow> | null = null;
  let eketLegChips: { el: HTMLButtonElement; id: EketLegId }[] = [];
  let eketLegsGroup: HTMLElement | null = null;
  const eketLegsLink = h('div', { class: 'product-link-row' });
  const contentsEl = h('p', { class: 'hint variant-note' });
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
  let variantPick: VariantPicker | null = null;
  let colorP: ColorPicker | null = null;
  const variantNoteEl = h('p', { class: 'hint variant-note' });
  const linkHost = h('div', { class: 'product-link-row' });
  if (it0.kind === 'kallax') {
    // steppers only offer the formats IKEA sells (they skip to the next sold one)
    const cur = () => { const x = store.getItem(id); return x && x.kind === 'kallax' ? x : it0; };
    colsSt = stepper({ label: t('insp.columns'), value: it0.cols, min: 1, max: MAX_CELLS, next: (v, dir) => nextOfficial('cols', v, cur().rows, dir), onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, v, x.rows); x.cols = v; } }) });
    rowsSt = stepper({ label: t('insp.rows'), value: it0.rows, min: 1, max: MAX_CELLS, next: (v, dir) => nextOfficial('rows', cur().cols, v, dir), onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, x.cols, v); x.rows = v; } }) });
    legsSw = switchRow({
      label: t('insp.legs'), hint: `+${fmtCm(KALLAX.legs)} cm · 2×2, 2×4, 4×3, 4×4`, icon: 'arrowUp', value: !!it0.legs,
      onChange: v => store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (!x || x.kind !== 'kallax' || !!x.legs === v) return;
        liftStacked(d.items, x, v ? KALLAX.legs : -KALLAX.legs);
        x.legs = v;
        x.name = x.name.replace(LEGS_SUFFIX_RE, '') + (v && /^Kallax \d×\d/.test(x.name) ? t('kallax.legsSuffix') : '');
      }),
    });
    // underframe colour ("KALLAX Structure" white / black, same price)
    legsColorSeg = segmented<KallaxLegsColor>({
      ariaLabel: t('insp.legsColor'), size: 'sm', value: it0.legsColor ?? 'blanc', cls: 'legs-seg',
      options: KALLAX_LEGS_COLORS.map(c => ({ value: c.id, label: c.label })),
      onChange: v => store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (!x || x.kind !== 'kallax' || (x.legsColor ?? 'blanc') === v) return;
        if (v === 'blanc') delete x.legsColor; else x.legsColor = v;
      }),
    });
    legsColorRow = h('div', { class: 'obj-row insp-row legs-color-row' }, h('span', { class: 'obj-row-label' }, t('insp.eketColor')), legsColorSeg.el);
    sizeGroup = group(t('insp.cells'), h('div', { class: 'steppers' }, colsSt.el, rowsSt.el), legsSw.el, legsColorRow);
  } else if (it0.kind === 'eket') {
    // EKET: version chips (each product has its own size), colour, product link
    const setVariant = (v: EketVariant) => store.update(d => {
      const x = d.items.find(i => i.id === id);
      if (!x || x.kind !== 'eket' || x.variant === v) return;
      if (x.name === eketDisplayName(x.variant)) x.name = eketDisplayName(v);
      x.variant = v;
    });
    eketChips = EKET_VARIANTS.map(v => {
      const b = h('button', { type: 'button', class: 'chip' }, v.label);
      tip(b, `${v.product} · ${eketDims(v.id).replace(/×/g, ' × ')} cm · ${t('common.from', { price: fmtEur(eketMinPrice(v.id)) })}`);
      b.addEventListener('click', () => { if (!b.disabled) setVariant(v.id); });
      return { el: b, v: v.id };
    });
    sizeGroup = group(t('insp.eketVersion'), h('div', { class: 'chips insp-chips eket-chips', role: 'group', 'aria-label': t('lib.eketAria') }, eketChips.map(c => c.el)),
      variantNoteEl, contentsEl, linkHost);
    // legs: switch (+10 cm, lifts what is stacked on the unit) + model chips
    let lastLeg: EketLegId = it0.legs ?? 'bois';
    const setLegs = (leg: EketLegId | null) => store.update(d => {
      const x = d.items.find(i => i.id === id);
      if (!x || x.kind !== 'eket' || (x.legs ?? null) === leg) return;
      if (!!x.legs !== !!leg) liftStacked(d.items, x, leg ? EKET.legs : -EKET.legs);
      if (leg) x.legs = leg; else delete x.legs;
    });
    eketLegsSw = switchRow({
      label: t('insp.eketLegs'), hint: t('insp.eketLegsHint'), icon: 'arrowUp', value: !!it0.legs,
      onChange: v => setLegs(v ? lastLeg : null),
    });
    eketLegChips = EKET_LEGS.map(l => {
      const b = h('button', { type: 'button', class: 'chip leg-chip' }, h('span', { class: 'leg-dot', style: `--sw:${l.hex}`, 'aria-hidden': 'true' }), l.label);
      tip(b, t('insp.legsModelTip', { product: l.product, price: fmtEur(l.price) }));
      b.addEventListener('click', () => { if (!b.disabled) { lastLeg = l.id; setLegs(l.id); } });
      return { el: b, id: l.id };
    });
    eketLegsGroup = h('div', { class: 'insp-group legs-group' }, eketLegsSw.el,
      h('div', { class: 'chips insp-chips leg-chips', role: 'group', 'aria-label': t('insp.eketLegsAria') }, eketLegChips.map(c => c.el)), eketLegsLink);
    eketP = finishPicker<EketColorId>({
      withGlobal: true, ariaLabel: t('insp.thisEketAria'), title: t('insp.eketColor'), list: EKET_COLORS,
      onPick: c => {
        const x0 = store.getItem(id);
        if (!x0 || x0.kind !== 'eket' || store.isLocked(x0) || (x0.finish ?? null) === c) return;
        store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'eket') { if (c) x.finish = c; else delete x.finish; } });
      },
    });
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
    // preset objects (bed, lamp, plant, desk, chair): pick a type / size, no free dimensions
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
      if (v.colors?.length) { if (!v.colors.some(c => c.id === x.color)) x.color = v.colors[0].id; }
      else delete x.color;
      if (wasAuto) x.name = autoName(x.shape, v.id);
    });
    variantPick = variantPicker({ shape, value: it0.variant, onPick: setVariant, cls: 'insp-variants' });
    sizeGroup = group(t('insp.variant'), variantPick.el, variantNoteEl, linkHost);
    if (OBJECT_BY_SHAPE[shape].variants!.some(v => v.colors?.length)) {
      colorP = colorPicker({
        cls: 'insp-group',
        onPick: cid => {
          const cur = store.getItem(id);
          if (!cur || cur.kind !== 'block' || store.isLocked(cur) || colorOf(shape, cur.variant, cur.color)?.id === cid && cur.color === cid) return;
          store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.color = cid; });
        },
      });
    }
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

  if (it0.kind === 'block') {
    collideSw = switchRow({
      label: t('insp.collisions'), hint: t('insp.collisionsHint'), icon: 'collide', value: it0.collide !== false,
      onChange: v => store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (!x || x.kind !== 'block' || (x.collide !== false) === v) return;
        if (v) delete x.collide; else x.collide = false;
      }),
    });
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
  const compBtn = componentButton();
  // member of a group (entered with a double-click): say so, offer to go back to the whole group
  const groupText = h('span', { class: 'banner-text' });
  const groupBack = h('button', { type: 'button', class: 'banner-link' }, t('group.selectWhole'));
  tip(groupBack, t('group.selectWholeTip'), t('key.esc'));
  groupBack.addEventListener('click', () => { store.exitGroup(); });
  const groupBanner = h('div', { class: 'banner group-banner', role: 'note' }, icon('group', 13), groupText, groupBack);

  el.append(
    h('div', { class: 'insp-hero' }, heroIcon, h('div', { class: 'hero-text' }, nameField.el, typeLabel)),
    groupBanner, lockBanner, overlapBanner,
    dimsHost,
    priceHost,
    group(t('common.position'), h('div', { class: 'fields-3' }, fx.el, fy.el, fz.el)),
    group(t('insp.rotation'), h('div', { class: 'rot-rows' }, rotRows.map(r => r.row))),
    sizeGroup,
    ...(colorP ? [colorP.el] : []),
    ...(finishP ? [finishP.el] : []),
    ...(eketLegsGroup ? [eketLegsGroup] : []),
    ...(eketP ? [eketP.el] : []),
    ...(collideSw ? [h('div', { class: 'insp-group collide-group' }, collideSw.el)] : []),
    group(t('common.layer'), layerWrap),
    group(t('common.duplicate'), dupBtns),
    h('div', { class: 'insp-group insp-actions' }, compBtn, delBtn),
  );

  const editables: { setDisabled(d: boolean): void }[] = [fx, fy, fz, nameField];
  if (colsSt) editables.push(colsSt, rowsSt!);
  for (const f of [fw, fd, fh]) if (f) editables.push(f);
  if (handleSeg) editables.push(handleSeg);
  if (variantPick) editables.push(variantPick);

  const update = () => {
    const it = store.getItem(id);
    if (!it) return;
    const s = worldSize(it);
    const locked = store.isLocked(it);
    nameField.set(it.name);
    groupBanner.hidden = !it.groupId;
    if (it.groupId) groupText.textContent = t('group.inGroup', { name: groupName(store.doc, it.groupId) });
    if (it.kind === 'kallax') {
      // every library format is IKEA's: only older custom formats get a pill
      const off = isOfficial(it.cols, it.rows);
      typeLabel.replaceChildren(`Kallax ${it.cols}×${it.rows} · ${kallaxNominal(it.cols)}×${kallaxNominal(it.rows)} cm `,
        ...(off ? [] : [h('span', { class: 'pill pill-custom' }, t('common.custom'))]));
      colsSt!.set(it.cols); rowsSt!.set(it.rows);
      const can = legsAvailable(it.cols, it.rows) || !!it.legs;
      legsSw!.set(!!it.legs);
      legsSw!.input.disabled = !can || locked;
      legsSw!.el.classList.toggle('disabled', !can);
      legsSw!.el.title = can ? '' : t('insp.legsTitle');
      legsColorSeg!.set(it.legsColor ?? 'blanc');
      legsColorSeg!.setDisabled(locked);
      legsColorRow!.hidden = !it.legs;
      finishP!.set({
        value: it.finish ?? null, inherit: !it.finish, global: store.doc.finish ?? DEFAULT_FINISH,
        unavailable: f => notSoldIn([it], f), disabled: locked,
      });
      priceHost.replaceChildren(priceCard([it], t('insp.price')));
    } else if (it.kind === 'eket') {
      const v = eketDef(it.variant);
      const c = effectiveEketColor(it, store.doc.eketFinish);
      typeLabel.textContent = t('insp.typeEket', { variant: v.label, dims: eketDims(v.id).replace(/×/g, ' × ') });
      for (const ch of eketChips) {
        const on = ch.v === v.id;
        ch.el.classList.toggle('on', on);
        ch.el.setAttribute('aria-pressed', String(on));
        ch.el.disabled = locked;
      }
      variantNoteEl.textContent = v.note ?? '';
      variantNoteEl.hidden = !v.note;
      contentsEl.textContent = v.contents ?? '';
      contentsEl.hidden = !v.contents;
      const link = productLink(eketPrice(v.id, c).url);
      linkHost.replaceChildren(...(link ? [link] : []));
      linkHost.hidden = !link;
      eketP!.set({
        value: it.finish ?? null, inherit: !it.finish, global: store.doc.eketFinish ?? DEFAULT_EKET_COLOR,
        unavailable: cc => eketNotSoldIn([it], cc), disabled: locked,
      });
      heroIcon.replaceChildren(icon(itemIcon(it), 22));
      priceHost.replaceChildren(priceCard([it], t('insp.price')));
      // legs
      const canLegs = eketLegsAllowed(v.id) || !!it.legs;
      eketLegsSw!.set(!!it.legs);
      eketLegsSw!.input.disabled = !canLegs || locked;
      eketLegsSw!.el.classList.toggle('disabled', !canLegs);
      eketLegsSw!.el.title = canLegs ? '' : t('insp.eketLegsWall');
      for (const c of eketLegChips) {
        const on = c.id === it.legs;
        c.el.classList.toggle('on', on);
        c.el.setAttribute('aria-pressed', String(on));
        c.el.disabled = locked || !canLegs;
      }
      const legLink = it.legs && EKET_LEG_BY_ID[it.legs] ? productLink(EKET_LEG_BY_ID[it.legs].url) : null;
      eketLegsLink.replaceChildren(...(legLink ? [legLink] : []));
      eketLegsLink.hidden = !legLink;
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
    } else if (variantPick) {
      const v = variantOf(it.shape!, it.variant);
      // type · group · variant ("Lampe · Sur pied · Arc 190"); the group is skipped when it repeats the type ("Bureau · Bureaux")
      const type = objLabel(it.shape), grp = groupLabel(it.shape, it.variant);
      const sameRoot = grp && grp.toLocaleLowerCase().startsWith(type.toLocaleLowerCase().slice(0, 4));
      typeLabel.textContent = [type, sameRoot ? '' : grp, variantLabel(it.shape, it.variant)].filter(Boolean).join(' · ');
      variantPick.set(v?.id);
      const note = variantNote(v);
      variantNoteEl.textContent = note;
      variantNoteEl.hidden = !note;
      const link = productLink(v?.url);
      linkHost.replaceChildren(...(link ? [link] : []));
      linkHost.hidden = !link;
      colorP?.set(v?.colors, it.color, locked);
      heroIcon.replaceChildren(icon(shapeIcon(it.shape, it.variant), 22));
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
    // collisions switch (objects) + overlap warning: items with collisions off neither warn nor are warned about
    if (collideSw && it.kind === 'block') {
      collideSw.set(it.collide !== false);
      collideSw.input.disabled = locked;
    }
    const mine = collisionBoxes(it);
    overlapBanner.hidden = !collides(it) || !store.visibleItems().some(o => o.id !== it.id && collides(o) && collisionBoxes(o).some(ob => mine.some(b => boxesOverlap(b, ob))));
  };
  update();
  return { el, update };
}

/**
 * Lift (or lower) by dz everything stacked on top of `x`, transitively (used
 * when legs are added / removed). Works on the draft items of a store.update().
 */
function liftStacked(items: Item[], x: Item, dz: number) {
  const top = itemBox(x).max.z;
  const moved = [itemBox(x)];
  const xyOverlap = (a: ReturnType<typeof itemBox>, b: ReturnType<typeof itemBox>) =>
    a.min.x < b.max.x - 0.01 && a.max.x > b.min.x + 0.01 && a.min.y < b.max.y - 0.01 && a.max.y > b.min.y + 0.01;
  const above = items.filter(o => o.id !== x.id && itemBox(o).min.z >= top - 0.01).sort((a, b) => a.position.z - b.position.z);
  for (const o of above) {
    const ob = itemBox(o);
    if (moved.some(m => xyOverlap(m, ob))) { moved.push(ob); o.position = { ...o.position, z: o.position.z + dz }; }
  }
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

/** Wide secondary button: "Ajouter aux composants". */
function componentButton(): HTMLButtonElement {
  return button({ icon: 'component', label: t('comp.addTitle'), tip: t('comp.addTip'), cls: 'btn-secondary wide', onClick: () => { void addSelectionToComponents(); } });
}

/** Group / ungroup tiles (multi-selection and group panels). */
function groupRow(): { el: HTMLElement; update(sole: string | null, hasGroups: boolean, n: number): void } {
  const mk = (ic: string, label: string, kbd: string, tipText: string, on: () => void) => {
    const el = h('button', { type: 'button', class: 'dup-btn' }, icon(ic, 18), h('span', { class: 'dup-label' }, label));
    tip(el, tipText, kbd);
    el.addEventListener('click', on);
    return el;
  };
  const grp = mk('group', t('group.group'), `${MOD}G`, t('group.groupTip'), () => cmd.groupSelection());
  const ungrp = mk('ungroup', t('group.ungroup'), `${SHIFT}${MOD}G`, t('group.ungroupTip'), () => cmd.ungroupSelection());
  const el = h('div', { class: 'dup-row group-row' }, grp, ungrp);
  return {
    el,
    update(sole, hasGroups, n) {
      grp.hidden = !!sole || n < 2;
      ungrp.hidden = !hasGroups;
      el.style.gridTemplateColumns = `repeat(${[grp, ungrp].filter(b => !b.hidden).length || 1}, 1fr)`;
    },
  };
}

// ── multi selection (or one whole group) ─────────────────────
function multiPanel(gid: string | null): Panel {
  const el = h('div', { class: 'insp-panel' });
  const title = h('div', { class: 'hero-title' });
  const sub = h('div', { class: 'hero-sub' });
  const groupNameField = gid ? textField({ value: groupName(store.doc, gid), ariaLabel: t('group.nameAria'), cls: 'hero-name', onCommit: v => cmd.renameGroup(gid, v) }) : null;
  const grpRow = groupRow();
  const compBtn = componentButton();
  const dimsHost = h('div');
  const alignRow = h('div', { class: 'dup-row' },
    alignBtn('x', 'alignLeft', t('insp.alignLeft'), 'min X'),
    alignBtn('y', 'alignFront', t('insp.alignFront'), 'min Y'),
    alignBtn('z', 'alignBottom', t('insp.alignBottom'), 'min Z'));
  const delBtn = button({ icon: 'trash', label: t('insp.deleteSel'), kbd: '⌫', cls: 'btn-destructive wide', onClick: () => cmd.deleteSelection() });
  const editable = () => store.selectedItems().filter(i => !store.isLocked(i));
  const finishP = finishPicker({
    withGlobal: true, ariaLabel: t('insp.selFinishAria'),
    onPick: f => {
      const ids = new Set(editable().filter(isKallax).filter(k => (k.finish ?? null) !== f).map(k => k.id));
      if (!ids.size) return;
      store.update(d => {
        for (const x of d.items) if (ids.has(x.id) && x.kind === 'kallax') { if (f) x.finish = f; else delete x.finish; }
      });
    },
  });
  const eketP = finishPicker<EketColorId>({
    withGlobal: true, title: t('insp.eketColorGlobal'), ariaLabel: t('insp.selEketAria'), list: EKET_COLORS,
    onPick: c => {
      const ids = new Set(editable().filter(isEket).filter(e => (e.finish ?? null) !== c).map(e => e.id));
      if (!ids.size) return;
      store.update(d => {
        for (const x of d.items) if (ids.has(x.id) && x.kind === 'eket') { if (c) x.finish = c; else delete x.finish; }
      });
    },
  });
  // Collisions of the selected objects (furniture always collides); mixed state allowed
  const collideSw = switchRow({
    label: t('insp.collisions'), hint: t('insp.collisionsHintMulti'), icon: 'collide', value: true,
    onChange: v => {
      const ids = new Set(editable().filter(isBlock).filter(b => (b.collide !== false) !== v).map(b => b.id));
      if (!ids.size) return;
      store.update(d => {
        for (const x of d.items) if (ids.has(x.id) && x.kind === 'block') { if (v) delete x.collide; else x.collide = false; }
      });
    },
  });
  const collideHint = collideSw.el.querySelector('small');
  const collideGroup = h('div', { class: 'insp-group collide-group' }, collideSw.el);
  const priceHost = h('div', { class: 'price-host' });
  el.append(
    h('div', { class: 'insp-hero' }, h('div', { class: 'hero-icon' }, icon(gid ? 'group' : 'duplicate', 22)),
      h('div', { class: 'hero-text' }, groupNameField ? groupNameField.el : title, sub)),
    h('div', { class: 'insp-group' }, grpRow.el, h('div', { class: 'comp-btn-wrap' }, compBtn)),
    group(gid ? t('group.size') : t('insp.groupSize'), dimsHost),
    priceHost,
    finishP.el,
    eketP.el,
    collideGroup,
    group(t('insp.align'), alignRow),
    group(t('insp.dupGroup'), dupRow()),
    h('div', { class: 'insp-group' }, delBtn),
  );
  const update = () => {
    const sel = store.selectedItems();
    title.textContent = t('insp.selCount', { n: sel.length });
    const ks = sel.filter(isKallax), es = sel.filter(isEket), bs = sel.filter(isBlock);
    const parts = [
      ks.length ? t('insp.selKallax', { n: ks.length }) : '',
      es.length ? t('insp.selEket', { n: es.length }) : '',
      bs.length ? tn('insp.selBlocks', bs.length) : '',
    ].filter(Boolean);
    if (gid) {
      groupNameField!.set(groupName(store.doc, gid));
      sub.textContent = `${t('group.kind')} · ${tn('comp.items', sel.length)}`;
      sub.title = parts.join(' · ');
    } else sub.textContent = parts.join(' · ');
    grpRow.update(gid, selectionHasGroups(store.selection, store.items), sel.length);
    delBtn.querySelector('.btn-label')!.textContent = gid ? t('group.delete') : t('insp.deleteSel');
    const u = unionBox(sel);
    if (u) dimsHost.replaceChildren(dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z));
    // price of the selected furniture (KALLAX + EKET)
    const furn = [...ks, ...es];
    const label = es.length && ks.length ? t('insp.nFurniture', { n: furn.length })
      : es.length ? (es.length > 1 ? t('insp.nEket', { n: es.length }) : 'EKET')
      : ks.length > 1 ? t('insp.nKallax', { n: ks.length }) : 'Kallax';
    priceHost.replaceChildren(...(furn.length ? [priceCard(furn, gid ? t('group.subtotal') : label)] : []));
    // finish of the selected KALLAX (one undo step for all)
    finishP.el.hidden = !ks.length;
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
    eketP.el.hidden = !es.length;
    if (es.length) {
      const cs = es.map(e => e.finish ?? null);
      const same = cs.every(c => c === cs[0]);
      eketP.set({
        value: same ? cs[0] : null, inherit: same && cs[0] === null, mixed: !same,
        global: store.doc.eketFinish ?? DEFAULT_EKET_COLOR,
        unavailable: c => eketNotSoldIn(es, c),
        disabled: es.every(e => store.isLocked(e)),
      });
    }
    collideGroup.hidden = !bs.length;
    if (bs.length) {
      const on = bs.filter(b => b.collide !== false).length;
      const mixed = on > 0 && on < bs.length;
      collideSw.set(on === bs.length);
      collideSw.input.classList.toggle('mixed', mixed);
      if (mixed) collideSw.input.setAttribute('aria-checked', 'mixed');
      collideSw.input.disabled = bs.every(b => store.isLocked(b));
      if (collideHint) collideHint.textContent = mixed ? t('insp.collisionsMixed') : t('insp.collisionsHintMulti');
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
    const gid = sel.length > 1 ? soleGroup(store.selection, store.visibleItems()) : null;
    const k = sel.length === 0 ? 'none' : sel.length === 1 ? `one:${sel[0].id}:${sel[0].kind}` : `multi:${gid ?? ''}`;
    if (k !== key || !panel) {
      key = k;
      panel = k === 'none' ? summaryPanel() : k.startsWith('multi') ? multiPanel(gid) : itemPanel(sel[0].id);
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

/** Glyph of a block shape (variant / catalogue icon; legacy shape-less blocks are bricks). */
export function shapeIcon(shape: BlockShape | undefined, variant?: string): string {
  return (shape && variantOf(shape, variant)?.icon) || (OBJECT_BY_SHAPE[shape ?? 'box']?.icon ?? 'box');
}

/** Glyph of any item (layers list, inspector hero). */
export function itemIcon(it: Item): string {
  if (it.kind === 'kallax') return 'grid';
  if (it.kind === 'eket') return eketDef(it.variant).icon;
  return shapeIcon(it.shape, it.variant);
}
