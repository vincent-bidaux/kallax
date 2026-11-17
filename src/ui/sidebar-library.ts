// Library: KALLAX catalogue tiles (to-scale front elevations) + free block builder.
import { CATALOG, KALLAX, fmtCm, kallaxOuter, type CatalogEntry } from '../core/kallax';
import { store, uid } from '../core/store';
import type { BlockItem, Item, KallaxItem } from '../core/types';
import { h, svg } from './dom';
import { numberField, segmented, textField, tip } from './controls';
import { icon } from './icons';
import { beginLibraryDrag } from '../interaction/drag-drop';
import { freeSpot } from '../interaction/placement';
import { ui } from '../interaction/context';

/** Same px/cm for every tile: a 5×5 (181,5 cm) fills the 58 px drawing box. */
const TILE_BOX = 58;
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
  store.addItem(it);
  ui.viewport.zoomToFit(true);
}

export function buildLibrary(host: HTMLElement) {
  // ── KALLAX ──
  let filter: 'all' | 'ikea' = 'all';
  const grid = h('div', { class: 'lib-grid', role: 'list', 'aria-label': 'Formats KALLAX' });
  const tiles: { el: HTMLElement; entry: CatalogEntry }[] = [];
  for (const e of CATALOG) {
    const dims = `${fmtCm(e.exact.w)} × ${fmtCm(e.exact.d)} × ${fmtCm(e.exact.h)} cm`;
    const el = h('div', {
      class: `lib-tile ${e.official ? 'official' : 'custom'}`, role: 'listitem button', tabindex: '0',
      'aria-label': `Kallax ${e.label}, ${e.nominal}${e.official ? ', format IKEA' : ', sur mesure'}. Glisser dans la vue ou Entrée pour ajouter.`,
    },
      h('div', { class: 'tile-art' }, kallaxElevationSVG(e.cols, e.rows)),
      h('div', { class: 'tile-label' }, e.label,
        e.official ? h('span', { class: 'badge-ikea', 'aria-hidden': 'true' }, 'IKEA') : null),
      h('div', { class: 'tile-sub' }, e.nominal.replace(' cm', '')),
    );
    tip(el, e.official
      ? `KALLAX ${e.label} · format vendu par IKEA — ${dims}`
      : `Sur mesure · combinaison non vendue d’un seul tenant — ${dims}`);
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
    ariaLabel: 'Filtrer les formats', size: 'sm', value: filter,
    options: [{ value: 'all', label: 'Tous' }, { value: 'ikea', label: 'IKEA', tip: 'Formats vendus par IKEA' }],
    onChange: v => { filter = v; for (const t of tiles) t.el.hidden = v === 'ikea' && !t.entry.official; },
    cls: 'lib-filter',
  });
  const kallaxSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'KALLAX'), filterSeg.el),
    grid,
    h('p', { class: 'hint' }, icon('cursor', 12), 'Glissez un format dans la vue, ou cliquez pour l’ajouter.'));

  // ── BLOC LIBRE ──
  const draft = { w: 80, d: 10, h: 60, name: 'Radiateur' };
  const preview = h('div', { class: 'tile-art block-art' });
  const previewDims = h('div', { class: 'tile-sub' });
  const blockTile = h('div', {
    class: 'lib-tile block-tile', role: 'button', tabindex: '0',
    'aria-label': 'Bloc personnalisé : glisser dans la vue ou Entrée pour ajouter',
  }, preview, h('div', { class: 'block-tile-text' }, h('div', { class: 'tile-label' }, 'Bloc personnalisé'), previewDims),
    h('span', { class: 'block-grip', 'aria-hidden': 'true' }, icon('grip', 16)));
  tip(blockTile, 'Glissez le bloc dans la vue');
  const makeBlock = (): BlockItem => ({
    id: uid(), kind: 'block', name: draft.name || 'Bloc', size: { w: draft.w, d: draft.d, h: draft.h },
    position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId: store.doc.activeLayerId,
  });
  blockTile.addEventListener('pointerdown', (ev) => beginLibraryDrag(ev, blockTile, makeBlock, draft.name || 'Bloc'));
  blockTile.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); insertAtFreeSpot(makeBlock()); }
  });

  const refresh = () => {
    preview.replaceChildren(boxIsoSVG(draft.w, draft.d, draft.h));
    previewDims.textContent = `${fmtCm(draft.w)} × ${fmtCm(draft.d)} × ${fmtCm(draft.h)} cm`;
    fw.set(draft.w); fd.set(draft.d); fh.set(draft.h); fname.set(draft.name);
    chips.forEach(c => c.el.classList.toggle('on', c.p.name === draft.name && c.p.w === draft.w && c.p.d === draft.d && c.p.h === draft.h));
  };
  const fw = numberField({ label: 'L', ariaLabel: 'Largeur (cm)', value: draft.w, step: 1, min: 0.5, max: 2000, suffix: 'cm', onCommit: v => { draft.w = v; refresh(); } });
  const fd = numberField({ label: 'P', ariaLabel: 'Profondeur (cm)', value: draft.d, step: 1, min: 0.5, max: 2000, suffix: 'cm', onCommit: v => { draft.d = v; refresh(); } });
  const fh = numberField({ label: 'H', ariaLabel: 'Hauteur (cm)', value: draft.h, step: 1, min: 0.5, max: 2000, suffix: 'cm', onCommit: v => { draft.h = v; refresh(); } });
  tip(fw.el, 'Largeur (X)'); tip(fd.el, 'Profondeur (Y)'); tip(fh.el, 'Hauteur (Z)');
  const fname = textField({ label: 'Nom', value: draft.name, placeholder: 'Bloc', onCommit: v => { draft.name = v; refresh(); } });

  const PRESETS = [
    { name: 'Radiateur', w: 80, d: 10, h: 60 },
    { name: 'Plinthe', w: 200, d: 1.5, h: 8 },
    { name: 'Prise', w: 8, d: 4, h: 8 },
    { name: 'Allège', w: 120, d: 20, h: 90 },
    { name: 'Porte', w: 83, d: 4, h: 204 },
    { name: 'Lit 140', w: 140, d: 190, h: 45 },
  ];
  const chips = PRESETS.map(p => {
    const el = h('button', { type: 'button', class: 'chip' }, p.name);
    tip(el, `${p.name} · ${fmtCm(p.w)} × ${fmtCm(p.d)} × ${fmtCm(p.h)} cm`);
    el.addEventListener('click', () => { Object.assign(draft, p); refresh(); });
    return { el, p };
  });

  const blockSec = h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'BLOC LIBRE')),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Préréglages' }, chips.map(c => c.el)),
    h('div', { class: 'fields-3' }, fw.el, fd.el, fh.el),
    fname.el,
    blockTile,
  );

  host.append(kallaxSec, blockSec);
  refresh();
}
