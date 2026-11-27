// Library: KALLAX catalogue tiles (to-scale front elevations) + free block builder.
import { CATALOG, IKEA_LINKS, INSERTS, KALLAX, fmtCm, kallaxOuter, cylinderSize, type CatalogEntry } from '../core/kallax';
import type { InsertType } from '../core/types';
import type { InsertTool } from '../interaction/context';
import { store, uid } from '../core/store';
import type { BlockItem, BlockShape, EketItem, Item, KallaxItem } from '../core/types';
import { EKET, EKET_LINKS, EKET_VARIANTS, eketDef, eketDims, eketDisplayName, eketMinPrice, type EketVariant } from '../core/eket';
import { h, svg } from './dom';
import { numberField, segmented, switchRow, tip } from './controls';
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

type LibTab = 'kallax' | 'eket';
const LS_LIB_TAB = 'kallax-designer:lib-tab';

/** EKET tiles: their own scale (a 35 cm cube would be a dot at the KALLAX tile scale); a 70 × 70 fills the drawing box. */
const EKET_SCALE = TILE_BOX / 70;

/** Front elevation of an EKET version, to scale (same scale for every EKET tile). */
export function eketElevationSVG(v: EketVariant, k = EKET_SCALE): SVGSVGElement {
  const d = eketDef(v);
  const W = d.w * k, H = d.h * k, p = Math.max(1.3, EKET.panel * k), g = 0.8;
  const f = (n: number) => n.toFixed(2);
  const i0x = p, i1x = W - p, i0y = p, i1y = H - p;
  const xm = W / 2, ym = H / 2;
  const rect = (cls: string, x0: number, y0: number, x1: number, y1: number, rx = 0.4) =>
    `<rect class="${cls}" x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" rx="${rx}"/>`;
  let body = rect('elev-cell', i0x, i0y, i1x, i1y, 0);
  let holes = `M${f(i0x)} ${f(i0y)}h${f(i1x - i0x)}v${f(i1y - i0y)}h${f(i0x - i1x)}z`;
  const fronts: [number, number, number, number][] = [];
  const twoDrawers = () => { fronts.push([i0x + g, i0y + g, i1x - g, ym - g / 2], [i0x + g, ym + g / 2, i1x - g, i1y - g]); };
  switch (v) {
    case 'four': {
      const dv = p;
      body = '';
      holes = '';
      for (const [a, b, c, e] of [[i0x, i0y, xm - dv / 2, ym - dv / 2], [xm + dv / 2, i0y, i1x, ym - dv / 2],
        [i0x, ym + dv / 2, xm - dv / 2, i1y], [xm + dv / 2, ym + dv / 2, i1x, i1y]]) {
        body += rect('elev-cell', a, b, c, e, 0);
        holes += `M${f(a)} ${f(b)}h${f(c - a)}v${f(e - b)}h${f(a - c)}z`;
      }
      break;
    }
    case 'door': case 'door-shelf': fronts.push([i0x + g, i0y + g, i1x - g, i1y - g]); break;
    case 'doors-shelf': fronts.push([i0x + g, i0y + g, xm - g / 2, i1y - g], [xm + g / 2, i0y + g, i1x - g, i1y - g]); break;
    case 'drawers': case 'drawers-70': case 'wall-drawers': twoDrawers(); break;
    case 'media': {
      const yf = i1y - 10.5 * k;
      fronts.push([i0x + g, yf + g, i1x - g, i1y - g]);
      body += `<path class="elev-detail" d="M${f(i0x)} ${f(yf)}H${f(i1x)}"/><circle class="elev-detail" cx="${f(xm)}" cy="${f((i0y + yf) / 2 - 3 * k)}" r="${f(3 * k)}"/>`;
      break;
    }
    case 'glass': {
      const a = i0x + g, b = i0y + g, w = i1x - i0x - 2 * g, c = a + w * 0.3, e = b + w * 0.4;
      body += rect('elev-glass', a, b, a + w, b + w) +
        `<path class="elev-detail" d="M${f(c)} ${f(e + w * 0.18)}l${f(w * 0.18)} ${f(-w * 0.18)}M${f(c + w * 0.08)} ${f(e + w * 0.3)}l${f(w * 0.22)} ${f(-w * 0.22)}"/>` +
        `<path class="elev-hinge" d="M${f(a)} ${f(i0y + 0.4)}h1.8M${f(a)} ${f(i1y - 0.4)}h1.8"/>`;
      break;
    }
  }
  for (const [a, b, c, e] of fronts) body += rect('elev-front', a, b, c, e);
  const pad = 1;
  return svg(`<svg class="elev elev-eket" width="${f(W + pad * 2)}" height="${f(H + pad * 2)}" viewBox="${-pad} ${-pad} ${f(W + pad * 2)} ${f(H + pad * 2)}" aria-hidden="true">
    ${body}
    <path class="elev-frame" fill-rule="evenodd" d="M0 0h${f(W)}v${f(H)}h${f(-W)}z${holes}"/>
    <rect class="elev-outline" x="0" y="0" width="${f(W)}" height="${f(H)}" rx=".8"/>
  </svg>`);
}

