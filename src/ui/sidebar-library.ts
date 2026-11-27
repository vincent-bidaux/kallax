// Library: KALLAX catalogue tiles (to-scale front elevations) + free block builder.
import { CATALOG, IKEA_LINKS, INSERTS, KALLAX, fmtCm, kallaxOuter, cylinderSize, type CatalogEntry } from '../core/kallax';
import type { InsertType } from '../core/types';
import type { InsertTool } from '../interaction/context';
import { store, uid } from '../core/store';
import type { BlockItem, BlockShape, Item, KallaxItem } from '../core/types';
import { h, svg } from './dom';
import { numberField, segmented, tip } from './controls';
import { icon } from './icons';
import { INSERT_NAMES, fmtEur, fmtEurShort, frameMinPrice, insertMinPrice } from '../core/finishes';
import { t, locale, type TKey } from '../core/i18n';
import { OBJECT_DEFS, OBJECT_GROUPS, OBJECT_BY_SHAPE, colorOf, variantOf, type ObjectGroup } from '../core/objects';
import { autoName, baseZOf, colorLabel, objLabel } from './object-labels';
import { colorPicker, variantNote, variantPicker } from './variant-picker';
import { beginLibraryDrag } from '../interaction/drag-drop';
import { freeSpot } from '../interaction/placement';
import { ui } from '../interaction/context';

/** Same px/cm for every tile: a 5×5 (181,5 cm) fills the 58 px drawing box. */
const TILE_BOX = 58;
const FRENCH_WINDOW = t('preset.frenchWindow');
const SCALE = TILE_BOX / kallaxOuter(5);

export function kallaxElevationSVG(cols: number, rows: number, scale = SCALE): SVGSVGElement {
  const W = kallaxOuter(cols) * scale, H = kallaxOuter(rows) * scale;
  const p = KALLAX.outerPanel * scale, dv = KALLAX.divider * scale, c = KALLAX.cell * scale;
  let holes = '';
  let cells = '';
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = p + i * (c + dv), y = p + j * (c + dv);
    holes += `M${x.toFixed(2)} ${y.toFixed(2)}h${c.toFixed(2)}v${c.toFixed(2)}h${(-c).toFixed(2)}z`;
    cells += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${c.toFixed(2)}" height="${c.toFixed(2)}"/>`;
  }
  const pad = 1;
  return svg(`<svg class="elev" width="${(W + pad * 2).toFixed(1)}" height="${(H + pad * 2).toFixed(1)}" viewBox="${-pad} ${-pad} ${(W + pad * 2).toFixed(2)} ${(H + pad * 2).toFixed(2)}" aria-hidden="true">
    <g class="elev-cells">${cells}</g>
    <path class="elev-frame" fill-rule="evenodd" d="M0 0h${W.toFixed(2)}v${H.toFixed(2)}h${(-W).toFixed(2)}z${holes}"/>
    <rect class="elev-outline" x="0" y="0" width="${W.toFixed(2)}" height="${H.toFixed(2)}" rx="${Math.min(0.8, p / 2).toFixed(2)}"/>
  </svg>`);
}

/** Small isometric preview of a box (used for blocks). */
export function boxIsoSVG(w: number, d: number, hgt: number, maxW = 84, maxH = 58): SVGSVGElement {
  const c = Math.cos(Math.PI / 6), s = 0.5;
  // Seen from front-right-top (+1, −1, +1): X goes right-down, Y (depth) right-up.
  const Q = (x: number, y: number, z: number) => [(x + y) * c, (x - y) * s - z] as const;
  const q = [Q(0, 0, 0), Q(w, 0, 0), Q(w, d, 0), Q(0, d, 0), Q(0, 0, hgt), Q(w, 0, hgt), Q(w, d, hgt), Q(0, d, hgt)];
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min(maxW / (maxX - minX || 1), maxH / (maxY - minY || 1));
  const T = (i: number) => `${((q[i][0] - minX) * k + 1).toFixed(2)},${((q[i][1] - minY) * k + 1).toFixed(2)}`;
  const face = (ids: number[], cls: string) => `<polygon class="${cls}" points="${ids.map(T).join(' ')}"/>`;
  const W = (maxX - minX) * k + 2, H = (maxY - minY) * k + 2;
  return svg(`<svg class="iso-box" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" aria-hidden="true">
    ${face([0, 1, 5, 4], 'f-front')}${face([1, 2, 6, 5], 'f-side')}${face([4, 5, 6, 7], 'f-top')}
  </svg>`);
}

