// Layers panel + outliner.
import { store, uid } from '../core/store';
import type { Item, Layer } from '../core/types';
import { fmtCm, worldSize } from '../core/kallax';
import { h, clear, toast } from './dom';
import { icon } from './icons';
import { itemIcon } from './inspector';
import { button, tip } from './controls';
import { t, tn } from '../core/i18n';
import { fullGroups, groupName } from '../core/groups';
import { renameGroup } from '../interaction/commands';

const expanded = new Set<string>();
/** Expanded group rows, keyed "layerId:groupId" (groups start collapsed). */
const expandedGroups = new Set<string>();
let initialised = false;

function itemDims(it: Item) {
  const s = worldSize(it);
  return `${fmtCm(s.w)}×${fmtCm(s.d)}×${fmtCm(s.h)}`;
}

/** Inline rename: replaces `label` with an input until Enter / Escape / blur. */
function inlineRename(label: HTMLElement, current: string, commit: (v: string) => void, onEnd: () => void) {
  const input = h('input', { type: 'text', class: 'rename-input', value: current, 'aria-label': t('common.rename'), spellcheck: 'false' });
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

  const addBtn = button({ icon: 'plus', label: t('layers.new'), iconOnly: true, cls: 'mini-btn', iconSize: 15, onClick: addLayer });
  const list = h('div', { class: 'layers-list', role: 'tree', 'aria-label': t('layers.treeAria'), 'aria-multiselectable': 'true' });
  host.append(
    h('section', { class: 'panel-section' },
      h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, t('layers.title')), addBtn),
      list,
      h('p', { class: 'hint' }, t('layers.hint'))),
  );

  function addLayer() {
    const n = store.doc.layers.length + 1;
    const layer: Layer = { id: uid('layer'), name: t('layer.default', { n }), visible: true, locked: false };
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
    if (n) toast(tn('layers.moved', n, { name: target.name }));
  }

  function patchLayer(id: string, patch: Partial<Layer>) {
    store.update(d => { const l = d.layers.find(x => x.id === id); if (l) Object.assign(l, patch); });
  }

  function selectItem(e: MouseEvent, it: Item) {
    // a row inside a group picks that member alone (like double-clicking it in the view)
    if (it.groupId && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      store.enterGroup(it.groupId, it.id);
      anchorId = it.id;
      return;
    }
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
      const disclosure = h('button', { type: 'button', class: `disclosure ${open ? 'open' : ''}`, 'aria-label': open ? t('layers.collapse') : t('layers.expand'), tabindex: '-1' }, icon('chevronRight', 12));
      disclosure.addEventListener('click', (e) => { e.stopPropagation(); open ? expanded.delete(layer.id) : expanded.add(layer.id); render(); });
      const name = h('span', { class: 'layer-name' }, layer.name);
      const count = h('span', { class: 'layer-count' }, String(items.length));
      const eye = h('button', { type: 'button', class: `row-toggle ${layer.visible ? '' : 'off'}`, 'aria-pressed': String(!layer.visible), 'aria-label': layer.visible ? t('layers.hideAria') : t('layers.showAria') }, icon(layer.visible ? 'eye' : 'eyeSlash', 15));
      tip(eye, layer.visible ? t('layers.hide') : t('layers.show'));
      eye.addEventListener('click', (e) => { e.stopPropagation(); patchLayer(layer.id, { visible: !layer.visible }); });
      const lock = h('button', { type: 'button', class: `row-toggle ${layer.locked ? 'on' : ''}`, 'aria-pressed': String(layer.locked), 'aria-label': layer.locked ? t('layers.unlockAria') : t('layers.lockAria') }, icon(layer.locked ? 'lock' : 'lockOpen', 14));
      tip(lock, layer.locked ? t('layers.unlock') : t('layers.lock'));
      lock.addEventListener('click', (e) => { e.stopPropagation(); patchLayer(layer.id, { locked: !layer.locked }); });
      const del = doc.layers.length > 1 ? h('button', { type: 'button', class: 'row-toggle del', 'aria-label': t('layers.deleteAria', { name: layer.name }) }, icon('trash', 14)) : null;
      if (del) { tip(del, t('layers.deleteTip')); del.addEventListener('click', (e) => { e.stopPropagation(); deleteLayer(layer.id); }); }

      const row = h('div', {
        class: `layer-row ${isActive ? 'active' : ''} ${layer.visible ? '' : 'hidden-layer'}`,
        role: 'treeitem', tabindex: '0', 'aria-expanded': String(open), 'aria-selected': String(isActive),
        'aria-level': '1', dataset: { key: `l:${layer.id}` },
      }, disclosure, icon('layers', 15, 'layer-icon'), name,
        isActive ? h('span', { class: 'active-dot', role: 'img', 'aria-label': t('layers.activeAria') }) : null, count,
        h('span', { class: 'row-actions' }, del, lock, eye));
      tip(row, isActive ? t('layers.activeTip') : t('layers.makeActiveTip'));
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
        list.appendChild(h('div', { class: 'item-row empty', 'aria-hidden': 'true' }, t('layers.noObjects')));
        continue;
      }
      const fullSel = new Set(fullGroups(store.selection, store.visibleItems()));
      const doneGroups = new Set<string>();
      const itemRow = (it: Item, level: number) => {
        const nm = h('span', { class: 'item-name' }, it.name);
        const r = h('div', {
          class: `item-row ${level > 2 ? 'in-group' : ''} ${sel.has(it.id) ? 'selected' : ''} ${store.hover === it.id ? 'hovered' : ''}`,
          role: 'treeitem', tabindex: '0', 'aria-level': String(level), 'aria-selected': String(sel.has(it.id)),
          dataset: { id: it.id, key: `i:${it.id}` },
        },
          h('span', { class: 'item-glyph' }, icon(itemIcon(it), 13)),
          nm,
          h('span', { class: 'item-dims' }, itemDims(it)),
          layer.locked ? h('span', { class: 'item-lock', 'aria-label': t('layers.lockedAria') }, icon('lock', 11)) : null,
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
      };
      for (const it of items) {
        if (!it.groupId) { itemRow(it, 2); continue; }
        const gid = it.groupId;
        if (doneGroups.has(gid)) continue;
        doneGroups.add(gid);
        const members = items.filter(i => i.groupId === gid);
        const gkey = `${layer.id}:${gid}`;
        const gopen = expandedGroups.has(gkey);
        const gname = groupName(doc, gid);
        const gsel = fullSel.has(gid);
        const gdisc = h('button', { type: 'button', class: `disclosure ${gopen ? 'open' : ''}`, 'aria-label': gopen ? t('layers.collapse') : t('layers.expand'), tabindex: '-1' }, icon('chevronRight', 11));
        gdisc.addEventListener('click', (e) => { e.stopPropagation(); gopen ? expandedGroups.delete(gkey) : expandedGroups.add(gkey); render(); });
        const gnm = h('span', { class: 'item-name' }, gname);
        const gr = h('div', {
          class: `item-row group-row-l ${gsel ? 'selected' : ''} ${store.enteredGroup === gid ? 'entered' : ''}`,
          role: 'treeitem', tabindex: '0', 'aria-level': '2', 'aria-expanded': String(gopen), 'aria-selected': String(gsel),
          dataset: { gid, key: `g:${gkey}` },
        }, gdisc, h('span', { class: 'item-glyph' }, icon('group', 13)), gnm,
          h('span', { class: 'item-dims' }, tn('comp.items', members.length)));
        tip(gr, t('layers.groupTip'));
        gr.addEventListener('click', (e) => {
          const ids = store.visibleItems().filter(i => i.groupId === gid).map(i => i.id);
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            const allOn = ids.every(id => store.selection.includes(id));
            store.select(allOn ? store.selection.filter(x => !ids.includes(x)) : [...store.selection, ...ids], true);
          } else { store.enteredGroup = null; store.select(ids, true); }
        });
        gr.addEventListener('pointerenter', () => store.setHover(members[0].id));
        gr.addEventListener('pointerleave', () => { if (store.hover === members[0].id) store.setHover(null); });
        gr.addEventListener('dblclick', (e) => {
          e.preventDefault();
          renaming = true;
          inlineRename(gnm, gname, v => { renaming = false; renameGroup(gid, v); }, () => { renaming = false; if (dirty) render(); });
        });
        gr.addEventListener('keydown', (e) => {
          if (e.target !== gr) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gr.click(); }
          if (e.key === 'ArrowRight' && !gopen) { e.preventDefault(); expandedGroups.add(gkey); render(); }
          if (e.key === 'ArrowLeft' && gopen) { e.preventDefault(); expandedGroups.delete(gkey); render(); }
          if (e.key === 'F2') { e.preventDefault(); gr.dispatchEvent(new MouseEvent('dblclick')); }
        });
        list.appendChild(gr);
        if (gopen) for (const m of members) itemRow(m, 3);
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
    const hg = store.hover ? store.getItem(store.hover)?.groupId : undefined;
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-id]')) r.classList.toggle('hovered', r.dataset.id === store.hover);
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-gid]')) r.classList.toggle('hovered', !!hg && r.dataset.gid === hg);
  };
  const patchSelection = () => {
    const sel = new Set(store.selection);
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-id]')) {
      const on = sel.has(r.dataset.id!);
      r.classList.toggle('selected', on);
      r.setAttribute('aria-selected', String(on));
    }
    const full = new Set(fullGroups(store.selection, store.visibleItems()));
    for (const r of list.querySelectorAll<HTMLElement>('.item-row[data-gid]')) {
      const on = full.has(r.dataset.gid!);
      r.classList.toggle('selected', on);
      r.classList.toggle('entered', store.enteredGroup === r.dataset.gid);
      r.setAttribute('aria-selected', String(on));
    }
    // reveal selected rows in collapsed layers (and members picked inside a group)
    let changed = false;
    for (const it of store.selectedItems()) {
      if (!expanded.has(it.layerId)) { expanded.add(it.layerId); changed = true; }
      if (it.groupId && store.enteredGroup === it.groupId && !expandedGroups.has(`${it.layerId}:${it.groupId}`)) { expandedGroups.add(`${it.layerId}:${it.groupId}`); changed = true; }
    }
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