function makeEket(v: EketVariant): EketItem {
  return {
    id: uid(), kind: 'eket', name: eketDisplayName(v), variant: v,
    position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId: store.doc.activeLayerId,
  };
}

/** Arrow-key navigation inside a tile grid (`cols` tiles per row). */
function gridKeys(el: HTMLElement, list: () => HTMLElement[], cols: number, onEnter: () => void) {
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onEnter(); }
    if (ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const vis = list();
      const i = vis.indexOf(el);
      const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowDown' ? cols : -cols;
      vis[Math.max(0, Math.min(vis.length - 1, i + d))]?.focus();
    }
  });
}

export function buildLibrary(host: HTMLElement) {
  // ── KALLAX: the formats IKEA sells (both orientations, except 3×1) ──
  const grid = h('div', { class: 'lib-grid', role: 'list', 'aria-label': t('lib.sizesAria') });
  const tiles: HTMLElement[] = [];
  for (const e of CATALOG) {
    const dims = `${fmtCm(e.exact.w)} × ${fmtCm(e.exact.d)} × ${fmtCm(e.exact.h)} cm`;
    const min = frameMinPrice(e.cols, e.rows)!;
    const price = t('common.from', { price: fmtEur(min) });
    const el = h('div', {
      class: 'lib-tile', role: 'listitem button', tabindex: '0',
      'aria-label': t('lib.tileAriaIkea', { label: e.label, nominal: e.nominal, price }),
    },
      h('div', { class: 'tile-art' }, kallaxElevationSVG(e.cols, e.rows)),
      h('div', { class: 'tile-label' }, e.label),
      h('div', { class: 'tile-sub' }, e.nominal.replace(' cm', '')),
      h('div', { class: 'tile-price', 'aria-hidden': 'true' }, h('span', { class: 'tp-from' }, t('common.fromPrefix')), fmtEur(min)),
    );
    tip(el, `KALLAX ${e.label} · ${dims} — ${price}`);
    el.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, el, () => makeKallax(e), `Kallax ${e.label}`));
    gridKeys(el, () => tiles, 3, () => insertAtFreeSpot(makeKallax(e)));
    tiles.push(el);
    grid.appendChild(el);
  }

  // ── EKET: the 35 × 35 × 35 cm cube versions ──
  const eketGrid = h('div', { class: 'lib-grid eket-grid', role: 'list', 'aria-label': t('lib.eketAria') });
  const eketTiles: HTMLElement[] = [];
  for (const v of EKET_VARIANTS) {
    const name = eketDisplayName(v.id);
    const min = eketMinPrice(v.id);
    const price = t('common.from', { price: fmtEur(min) });
    const el = h('div', {
      class: 'lib-tile eket-tile', role: 'listitem button', tabindex: '0',
      'aria-label': t('lib.eketTileAria', { name, dims: eketDims(v.id).replace(/×/g, ' × '), price }),
    },
      h('div', { class: 'tile-art' }, eketElevationSVG(v.id)),
      h('div', { class: 'tile-label' }, v.label),
      h('div', { class: 'tile-sub' }, eketDims(v.id)),
      h('div', { class: 'tile-price', 'aria-hidden': 'true' }, h('span', { class: 'tp-from' }, t('common.fromPrefix')), fmtEur(min)),
    );
    tip(el, `${v.product} · ${eketDims(v.id).replace(/×/g, ' × ')} cm — ${price}${v.note ? ` · ${v.note}` : ''}`);
    el.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, el, () => makeEket(v.id), name));
    gridKeys(el, () => eketTiles, 3, () => insertAtFreeSpot(makeEket(v.id)));
    eketTiles.push(el);
    eketGrid.appendChild(el);
  }

  let tab: LibTab = (() => { try { return localStorage.getItem(LS_LIB_TAB) === 'eket' ? 'eket' : 'kallax'; } catch { return 'kallax'; } })();
  const tabsSeg = segmented<LibTab>({
    ariaLabel: t('lib.tabsAria'), size: 'sm', value: tab, cls: 'lib-tabs',
    options: [{ value: 'kallax', label: 'Kallax', tip: t('lib.tabKallaxTip') }, { value: 'eket', label: 'EKET', tip: t('lib.tabEketTip') }],
    onChange: v => showTab(v),
  });
  const kallaxHint = h('p', { class: 'hint' }, icon('cursor', 12), t('lib.kallaxHint'));
  const eketHint = h('p', { class: 'hint' }, icon('magnet', 12), t('lib.eketHint'));
  const furnSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.furnitureTitle')), tabsSeg.el),
    grid, eketGrid, kallaxHint, eketHint);

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

  const refList = (links: { label: string; url: string }[]) => h('ul', { class: 'ref-list' }, links.map(l =>
    h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'ref-link' },
      icon('arrowUpRight', 13), h('span', null, l.label)))));
  const kallaxRefs = h('div', null, refList(IKEA_LINKS), h('p', { class: 'ref-note' }, t('lib.refNote', { legs: fmtCm(KALLAX.legs) })));
  const eketRefs = h('div', null, refList(EKET_LINKS), h('p', { class: 'ref-note' }, t('lib.eketRefNote')));
  const refSec = h('section', { class: 'panel-section lib-refs' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('lib.refsTitle'))),
    kallaxRefs, eketRefs);

  function showTab(v: LibTab) {
    tab = v;
    const k = v === 'kallax';
    grid.hidden = !k; kallaxHint.hidden = !k; insertSec.hidden = !k; kallaxRefs.hidden = !k;
    eketGrid.hidden = k; eketHint.hidden = k; eketRefs.hidden = k;
    // the cell-fitting tool only applies to KALLAX
    if (!k && ui.insertTool) ui.setInsertTool(null);
    try { localStorage.setItem(LS_LIB_TAB, v); } catch { /* ignore */ }
  }
  host.append(furnSec, insertSec, ...objSecs, refSec);
  showTab(tab);
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
const LS_NEW_COLLIDE = 'kallax-designer:new-collide';

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
  // "Collisions" of the next objects (remembered): off = they may overlap anything
  let collideNew = (() => { try { return localStorage.getItem(LS_NEW_COLLIDE) !== '0'; } catch { return true; } })();
  const collideSw = switchRow({
    label: t('insp.collisions'), hint: t('insp.collisionsHint'), icon: 'collide', value: collideNew,
    onChange: v => { collideNew = v; try { localStorage.setItem(LS_NEW_COLLIDE, v ? '1' : '0'); } catch { /* ignore */ } updateTile(); },
  });
  collideSw.el.classList.add('lib-collide');
  const editor = h('div', { class: 'obj-editor' }, params, collideSw.el, objTile);

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
    if (!collideNew) it.collide = false;
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
    if (!collideNew) extra = [extra, t('obj.noCollisions')].filter(Boolean).join(' · ');
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