function makeKallax(e: CatalogEntry): KallaxItem {
  return {
    id: uid(), kind: 'kallax', name: `Kallax ${e.label}`, cols: e.cols, rows: e.rows,
    position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId: store.doc.activeLayerId,
  };
}

function insertAtFreeSpot(it: Item) {
  it.position = freeSpot(it);
  if (it.kind === 'block') it.position = { ...it.position, z: it.position.z + baseZOf(it.shape) };
  store.addItem(it);
  ui.viewport.zoomToFit(true);
}

export function buildLibrary(host: HTMLElement) {
  // ── KALLAX ──
  let filter: 'all' | 'ikea' = 'all';
  const grid = h('div', { class: 'lib-grid', role: 'list', 'aria-label': t('lib.sizesAria') });
  const tiles: { el: HTMLElement; entry: CatalogEntry }[] = [];
  for (const e of CATALOG) {
    const dims = `${fmtCm(e.exact.w)} × ${fmtCm(e.exact.d)} × ${fmtCm(e.exact.h)} cm`;
    const min = frameMinPrice(e.cols, e.rows);
    const price = min != null ? t('common.from', { price: fmtEur(min) }) : null;
    const el = h('div', {
      class: `lib-tile ${e.official ? 'official' : 'custom'}`, role: 'listitem button', tabindex: '0',
      'aria-label': price ? t('lib.tileAriaIkea', { label: e.label, nominal: e.nominal, price }) : t('lib.tileAriaCustom', { label: e.label, nominal: e.nominal }),
    },
      h('div', { class: 'tile-art' }, kallaxElevationSVG(e.cols, e.rows)),
      h('div', { class: 'tile-label' }, e.label,
        e.official ? h('span', { class: 'badge-ikea', 'aria-hidden': 'true' }, t('common.ikea')) : null),
      h('div', { class: 'tile-sub' }, e.nominal.replace(' cm', '')),
      h('div', { class: `tile-price${price ? '' : ' custom'}`, 'aria-hidden': 'true' },
        price ? [h('span', { class: 'tp-from' }, t('common.fromPrefix')), fmtEur(min!)] : t('common.customLower')),
    );
    tip(el, price
      ? `KALLAX ${e.label} · ${dims} — ${price}`
      : t('lib.tipCustom', { dims }));
    el.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, el, () => makeKallax(e), `Kallax ${e.label}`));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); insertAtFreeSpot(makeKallax(e)); }
      if (ev.key.startsWith('Arrow')) {
        ev.preventDefault();
        const vis = tiles.filter(t => !t.el.hidden).map(t => t.el);
        const i = vis.indexOf(el);
        const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowDown' ? 3 : -3;
        vis[Math.max(0, Math.min(vis.length - 1, i + d))]?.focus();
      }
    });
    tiles.push({ el, entry: e });
    grid.appendChild(el);
  }
  const filterSeg = segmented<'all' | 'ikea'>({
    ariaLabel: t('lib.filterAria'), size: 'sm', value: filter,
    options: [{ value: 'all', label: t('lib.filterAll') }, { value: 'ikea', label: t('common.ikea'), tip: t('lib.filterIkeaTip') }],
    onChange: v => { filter = v; for (const t of tiles) t.el.hidden = v === 'ikea' && !t.entry.official; },
    cls: 'lib-filter',
  });
  const kallaxSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'KALLAX'), filterSeg.el),
    grid,
    h('p', { class: 'hint' }, icon('cursor', 12), t('lib.kallaxHint')));

  // ── HABILLAGE (cell fittings tool) ──
  const TOOLS: { id: InsertTool; label: string; icon: string; tip: string; price?: number }[] = [
    ...(Object.keys(INSERTS) as InsertType[]).map(k => ({
      id: k as InsertTool, label: INSERTS[k].label, icon: INSERTS[k].icon, price: insertMinPrice(k),
      tip: `${INSERT_NAMES[k]} ${k === 'basket' ? '33×38×33' : '33×33'} · ${t('common.from', { price: fmtEur(insertMinPrice(k)) })}`,
    })),
    { id: 'erase', label: t('lib.erase'), icon: 'eraser', tip: t('lib.eraseTip') },
  ];
  const toolBtns = TOOLS.map(tl => {
    const el = h('button', { type: 'button', class: 'obj-type tool-btn', 'aria-pressed': 'false', 'aria-label': tl.price != null ? `${tl.label}, ${t('common.from', { price: fmtEur(tl.price) })}` : tl.label },
      icon(tl.icon, 20), h('span', null, tl.label),
      h('small', { class: 'tool-price', 'aria-hidden': 'true' }, tl.price != null ? fmtEurShort(tl.price) : '\u00a0'));
    tip(el, t('lib.toolTip', { tip: tl.tip }));
    el.addEventListener('click', () => ui.setInsertTool(ui.insertTool === tl.id ? null : tl.id));
    return { el, t: tl };
  });
  const toolHint = h('p', { class: 'hint tool-hint' }, icon('cursor', 12), t('lib.toolHint'));
  const syncTools = () => {
    for (const b of toolBtns) { const on = ui.insertTool === b.t.id; b.el.classList.toggle('on', on); b.el.setAttribute('aria-pressed', String(on)); }
    toolHint.classList.toggle('active', !!ui.insertTool);
    toolHint.lastChild!.textContent = ui.insertTool ? t('lib.toolHintActive') : t('lib.toolHint');
  };
  ui.on(e => { if (e === 'tool') syncTools(); });
  const insertSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.insertsTitle'))),
    h('div', { class: 'obj-types', role: 'toolbar', 'aria-label': t('lib.insertsAria') }, toolBtns.map(b => b.el)),
    toolHint,
  );

  // ── OBJETS: three groups (Blocks / House / Objects), one selected type at a time ──
  const objSecs = buildObjectGroups();

  const refSec = h('section', { class: 'panel-section lib-refs' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.refsTitle'))),
    h('ul', { class: 'ref-list' }, IKEA_LINKS.map(l =>
      h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'ref-link' },
        icon('arrowUpRight', 13), h('span', null, l.label))))),
    h('p', { class: 'ref-note' },
      t('lib.refNote', { legs: fmtCm(KALLAX.legs) })),
  );
  host.append(kallaxSec, insertSec, ...objSecs, refSec);
}

