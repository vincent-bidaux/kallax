// Sidebar "Composants" tab: reusable sets of items (cross-project).
// Cards: thumbnail, name, size, item count, price. Drag a card into the 3D view
// to insert it as a new group (ghost + magnet + collisions); click / Enter
// inserts it at a free spot. "…" / right-click: rename, update, delete.
import { store } from '../core/store';
import { fmtCm } from '../core/kallax';
import { fmtEur } from '../core/finishes';
import { componentProxy, instantiate, type Component } from '../core/components';
import { t, tn } from '../core/i18n';
import { h, MOD } from './dom';
import { icon } from './icons';
import { button, tip } from './controls';
import { Popover, fillMenu } from './popover';
import { beginMultiDrag } from '../interaction/drag-drop';
import { ui } from '../interaction/context';
import { currentUser, onAccountChange } from './account';
import {
  onComponentsChange, componentsState, refreshComponents, insertComponent, addSelectionToComponents,
  renameComponent, deleteComponent, updateComponentFromSelection, componentPrice,
} from './components';

const dims = (c: Component) => `${fmtCm(c.data.size.w)} × ${fmtCm(c.data.size.d)} × ${fmtCm(c.data.size.h)} cm`;
const dimsShort = (c: Component) => `${fmtCm(c.data.size.w)}×${fmtCm(c.data.size.d)}×${fmtCm(c.data.size.h)} cm`;

