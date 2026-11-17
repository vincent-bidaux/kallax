// Layers panel + outliner.
import { store, uid } from '../core/store';
import type { Item, Layer } from '../core/types';
import { fmtCm, worldSize } from '../core/kallax';
import { h, clear, toast } from './dom';
import { icon } from './icons';
import { shapeIcon } from './inspector';
import { button, tip } from './controls';

const expanded = new Set<string>();
let initialised = false;

function itemDims(it: Item) {
  const s = worldSize(it);
  return `${fmtCm(s.w)}×${fmtCm(s.d)}×${fmtCm(s.h)}`;
}

/** Inline rename: replaces `label` with an input until Enter / Escape / blur. */
function inlineRename(label: HTMLElement, current: string, commit: (v: string) => void, onEnd: () => void) {
  const input = h('input', { type: 'text', class: 'rename-input', value: current, 'aria-label': 'Renommer', spellcheck: 'false' });
  label.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return; done = true;
    const v = input.value.trim();
    input.replaceWith(label);
    if (ok && v && v !== current) commit(v);
    onEnd();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('pointerdown', e => e.stopPropagation());
}

export function buildLayers(host: HTMLElement) {
  let renaming = false;
  let dirty = false;
  let anchorId: string | null = null;

  const addBtn = button({ icon: 'plus', label: 'Nouveau calque', iconOnly: true, cls: 'mini-btn', iconSize: 15, onClick: addLayer });
  const list = h('div', { class: 'layers-list', role: 'tree', 'aria-label': 'Calques et objets', 'aria-multiselectable': 'true' });
  host.append(
    h('section', { class: 'panel-section' },
      h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, 'CALQUES'), addBtn),
      list,
      h('p', { class: 'hint' }, 'Double-clic pour renommer · le calque actif reçoit les nouveaux objets.')),
  );

  function addLayer() {
    const n = store.doc.layers.length + 1;
    const layer: Layer = { id: uid('layer'), name: `Calque ${n}`, visible: true, locked: false };
    store.update(d => { d.layers.push(layer); d.activeLayerId = layer.id; });
    expanded.add(layer.id);
  }

  function deleteLayer(id: string) {
    if (store.doc.layers.length <= 1) return;
    const target = store.doc.layers.find(l => l.id !== id)!;
    const n = store.items.filter(i => i.layerId === id).length;
    store.update(d => {
      d.layers = d.layers.filter(l => l.id !== id);
      for (const it of d.items) if (it.layerId === id) it.layerId = target.id;
      if (d.activeLayerId === id) d.activeLayerId = target.id;
    });
    if (n) toast(`${n} objet${n > 1 ? 's' : ''} déplacé${n > 1 ? 's' : ''} vers « ${target.name} »`);
  }

  function patchLayer(id: string, patch: Partial<Layer>) {
    store.update(d => { const l = d.layers.find(x => x.id === id); if (l) Object.assign(l, patch); });
  }

  function selectItem(e: MouseEvent, it: Item) {
    const ordered = store.items.map(i => i.id);
    if (e.shiftKey && anchorId && ordered.includes(anchorId)) {
      const a = ordered.indexOf(anchorId), b = ordered.indexOf(it.id);
      const range = ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
      store.select([...new Set([...store.selection, ...range])]);
    } else if (e.metaKey || e.ctrlKey) {
      store.toggleSelect(it.id);
      anchorId = it.id;
    } else {
      store.select([it.id]);
      anchorId = it.id;
    }
  }

  function render() {
    if (renaming) { dirty = true; return; }
    dirty = false;
    const focusedKey = (document.activeElement as HTMLElement)?.dataset?.key;
    clear(list);
    const doc = store.doc;
    if (!initialised) { doc.layers.forEach(l => expanded.add(l.id)); initialised = true; }
    const sel = new Set(store.selection);
    for (const layer of doc.layers) {
      const items = doc.items.filter(i => i.layerId === layer.id);
      const isActive = doc.activeLayerId === layer.id;
      const open = expanded.has(layer.id);
      const disclosure = h('button', { type: 'button', class: `disclosure ${open ? 'open' : ''}`, 'aria-label': open ? 'Replier' : 'Déplier', tabindex: '-1' }, icon('chevronRight', 12));
      disclosure.addEventListener('click', (e) => { e.stopPropagation(); open ? expanded.delete(layer.id) : expanded.add(layer.id); render(); });
      const name = h('span', { class: 'layer-name' }, layer.name);
      const count = h('span', { class: 'layer-count' }, String(items.length));
      const eye = h('button', { type: 'button', class: `row-toggle ${layer.visible ? '' : 'off'}`, 'aria-pressed': String(!layer.visible), 'aria-label': layer.visible ? 'Masquer le calque' : 'Afficher le calque' }, icon(layer.visible ? 'eye' : 'eyeSlash', 15));
      tip(eye, layer.visible ? 'Masquer' : 'Afficher');
      eye.addEventListener('click', (e) => { e.stopPropagation(); patchLayer(layer.id, { visible: !layer.visible }); });
      const lock = h('button', { type: 'button', class: `row-toggle ${layer.locked ? 'on' : ''}`, 'aria-pressed': String(layer.locked), 'aria-label': layer.locked ? 'Déverrouiller le calque' : 'Verrouiller le calque' }, icon(layer.locked ? 'lock' : 'lockOpen', 14));
      tip(lock, layer.locked ? 'Déverrouiller' : 'Verrouiller');
      lock.addEventListener('click', (e) => { e.stopPropagation(); patchLayer(layer.id, { locked: !layer.locked }); });
      const del = doc.layers.length > 1 ? h('button', { type: 'button', class: 'row-toggle del', 'aria-label': `Supprimer le calque ${layer.name}` }, icon('trash', 14)) : null;
      if (del) { tip(del, 'Supprimer le calque (objets déplacés)'); del.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer.id); }); }

      const row = h('div', {
        class: `layer-row ${isActive ? 'active' : ''} ${layer.visible ? '' : 'hidden-layer'}`,
        role: 'treeitem', tabindex: '0', 'aria-expanded': String(open), 'aria-selected': String(isActive),
        'aria-level': '1', dataset: { key: `l:${layer.id}` },
      }, disclosure, icon('layers', 15, 'layer-icon'), name,
        isActive ? h('span', { class: 'active-dot', role: 'img', 'aria-label': 'calque actif' }) : null, count,
        h('span', { class: 'row-actions' }, del, lock, eye));
      tip(row, isActive ? 'Calque actif — les nouveaux objets y sont ajoutés' : 'Cliquer pour rendre actif');
      row.addEventListener('click', () => { if (!isActive) store.update(d => { d.activeLayerId = layer.id; }); });
      row.addEventListener('dblclick', (e) => {
        e.preventDefault();
        renaming = true;
        inlineRename(name, layer.name, v => { renaming = false; patchLayer(layer.id, { name: v }); }, () => { renaming = false; if (dirty) render(); });
      });
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
        if (e.key === 'ArrowRight' && !open) { e.preventDefault(); expanded.add(layer.id); render(); }
        if (e.key === 'ArrowLeft' && open) { e.preventDefault(); expanded.delete(layer.id); render(); }
        if (e.key === 'F2') { e.preventDefault(); row.dispatchEvent(new MouseEvent('dblclick')); }
      });
      list.appendChild(row);

      if (!open) continue;
      if (!items.length) {
        list.appendChild(h('div', { class: 'item-row empty', 'aria-hidden': 'true' }, 'Aucun objet'));
        continue;
      }
      for (const it of items) {
        const nm = h('span', { class: 'item-name' }, it.name);
        const r = h('div', {
          class: `item-row ${sel.has(it.id) ? 'selected' : ''} ${store.hover === it.id ? 'hovered' : ''}`,
          role: 'treeitem', tabindex: '0', 'aria-level': '2', 'aria-selected': String(sel.has(it.id)),
          dataset: { id: it.id, key: `i:${it.id}` },
        },
          h('span', { class: 'item-glyph' }, it.kind === 'kallax' ? icon('grid', 13) : icon(shapeIcon(it.shape), 13)),
          nm,
          h('span', { class: 'item-dims' }, itemDims(it)),
          layer.locked ? h('span', { class: 'item-lock', 'aria-label': 'verrouillé' }, icon('lock', 11)) : null,
        );
        r.addEventListener('click', (e) => selectItem(e, it));
        r.addEventListener('pointerenter', () => store.setHover(it.id));
        r.addEventListener('pointerleave', () => { if (store.hover === it.id) store.setHover(null); });
        r.addEventListener('dblclick', (e) => {
          e.preventDefault();
          renaming = true;
          inlineRename(nm, it.name, v => { renaming = false; store.patchItem(it.id, { name: v }); }, () => { renaming = false; if (dirty) render(); });
        });
        r.addEventListener('keydown', (e) => {
          if (e.target !== r) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectItem(e as unknown as MouseEvent, it); }
          if (e.key === 'F2') { e.preventDefault(); r.dispatchEvent(new MouseEvent('dblclick')); }
        });
        list.appendChild(r);
      }
    }
    // roving-ish arrow navigation
    if (focusedKey) list.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  }

  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...list.querySelectorAll<HTMLElement>('[role=treeitem]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });

  const patchHover = () => {
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-id]')) r.classList.toggle('hovered', r.dataset.id === store.hover);
  };
  const patchSelection = () => {
    const sel = new Set(store.selection);
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-id]')) {
      const on = sel.has(r.dataset.id!);
      r.classList.toggle('selected', on);
      r.setAttribute('aria-selected', String(on));
    }
    // reveal selected rows in collapsed layers
    let changed = false;
    for (const it of store.selectedItems()) if (!expanded.has(it.layerId)) { expanded.add(it.layerId); changed = true; }
    if (changed) render();
    list.querySelector<HTMLElement>('.item-row.selected')?.scrollIntoView({ block: 'nearest' });
  };

  let raf = 0;
  store.on(ev => {
    if (ev === 'doc') { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
    else if (ev === 'selection') patchSelection();
    else if (ev === 'hover') patchHover();
  });
  render();
}
