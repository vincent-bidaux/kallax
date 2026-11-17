// Library: KALLAX catalogue tiles (to-scale front elevations) + free block builder.
import { CATALOG, IKEA_LINKS, INSERTS, KALLAX, WINDOW_SILL, fmtCm, kallaxOuter, cylinderSize, type CatalogEntry } from '../core/kallax';
import type { InsertType } from '../core/types';
import type { InsertTool } from '../interaction/context';
import { store, uid } from '../core/store';
import type { BlockItem, Item, KallaxItem } from '../core/types';
import { h, svg } from './dom';
import { numberField, segmented, textField, tip } from './controls';
import { icon } from './icons';
import { INSERT_NAMES, fmtEur, fmtEurShort, frameMinPrice, insertMinPrice } from '../core/finishes';
import { t } from '../core/i18n';
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
  if (it.kind === 'block' && it.shape === 'window') it.position = { ...it.position, z: it.position.z + WINDOW_SILL };
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

  // ── OBJETS (bloc, poutres, mur, fenêtre) ──
  type ObjType = 'box' | 'round' | 'square' | 'wall' | 'window';
  const TYPES: { id: ObjType; label: string; icon: string; tip: string }[] = [
    { id: 'box', label: t('obj.box'), icon: 'box', tip: t('obj.boxTip') },
    { id: 'round', label: t('obj.round'), icon: 'cylinder', tip: t('obj.roundTip') },
    { id: 'square', label: t('obj.square'), icon: 'beamSquare', tip: t('obj.squareTip') },
    { id: 'wall', label: t('obj.wall'), icon: 'wall', tip: t('obj.wallTip') },
    { id: 'window', label: t('obj.window'), icon: 'window', tip: t('obj.windowTip') },
  ];
  const draft = {
    type: 'box' as ObjType,
    box: { w: 80, d: 10, h: 60, name: t('preset.radiator') },
    round: { diameter: 12, length: 200, axis: 'x' as 'x' | 'z', name: t('obj.beam') },
    square: { side: 10, length: 200, axis: 'x' as 'x' | 'z', name: t('obj.square') },
    wall: { w: 300, h: 250, name: t('obj.wall') },
    window: { w: 120, h: 135, d: 7, name: t('obj.window') },
  };

  const typeBtns = TYPES.map(ty => {
    const el = h('button', { type: 'button', class: 'obj-type', role: 'radio', 'aria-label': ty.label },
      icon(ty.icon, 20), h('span', null, ty.label));
    tip(el, ty.tip);
    el.addEventListener('click', () => { draft.type = ty.id; render(); });
    return { el, t: ty };
  });
  const typeGrid = h('div', { class: 'obj-types', role: 'radiogroup', 'aria-label': t('obj.typeAria') }, typeBtns.map(b => b.el));
  const params = h('div', { class: 'obj-params' });
  const preview = h('div', { class: 'tile-art block-art' });
  const tileLabel = h('div', { class: 'tile-label' });
  const tileDims = h('div', { class: 'tile-sub' });
  const objTile = h('div', {
    class: 'lib-tile block-tile', role: 'button', tabindex: '0',
    'aria-label': t('obj.tileAria'),
  }, preview, h('div', { class: 'block-tile-text' }, tileLabel, tileDims),
    h('span', { class: 'block-grip', 'aria-hidden': 'true' }, icon('grip', 16)));
  tip(objTile, t('obj.tileTip'));

  const makeObject = (): BlockItem => {
    const base = { id: uid(), kind: 'block' as const, position: { x: 0, y: 0, z: 0 }, rotation: 0 as const, layerId: store.doc.activeLayerId };
    switch (draft.type) {
      case 'round': { const o = draft.round; return { ...base, shape: 'cylinder', axis: o.axis, name: o.name || t('obj.beam'), size: cylinderSize(o.diameter, o.length, o.axis) }; }
      case 'square': { const o = draft.square; return { ...base, shape: 'square', axis: o.axis, name: o.name || t('obj.square'), size: cylinderSize(o.side, o.length, o.axis) }; }
      case 'wall': { const o = draft.wall; return { ...base, shape: 'wall', name: o.name || t('obj.wall'), size: { w: o.w, d: 0, h: o.h } }; }
      case 'window': { const o = draft.window; return { ...base, shape: 'window', name: o.name || t('obj.window'), size: { w: o.w, d: o.d, h: o.h } }; }
      default: { const o = draft.box; return { ...base, name: o.name || t('obj.box'), size: { w: o.w, d: o.d, h: o.h } }; }
    }
  };
  objTile.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, objTile, makeObject, makeObject().name));
  objTile.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); insertAtFreeSpot(makeObject()); }
  });

  const num = (label: string, aria: string, value: number, onCommit: (v: number) => void, o: { step?: number; min?: number; max?: number; axis?: 'x' | 'y' | 'z' } = {}) =>
    numberField({ label, ariaLabel: aria, value, step: o.step ?? 1, min: o.min ?? 0.5, max: o.max ?? 5000, suffix: 'cm', axis: o.axis, onCommit: v => { onCommit(v); updateTile(); } }).el;
  const nameF = (obj: { name: string }, ph: string) =>
    textField({ label: t('common.name'), value: obj.name, placeholder: ph, onCommit: v => { obj.name = v; updateTile(); } }).el;
  const axisSeg = (obj: { axis: 'x' | 'z' }) => segmented<'x' | 'z'>({
    ariaLabel: t('obj.orientation'), size: 'sm', value: obj.axis,
    options: [{ value: 'x', label: t('obj.horizontal') }, { value: 'z', label: t('obj.vertical') }],
    onChange: v => { obj.axis = v; updateTile(); },
  }).el;

  const BOX_PRESETS = [
    { name: t('preset.radiator'), w: 80, d: 10, h: 60 },
    { name: t('preset.skirting'), w: 200, d: 1.5, h: 8 },
    { name: t('preset.socket'), w: 8, d: 4, h: 8 },
    { name: t('preset.sill'), w: 120, d: 20, h: 90 },
    { name: t('preset.door'), w: 83, d: 4, h: 204 },
    { name: t('preset.bed'), w: 140, d: 190, h: 45 },
  ];
  const WINDOW_PRESETS = [
    { name: '60 × 75', w: 60, h: 75 }, { name: '80 × 115', w: 80, h: 115 },
    { name: '100 × 125', w: 100, h: 125 }, { name: '120 × 135', w: 120, h: 135 },
    { name: FRENCH_WINDOW, w: 120, h: 215 },
  ];

  const renderParams = () => {
    const ty = draft.type;
    const nodes: Node[] = [];
    if (ty === 'box') {
      const o = draft.box;
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': t('obj.presetsAria') }, BOX_PRESETS.map(p => {
        const el = h('button', { type: 'button', class: `chip${p.name === o.name && p.w === o.w && p.d === o.d && p.h === o.h ? ' on' : ''}` }, p.name);
        tip(el, `${p.name} · ${fmtCm(p.w)} × ${fmtCm(p.d)} × ${fmtCm(p.h)} cm`);
        el.addEventListener('click', () => { Object.assign(o, p); render(); });
        return el;
      })));
      nodes.push(h('div', { class: 'fields-3' },
        num(t('dim.w'), t('aria.width'), o.w, v => o.w = v, { axis: 'x' }),
        num(t('dim.d'), t('aria.depth'), o.d, v => o.d = v, { axis: 'y' }),
        num(t('dim.h'), t('aria.height'), o.h, v => o.h = v, { axis: 'z' })));
      nodes.push(nameF(o, t('obj.box')));
    } else if (ty === 'round') {
      const o = draft.round;
      nodes.push(h('div', { class: 'fields-2' },
        num('Ø', t('aria.diameter'), o.diameter, v => o.diameter = v, { step: 0.5 }),
        num(t('dim.len'), t('aria.length'), o.length, v => o.length = v)));
      nodes.push(axisSeg(o), nameF(o, t('obj.beam')));
    } else if (ty === 'square') {
      const o = draft.square;
      nodes.push(h('div', { class: 'fields-2' },
        num('□', t('aria.sectionSide'), o.side, v => o.side = v, { step: 0.5 }),
        num(t('dim.len'), t('aria.length'), o.length, v => o.length = v)));
      nodes.push(axisSeg(o), nameF(o, t('obj.square')));
    } else if (ty === 'wall') {
      const o = draft.wall;
      nodes.push(h('div', { class: 'fields-2' },
        num(t('dim.w'), t('aria.wallWidth'), o.w, v => o.w = v, { min: 1, axis: 'x' }),
        num(t('dim.h'), t('aria.wallHeight'), o.h, v => o.h = v, { min: 1, axis: 'z' })));
      nodes.push(nameF(o, t('obj.wall')));
    } else {
      const o = draft.window;
      nodes.push(h('div', { class: 'chips', role: 'group', 'aria-label': t('obj.windowSizesAria') }, WINDOW_PRESETS.map(p => {
        const el = h('button', { type: 'button', class: `chip${p.w === o.w && p.h === o.h ? ' on' : ''}` }, p.name);
        tip(el, `${fmtCm(p.w)} × ${fmtCm(p.h)} cm`);
        el.addEventListener('click', () => { o.w = p.w; o.h = p.h; if (p.name === FRENCH_WINDOW) o.name = FRENCH_WINDOW; else if (o.name === FRENCH_WINDOW) o.name = t('obj.window'); render(); });
        return el;
      })));
      nodes.push(h('div', { class: 'fields-3' },
        num(t('dim.w'), t('aria.width'), o.w, v => o.w = v, { min: 20, axis: 'x' }),
        num(t('dim.d'), t('aria.frameDepth'), o.d, v => o.d = v, { min: 2, axis: 'y' }),
        num(t('dim.h'), t('aria.height'), o.h, v => o.h = v, { min: 20, axis: 'z' })));
      nodes.push(nameF(o, t('obj.window')));
    }
    params.replaceChildren(...nodes);
  };

  const updateTile = () => {
    const ty = draft.type;
    const meta = TYPES.find(x => x.id === ty)!;
    tileLabel.textContent = meta.label;
    let dims = '';
    if (ty === 'box') { const o = draft.box; dims = `${fmtCm(o.w)} × ${fmtCm(o.d)} × ${fmtCm(o.h)} cm`; preview.replaceChildren(boxIsoSVG(o.w, o.d, o.h)); }
    else if (ty === 'round') { const o = draft.round; dims = `Ø ${fmtCm(o.diameter)} × ${fmtCm(o.length)} cm · ${o.axis === 'x' ? t('obj.horizShort') : t('obj.vertShort')}`; preview.replaceChildren(icon('cylinder', 40)); }
    else if (ty === 'square') { const o = draft.square; dims = `□ ${fmtCm(o.side)} × ${fmtCm(o.length)} cm · ${o.axis === 'x' ? t('obj.horizShort') : t('obj.vertShort')}`; const s = cylinderSize(o.side, o.length, o.axis); preview.replaceChildren(boxIsoSVG(s.w, s.d, s.h)); }
    else if (ty === 'wall') { const o = draft.wall; dims = `${fmtCm(o.w)} × ${fmtCm(o.h)} cm`; preview.replaceChildren(icon('wall', 40)); }
    else { const o = draft.window; dims = `${fmtCm(o.w)} × ${fmtCm(o.h)} cm · ${t('obj.sill')}`; preview.replaceChildren(icon('window', 40)); }
    tileDims.textContent = dims;
    preview.classList.toggle('shape-art', ty !== 'box' && ty !== 'square');
  };

  const render = () => {
    for (const b of typeBtns) { b.el.classList.toggle('on', b.t.id === draft.type); b.el.setAttribute('aria-checked', String(b.t.id === draft.type)); }
    renderParams();
    updateTile();
  };

  const blockSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.objectsTitle'))),
    typeGrid,
    params,
    objTile,
  );

  const refSec = h('section', { class: 'panel-section lib-refs' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.refsTitle'))),
    h('ul', { class: 'ref-list' }, IKEA_LINKS.map(l =>
      h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'ref-link' },
        icon('arrowUpRight', 13), h('span', null, l.label))))),
    h('p', { class: 'ref-note' },
      t('lib.refNote', { legs: fmtCm(KALLAX.legs) })),
  );
  host.append(kallaxSec, insertSec, blockSec, refSec);
  render();
}