// ── Objects module ───────────────────────────────────────────
/** Library draft of one object type (what the next drop creates). */
interface Draft {
  w: number; d: number; h: number;
  /** Beams: Ø / side and length. */
  dia: number; len: number; axis: 'x' | 'z';
  variant?: string;
  /** Door: handle on the left. */
  mirror: boolean;
  /** Name override (window presets: "Porte-fenêtre"). */
  name?: string;
  /** Colour option id (variants with `colors`). */
  color?: string;
}

const TYPE_TIPS: Partial<Record<BlockShape, TKey>> = {
  box: 'obj.brickTip', cylinder: 'obj.roundTip', square: 'obj.squareTip',
  wall: 'obj.wallTip', window: 'obj.windowTip', door: 'obj.doorTip', skirting: 'obj.skirtingTip', radiator: 'obj.radiatorTip',
  bed: 'obj.bedTip', lamp: 'obj.lampTip', plant: 'obj.plantTip', desk: 'obj.deskTip', chair: 'obj.chairTip',
};

const WINDOW_PRESETS = [
  { name: '60 × 75', w: 60, h: 75 }, { name: '80 × 115', w: 80, h: 115 },
  { name: '100 × 125', w: 100, h: 125 }, { name: '120 × 135', w: 120, h: 135 },
  { name: FRENCH_WINDOW, w: 120, h: 215 },
];