export function buildComponents(host: HTMLElement) {
  const addBtn = button({ icon: 'plus', label: t('comp.addSelection'), iconOnly: true, cls: 'mini-btn', iconSize: 15, onClick: () => { void addSelectionToComponents(); } });
  const where = h('span', { class: 'comp-where' });
  const search = h('input', { type: 'search', class: 'comp-search', placeholder: t('comp.search'), 'aria-label': t('comp.searchAria'), spellcheck: 'false' });
  const grid = h('div', { class: 'comp-grid', role: 'list', 'aria-label': t('comp.listAria') });
  const hint = h('p', { class: 'hint' }, icon('cursor', 12), t('comp.hint'));
  host.append(h('section', { class: 'panel-section' },
    h('div', { class: 'section-head' },
      h('h3', { class: 'section-title' }, t('comp.title')), h('div', { class: 'comp-head-r' }, where, addBtn)),
    search, grid, hint));
  search.addEventListener('input', () => render());
  search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; render(); search.blur(); } });

  // shared "…" menu
  const menuAnchor = h('span', { class: 'comp-menu-anchor', 'aria-hidden': 'true' });
  document.body.appendChild(menuAnchor);
  const menu = new Popover(menuAnchor, { role: 'menu', cls: 'menu-pop', width: 248, align: 'start', manual: true });
  let renamingId: string | null = null;

  function openMenu(c: Component, at: HTMLElement | { x: number; y: number }) {
    const r = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, top: at.y - 6, width: 0, height: 0, bottom: at.y, right: at.x };
    Object.assign(menuAnchor.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.bottom - r.top}px`, pointerEvents: 'none' });
    menu.body.replaceChildren();
    const hasSel = store.selection.length > 0;
    fillMenu(menu, [
      { label: t('comp.insert'), icon: 'plus', kbd: '↩', action: () => doInsert(c) },
      { label: t('common.rename'), icon: 'pencil', action: () => startRename(c.id), separatorBefore: true },
      ...(hasSel ? [{ label: t('comp.updateFromSel'), icon: 'refresh', action: () => { void updateComponentFromSelection(c.id); } }] : []),
      { label: t('common.delete'), icon: 'trash', destructive: true, action: () => { void deleteComponent(c.id); }, separatorBefore: true },
    ]);
    menu.open();
  }

  function doInsert(c: Component) {
    insertComponent(c);
    ui.viewport.zoomToFit(true);
  }

  function startRename(id: string) {
    renamingId = id;
    render();
    const input = grid.querySelector<HTMLInputElement>(`.comp-card[data-id="${CSS.escape(id)}"] .comp-name-input`);
    input?.focus(); input?.select();
  }

  function card(c: Component): HTMLElement {
    const n = c.data.items.length;
    const price = componentPrice(c);
    const priceTxt = price.priced ? fmtEur(price.total) : '';
    const thumb = h('div', { class: 'comp-thumb' }, c.thumb ? h('img', { src: c.thumb, alt: '', draggable: 'false' }) : icon('component', 28));
    const more = h('button', { type: 'button', class: 'comp-more', 'aria-label': t('comp.moreAria', { name: c.name }), tabindex: '-1' }, icon('more', 14));
    tip(more, t('comp.moreTip'));
    let nameEl: HTMLElement;
    if (renamingId === c.id) {
      const input = h('input', { type: 'text', class: 'comp-name-input', value: c.name, spellcheck: 'false', 'aria-label': t('comp.nameAria') });
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return; done = true;
        renamingId = null;
        const v = input.value.trim();
        if (ok && v && v !== c.name) void renameComponent(c.id, v);
        render();
        grid.querySelector<HTMLElement>(`.comp-card[data-id="${CSS.escape(c.id)}"]`)?.focus();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('pointerdown', e => e.stopPropagation());
      nameEl = input;
    } else nameEl = h('div', { class: 'comp-name' }, c.name);
    const el = h('div', {
      class: 'comp-card lib-tile', role: 'listitem button', tabindex: '0', dataset: { id: c.id },
      'aria-label': t('comp.cardAria', { name: c.name, count: tn('comp.items', n), dims: dims(c), price: priceTxt || t('insp.unpriced') }),
    },
      thumb, more,
      h('div', { class: 'comp-info' }, nameEl,
        h('div', { class: 'comp-sub' }, tn('comp.items', n), priceTxt ? h('span', { class: 'comp-price' }, priceTxt) : null),
        h('div', { class: 'comp-dims' }, dimsShort(c))),
    );
    tip(el, t('comp.cardTip', { name: c.name, dims: dims(c) }));
    more.addEventListener('pointerdown', (e) => e.stopPropagation());
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(c, more); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(c, { x: e.clientX, y: e.clientY }); });
    if (renamingId !== c.id) {
      el.addEventListener('pointerdown', (ev) => {
        if ((ev.target as HTMLElement).closest('.comp-more')) return;
        const layer = store.doc.activeLayerId;
        beginMultiDrag(ev, el, {
          label: c.name,
          proxy: () => componentProxy(c.data, layer),
          expand: (pos) => instantiate(c.data, pos, layer, null, (() => { let i = 0; return () => `__ghost_${i++}`; })()),
          drop: (pos) => { insertComponent(c, pos); },
          click: () => doInsert(c),
        });
      });
      el.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.comp-name')) { e.preventDefault(); startRename(c.id); }
      });
    }
    el.addEventListener('keydown', (ev) => {
      if (ev.target !== el) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); doInsert(c); }
      else if (ev.key === 'F2') { ev.preventDefault(); startRename(c.id); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); void deleteComponent(c.id); }
      else if (ev.key.startsWith('Arrow')) {
        ev.preventDefault(); ev.stopPropagation();
        const cards = [...grid.querySelectorAll<HTMLElement>('.comp-card')];
        const i = cards.indexOf(el);
        const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowDown' ? 2 : -2;
        cards[Math.max(0, Math.min(cards.length - 1, i + d))]?.focus();
      }
    });
    return el;
  }

  function render() {
    const st = componentsState();
    const u = currentUser();
    where.replaceChildren(icon(u ? 'cloud' : 'laptop', 12), h('span', null, u ? t('prj.whereAccountShort') : t('comp.whereLocalShort')));
    tip(where, u ? t('comp.whereAccount') : t('comp.whereLocal'));
    where.classList.toggle('account', !!u);
    addBtn.disabled = !store.selection.length;
    tip(addBtn, store.selection.length ? t('comp.addSelection') : t('comp.addSelectionDisabled'));
    grid.replaceChildren();
    const list = st.list;
    search.hidden = !list || list.length < 7;
    if (!list) {
      grid.append(st.failed
        ? h('div', { class: 'comp-empty' }, icon('warning', 24), h('strong', null, t('comp.loadFailed')),
          (() => { const b = h('button', { type: 'button', class: 'proj-ghost' }, t('acct.retry')); b.addEventListener('click', () => { void refreshComponents(); }); return b; })())
        : h('div', { class: 'comp-empty' }, h('span', { class: 'spinner lg', 'aria-hidden': 'true' }), h('span', null, t('comp.loading'))));
      hint.hidden = true;
      return;
    }
    if (!list.length) {
      grid.append(h('div', { class: 'comp-empty' },
        h('div', { class: 'comp-empty-icon' }, icon('component', 26)),
        h('strong', null, t('comp.emptyTitle')),
        h('span', null, t('comp.emptySub')),
        h('ol', { class: 'comp-steps' },
          h('li', null, t('comp.emptyStep1', { mod: MOD })),
          h('li', null, t('comp.emptyStep2')),
          h('li', null, t('comp.emptyStep3')))));
      hint.hidden = true;
      return;
    }
    const q = search.value.trim().toLocaleLowerCase();
    const shown = q ? list.filter(c => c.name.toLocaleLowerCase().includes(q)) : list;
    if (!shown.length) grid.append(h('div', { class: 'comp-empty small' }, h('span', null, t('comp.noMatch', { q: search.value.trim() }))));
    for (const c of shown) grid.append(card(c));
    hint.hidden = false;
  }

  onComponentsChange(() => { if (!renamingId) render(); });
  onAccountChange(() => render());
  // prices follow the document's finishes; the "+" button follows the selection
  const finishKey = () => `${store.doc.finish}|${store.doc.basket}|${store.doc.eketFinish}`;
  let fk = finishKey();
  store.on(ev => {
    if (ev === 'selection') {
      addBtn.disabled = !store.selection.length;
      tip(addBtn, store.selection.length ? t('comp.addSelection') : t('comp.addSelectionDisabled'));
    } else if (ev === 'doc' && finishKey() !== fk) {
      fk = finishKey();
      if (!renamingId && !document.body.classList.contains('dragging')) render();
    }
  });
  render();
}