const isBeam = (s: BlockShape) => s === 'cylinder' || s === 'square';

function buildObjectGroups(): HTMLElement[] {
  const drafts = Object.fromEntries(OBJECT_DEFS.map(def => [def.shape, {
    w: def.size.w, d: def.size.d, h: def.size.h,
    dia: def.size.h, len: def.size.w, axis: 'x',
    variant: def.defaultVariant, mirror: false,
  } satisfies Draft])) as Record<BlockShape, Draft>;
  let active: BlockShape = 'box';

  // shared editor (parameters + draggable tile), moved under the active group's type row
  const params = h('div', { class: 'obj-params' });
  const preview = h('div', { class: 'tile-art block-art' });
  const tileLabel = h('div', { class: 'tile-label' });
  const tileDims = h('div', { class: 'tile-sub' });
  const tileExtra = h('div', { class: 'tile-sub tile-extra' });
  const objTile = h('div', { class: 'lib-tile block-tile', role: 'button', tabindex: '0' },
    preview, h('div', { class: 'block-tile-text' }, tileLabel, tileDims, tileExtra),
    h('span', { class: 'block-grip', 'aria-hidden': 'true' }, icon('grip', 16)));
  tip(objTile, t('obj.tileTip'));
  const editor = h('div', { class: 'obj-editor' }, params, objTile);

  const nameOf = (shape: BlockShape) => drafts[shape].name ?? autoName(shape, drafts[shape].variant);

  const makeObject = (): BlockItem => {
    const shape = active, o = drafts[shape];
    const it: BlockItem = {
      id: uid(), kind: 'block', shape, name: nameOf(shape),
      position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId: store.doc.activeLayerId,
      size: { w: o.w, d: o.d, h: o.h },
    };
    if (isBeam(shape)) { it.axis = o.axis; it.size = cylinderSize(o.dia, o.len, o.axis); }
    else if (shape === 'wall') it.size = { w: o.w, d: 0, h: o.h };
    const v = variantOf(shape, o.variant);
    if (v && OBJECT_BY_SHAPE[shape].variants) { it.variant = v.id; it.size = { ...v.size }; }
    const c = colorOf(shape, o.variant, o.color);
    if (c) it.color = c.id;
    if (shape === 'door' && o.mirror) it.mirror = true;
    return it;
  };
  objTile.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, objTile, makeObject, nameOf(active)));
  objTile.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); insertAtFreeSpot(makeObject()); }
  });

  const num = (label: string, aria: string, value: number, onCommit: (v: number) => void, o: { step?: number; min?: number; max?: number; axis?: 'x' | 'y' | 'z' } = {}) =>
    numberField({ label, ariaLabel: aria, value, step: o.step ?? 1, min: o.min ?? 0.5, max: o.max ?? 5000, suffix: 'cm', axis: o.axis, onCommit: v => { onCommit(v); updateTile(); } }).el;
  const whd = (o: Draft, min = 0.5) => h('div', { class: 'fields-3' },
    num(t('dim.w'), t('aria.width'), o.w, v => o.w = v, { axis: 'x', min }),
    num(t('dim.d'), t('aria.depth'), o.d, v => o.d = v, { axis: 'y', min: Math.min(min, 0.5) }),
    num(t('dim.h'), t('aria.height'), o.h, v => o.h = v, { axis: 'z', min }));
  const chips = <T,>(aria: string, list: T[], label: (x: T) => string, on: (x: T) => boolean, pick: (x: T) => void, tipOf?: (x: T) => string) =>
    h('div', { class: 'chips', role: 'group', 'aria-label': aria }, list.map(x => {
      const el = h('button', { type: 'button', class: `chip${on(x) ? ' on' : ''}`, 'aria-pressed': String(on(x)) }, label(x));
      if (tipOf) tip(el, tipOf(x));
      el.addEventListener('click', () => { pick(x); render(); });
      return el;
    }));
  const inlineRow = (label: string, ctl: HTMLElement) =>
    h('div', { class: 'obj-row' }, h('span', { class: 'obj-row-label' }, label), ctl);

  const renderParams = () => {
    const shape = active, o = drafts[shape], def = OBJECT_BY_SHAPE[shape];
    const nodes: Node[] = [];
    if (isBeam(shape)) {
      const sq = shape === 'square';
      nodes.push(h('div', { class: 'fields-2' },
        num(sq ? '□' : 'Ø', sq ? t('aria.sectionSide') : t('aria.diameter'), o.dia, v => o.dia = v, { step: 0.5 }),
        num(t('dim.len'), t('aria.length'), o.len, v => o.len = v)));
      nodes.push(segmented<'x' | 'z'>({
        ariaLabel: t('obj.orientation'), size: 'sm', value: o.axis,
        options: [{ value: 'x', label: t('obj.horizontal') }, { value: 'z', label: t('obj.vertical') }],
        onChange: v => { o.axis = v; updateTile(); },
      }).el);
    } else if (shape === 'wall') {
      nodes.push(h('div', { class: 'fields-2' },
        num(t('dim.w'), t('aria.wallWidth'), o.w, v => o.w = v, { min: 1, axis: 'x' }),
        num(t('dim.h'), t('aria.wallHeight'), o.h, v => o.h = v, { min: 1, axis: 'z' })));
    } else if (shape === 'window') {
      nodes.push(chips(t('obj.windowSizesAria'), WINDOW_PRESETS, p => p.name, p => p.w === o.w && p.h === o.h,
        p => { o.w = p.w; o.h = p.h; o.name = p.name === FRENCH_WINDOW ? FRENCH_WINDOW : undefined; },
        p => `${fmtCm(p.w)} × ${fmtCm(p.h)} cm`));
      nodes.push(h('div', { class: 'fields-3' },
        num(t('dim.w'), t('aria.width'), o.w, v => o.w = v, { min: 20, axis: 'x' }),
        num(t('dim.d'), t('aria.frameDepth'), o.d, v => o.d = v, { min: 2, axis: 'y' }),
        num(t('dim.h'), t('aria.height'), o.h, v => o.h = v, { min: 20, axis: 'z' })));
    } else if (def.variants) {
      nodes.push(variantPicker({ shape, value: o.variant, onPick: id => { o.variant = id; render(); } }).el);
      const v = variantOf(shape, o.variant);
      if (v?.colors?.length) {
        const cp = colorPicker({ cls: 'lib-colors', onPick: id => { o.color = id; cp.set(v.colors, id); updateTile(); } });
        cp.set(v.colors, colorOf(shape, v.id, o.color)?.id);
        nodes.push(cp.el);
      }
    } else {
      nodes.push(whd(o, shape === 'door' ? 20 : 0.5));
      if (shape === 'door') nodes.push(inlineRow(t('obj.handle'), segmented<'r' | 'l'>({
        ariaLabel: t('obj.handleAria'), size: 'sm', value: o.mirror ? 'l' : 'r', cls: 'handle-seg',
        options: [{ value: 'r', label: t('obj.handleRight') }, { value: 'l', label: t('obj.handleLeft') }],
        onChange: v => { o.mirror = v === 'l'; updateTile(); },
      }).el));
    }
    params.replaceChildren(...nodes);
    params.hidden = !nodes.length;
  };

  const updateTile = () => {
    const shape = active, o = drafts[shape], def = OBJECT_BY_SHAPE[shape];
    const name = nameOf(shape);
    tileLabel.textContent = name;
    objTile.setAttribute('aria-label', t('obj.tileAria', { name }));
    let dims = '', extra = '';
    if (isBeam(shape)) {
      dims = `${shape === 'square' ? '□' : 'Ø'} ${fmtCm(o.dia)} × ${fmtCm(o.len)} cm`;
      extra = o.axis === 'x' ? t('obj.horizShort') : t('obj.vertShort');
      if (shape === 'square') { const s = cylinderSize(o.dia, o.len, o.axis); preview.replaceChildren(boxIsoSVG(s.w, s.d, s.h)); }
      else preview.replaceChildren(icon(def.icon, 40));
    } else {
      const v = def.variants ? variantOf(shape, o.variant) : undefined;
      const s = v ? v.size : { w: o.w, d: o.d, h: o.h };
      dims = shape === 'wall' ? `${fmtCm(s.w)} × ${fmtCm(s.h)} cm` : `${fmtCm(s.w)} × ${fmtCm(s.d)} × ${fmtCm(s.h)} cm`;
      if (shape === 'window') extra = t('obj.sill');
      else if (shape === 'door') extra = o.mirror ? t('obj.handleLeftLong') : t('obj.handleRightLong');
      else if (def.baseZ) extra = t('obj.aboveFloor', { cm: fmtCm(def.baseZ) });
      else if (v) extra = [variantNote(v), colorLabel(shape, v.id, o.color)].filter(Boolean).join(' · ');
      preview.replaceChildren(shape === 'box' ? boxIsoSVG(s.w, s.d, s.h) : icon(v?.icon ?? def.icon, 40));
    }
    tileDims.textContent = dims;
    tileExtra.textContent = extra;
    tileExtra.hidden = !extra;
    preview.classList.toggle('shape-art', shape !== 'box' && shape !== 'square');
  };

  const sections = new Map<ObjectGroup, HTMLElement>();
  const typeBtns: { el: HTMLElement; shape: BlockShape }[] = [];
  const render = () => {
    for (const b of typeBtns) { const on = b.shape === active; b.el.classList.toggle('on', on); b.el.setAttribute('aria-checked', String(on)); b.el.tabIndex = on ? 0 : -1; }
    const sec = sections.get(OBJECT_BY_SHAPE[active].group)!;
    if (editor.parentElement !== sec) sec.appendChild(editor);
    for (const [, s] of sections) s.classList.toggle('active', s === sec);
    renderParams();
    updateTile();
  };

  const out: HTMLElement[] = [];
  for (const g of OBJECT_GROUPS) {
    const defs = OBJECT_DEFS.filter(d => d.group === g.id);
    const title = t(g.labelKey as TKey);
    const btns = defs.map(def => {
      const label = objLabel(def.shape);
      const el = h('button', { type: 'button', class: 'obj-type', role: 'radio', 'aria-label': label, 'aria-checked': 'false' },
        icon(def.icon, 20), h('span', null, label));
      const tk = TYPE_TIPS[def.shape];
      if (tk) tip(el, t(tk));
      el.addEventListener('click', () => { if (active !== def.shape) { active = def.shape; render(); } });
      typeBtns.push({ el, shape: def.shape });
      return el;
    });
    // arrow keys move within the whole objects module (one radio group visually split in three)
    for (const el of btns) el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const i = typeBtns.findIndex(b => b.el === el);
      const j = (i + (ev.key === 'ArrowRight' ? 1 : -1) + typeBtns.length) % typeBtns.length;
      typeBtns[j].el.focus(); typeBtns[j].el.click();
    });
    const sec = h('section', { class: `panel-section obj-group obj-group-${g.id}` },
      h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, title.toLocaleUpperCase(locale))),
      h('div', { class: 'obj-types', role: 'radiogroup', 'aria-label': t('obj.typeAria', { group: title }), style: `--n:${Math.max(defs.length, 3)}` }, btns));
    sections.set(g.id, sec);
    out.push(sec);
  }
  render();
  return out;
}
