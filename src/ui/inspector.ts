// Right inspector: composition summary / single item / multi-selection.
import { store } from '../core/store';
import type { Item, KallaxItem, Rotation } from '../core/types';
import { fmtCm, isOfficial, itemBox, kallaxNominal, unionBox, worldSize, boxesOverlap, MAX_CELLS, legsAvailable, KALLAX } from '../core/kallax';
import { h, clear, toast } from './dom';
import { icon } from './icons';
import { button, numberField, stepper, switchRow, textField, tip, type NumberField } from './controls';
import * as cmd from '../interaction/commands';
import { MOD } from './dom';

interface Panel { el: HTMLElement; update(): void }

const dims3 = (w: number, d: number, hh: number) => `${fmtCm(w)} × ${fmtCm(d)} × ${fmtCm(hh)}`;

function dimsBlock(w: number, d: number, hh: number): HTMLElement {
  const cell = (k: string, v: number, axis: string) =>
    h('div', { class: 'dim-cell' }, h('span', { class: `dim-k axis-${axis}` }, k), h('span', { class: 'dim-v' }, fmtCm(v)));
  const sep = (t: string, cls: string) =>
    h('div', { class: `dim-cell ${cls}`, 'aria-hidden': 'true' }, h('span', { class: 'dim-k' }, '\u00a0'), h('span', { class: 'dim-v' }, t));
  return h('div', { class: 'dims-card', role: 'group', 'aria-label': `Dimensions ${dims3(w, d, hh)} cm` },
    cell('L', w, 'x'), sep('×', 'dim-x'), cell('P', d, 'y'), sep('×', 'dim-x'), cell('H', hh, 'z'),
    sep('cm', 'dim-unit'));
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
        h('div', null, h('div', { class: 'hero-title' }, 'Composition'), h('div', { class: 'hero-sub' }, store.doc.name))),
      h('div', { class: 'stats' },
        stat('Objets', String(all.length)),
        stat('Cases', String(cells)),
        stat('Calques', String(store.doc.layers.length))),
    );
    if (u) el.append(group('Hors-tout', dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z)));
    // shopping list
    const counts = new Map<string, { n: number; label: string; sub: string; official: boolean }>();
    for (const k of kallax) {
      // normalise to IKEA naming (cols × rows as seen from the front)
      const key = `k:${k.cols}x${k.rows}`;
      const e = counts.get(key) ?? { n: 0, label: `Kallax ${k.cols}×${k.rows}`, sub: `${kallaxNominal(k.cols)}×${kallaxNominal(k.rows)}`, official: isOfficial(k.cols, k.rows) };
      e.n++; counts.set(key, e);
      if (k.legs) {
        const lk = `legs:${k.cols}`;
        const l = counts.get(lk) ?? { n: 0, label: 'Piètement KALLAX', sub: `${kallaxNominal(k.cols) - 1}×39×18`, official: true };
        l.n++; counts.set(lk, l);
      }
    }
    const blocks = new Map<string, { n: number; label: string; sub: string }>();
    for (const b of all) if (b.kind === 'block') {
      const key = `${b.name}|${b.size.w}|${b.size.d}|${b.size.h}`;
      const e = blocks.get(key) ?? { n: 0, label: b.name, sub: dims3(b.size.w, b.size.d, b.size.h) };
      e.n++; blocks.set(key, e);
    }
    const list = h('ul', { class: 'shop-list' });
    const lines: string[] = [];
    for (const e of [...counts.values()].sort((a, b) => b.n - a.n)) {
      list.appendChild(h('li', null,
        h('span', { class: 'qty' }, `${e.n}×`),
        h('span', { class: 'shop-name' }, e.label, h('small', null, `${e.sub} cm`)),
        h('span', { class: `pill ${e.official ? 'pill-ikea' : 'pill-custom'}` }, e.official ? 'IKEA' : 'Sur mesure')));
      lines.push(`${e.n}× ${e.label} (${e.sub} cm)${e.official ? '' : ' — sur mesure'}`);
    }
    for (const e of blocks.values()) {
      list.appendChild(h('li', { class: 'block' },
        h('span', { class: 'qty' }, `${e.n}×`),
        h('span', { class: 'shop-name' }, e.label, h('small', null, `${e.sub} cm`)),
        h('span', { class: 'pill pill-block' }, 'Bloc')));
      lines.push(`${e.n}× ${e.label} (${e.sub} cm)`);
    }
    if (!lines.length) {
      list.appendChild(h('li', { class: 'empty' }, 'Aucun meuble pour l’instant.'));
    }
    const copy = lines.length ? button({
      icon: 'duplicate', label: 'Copier', cls: 'mini-btn text', iconSize: 13,
      tip: 'Copier la liste dans le presse-papiers',
      onClick: () => {
        navigator.clipboard?.writeText(`${store.doc.name}\n${lines.join('\n')}`).then(() => toast('Liste copiée'), () => toast('Copie impossible'));
      },
    }) : null;
    el.append(h('div', { class: 'insp-group' },
      h('div', { class: 'insp-title-row' }, h('h4', { class: 'insp-title' }, 'Liste de courses'), copy), list));
    el.append(h('p', { class: 'hint insp-hint' }, 'Sélectionnez un objet pour modifier sa position, sa taille ou le dupliquer.'));
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

  const nameField = textField({ value: it0.name, ariaLabel: 'Nom de l’objet', cls: 'hero-name', onCommit: v => store.patchItem(id, { name: v }) });
  const typeLabel = h('div', { class: 'hero-sub' });
  const heroIcon = h('div', { class: 'hero-icon' }, icon(isK ? 'grid' : 'box', 22));
  const lockBanner = h('div', { class: 'banner', role: 'note' }, icon('lock', 13), 'Calque verrouillé — lecture seule');
  const overlapBanner = h('div', { class: 'banner warn', role: 'alert' }, icon('warning', 13), 'Chevauche un autre objet');
  const dimsHost = h('div');

  const fx = numberField({ label: 'X', axis: 'x', ariaLabel: 'Position X (cm)', value: it0.position.x, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { x: v }) });
  const fy = numberField({ label: 'Y', axis: 'y', ariaLabel: 'Position Y (cm)', value: it0.position.y, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { y: v }) });
  const fz = numberField({ label: 'Z', axis: 'z', ariaLabel: 'Position Z (cm)', value: it0.position.z, step: step(), min: 0, suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { z: v }) });
  tip(fx.el, 'Coin gauche (X) — glisser l’étiquette pour ajuster');
  tip(fy.el, 'Coin avant (Y) — glisser l’étiquette pour ajuster');
  tip(fz.el, 'Base (Z) — glisser l’étiquette pour ajuster');

  const rotVal = h('output', { class: 'rot-val' });
  const rotM = button({ icon: 'rotateCw', label: 'Pivoter de −90°', iconOnly: true, kbd: '⇧R', cls: 'seg-like', onClick: () => rotateOne(-90) });
  const rotP = button({ icon: 'rotateCcw', label: 'Pivoter de +90°', iconOnly: true, kbd: 'R', cls: 'seg-like', onClick: () => rotateOne(90) });
  const rotRow = h('div', { class: 'rot-row' }, rotM, rotVal, rotP);
  function rotateOne(d: 90 | -90) {
    if (!store.selection.includes(id)) store.select([id]);
    cmd.rotateSelection(d);
  }

  let legsSw: ReturnType<typeof switchRow> | null = null;
  let colsSt: ReturnType<typeof stepper> | null = null;
  let rowsSt: ReturnType<typeof stepper> | null = null;
  let fw: NumberField | null = null, fd: NumberField | null = null, fh: NumberField | null = null;
  let sizeGroup: HTMLElement;
  if (it0.kind === 'kallax') {
    colsSt = stepper({ label: 'Colonnes', value: it0.cols, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, v, x.rows); x.cols = v; } }) });
    rowsSt = stepper({ label: 'Lignes', value: it0.rows, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, x.cols, v); x.rows = v; } }) });
    legsSw = switchRow({
      label: 'Piètement', hint: `+${fmtCm(KALLAX.legs)} cm · cadre 77 ou 147 de large`, icon: 'arrowUp', value: !!it0.legs,
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
        x.name = x.name.replace(/ \+ piètement$/, '') + (v && /^Kallax \d×\d/.test(x.name) ? ' + piètement' : '');
      }),
    });
    sizeGroup = group('Cases', h('div', { class: 'steppers' }, colsSt.el, rowsSt.el), legsSw.el);
  } else {
    const patchSize = (k: 'w' | 'd' | 'h', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.size = { ...x.size, [k]: v };
    });
    fw = numberField({ label: 'L', axis: 'x', ariaLabel: 'Largeur (cm)', value: it0.size.w, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('w', v) });
    fd = numberField({ label: 'P', axis: 'y', ariaLabel: 'Profondeur (cm)', value: it0.size.d, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('d', v) });
    fh = numberField({ label: 'H', axis: 'z', ariaLabel: 'Hauteur (cm)', value: it0.size.h, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('h', v) });
    sizeGroup = group('Taille du bloc', h('div', { class: 'fields-3' }, fw.el, fd.el, fh.el));
  }

  const layerSel = h('select', { class: 'popup', 'aria-label': 'Calque' });
  layerSel.addEventListener('change', () => store.patchItem(id, { layerId: layerSel.value }));
  const layerWrap = h('div', { class: 'popup-wrap' }, layerSel, icon('chevronDown', 12, 'popup-chev'));

  const dupBtns = dupRow();
  const delBtn = button({ icon: 'trash', label: 'Supprimer', kbd: '⌫', cls: 'btn-destructive wide', onClick: () => { if (!store.selection.includes(id)) store.select([id]); cmd.deleteSelection(); } });

  el.append(
    h('div', { class: 'insp-hero' }, heroIcon, h('div', { class: 'hero-text' }, nameField.el, typeLabel)),
    lockBanner, overlapBanner,
    dimsHost,
    group('Position', h('div', { class: 'fields-3' }, fx.el, fy.el, fz.el)),
    group('Rotation', rotRow),
    sizeGroup,
    group('Calque', layerWrap),
    group('Dupliquer', dupBtns),
    h('div', { class: 'insp-group' }, delBtn),
  );

  const editables: { setDisabled(d: boolean): void }[] = [fx, fy, fz, nameField];
  if (colsSt) editables.push(colsSt, rowsSt!);
  if (fw) editables.push(fw, fd!, fh!);

  const update = () => {
    const it = store.getItem(id);
    if (!it) return;
    const s = worldSize(it);
    const locked = store.isLocked(it);
    nameField.set(it.name);
    if (it.kind === 'kallax') {
      const off = isOfficial(it.cols, it.rows);
      typeLabel.replaceChildren(`Kallax ${it.cols}×${it.rows} · ${kallaxNominal(it.cols)}×${kallaxNominal(it.rows)} cm `,
        h('span', { class: `pill ${off ? 'pill-ikea' : 'pill-custom'}` }, off ? 'IKEA' : 'Sur mesure'));
      colsSt!.set(it.cols); rowsSt!.set(it.rows);
      const can = legsAvailable(it.cols) || !!it.legs;
      legsSw!.set(!!it.legs);
      legsSw!.input.disabled = !can || locked;
      legsSw!.el.classList.toggle('disabled', !can);
      legsSw!.el.title = can ? '' : 'IKEA propose le piètement pour les cadres de 2 ou 4 cases de large';
    } else {
      typeLabel.textContent = 'Bloc libre';
      fw!.set(it.size.w); fd!.set(it.size.d); fh!.set(it.size.h);
    }
    dimsHost.replaceChildren(dimsBlock(s.w, s.d, s.h));
    fx.set(it.position.x); fy.set(it.position.y); fz.set(it.position.z);
    for (const f of [fx, fy, fz]) f.setStep(step());
    rotVal.textContent = `${it.rotation}°`;
    rotVal.setAttribute('aria-label', `Rotation ${it.rotation} degrés`);
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
    rotM.disabled = rotP.disabled = delBtn.disabled = locked;
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
    tip(el, `Dupliquer ${label} (${sub}), jointif`, kbd);
    el.addEventListener('click', () => cmd.duplicate(axis));
    return el;
  };
  return h('div', { class: 'dup-row' },
    b('x', 'arrowRight', 'à droite', '+X', `${MOD}D`),
    b('y', 'arrowBack', 'derrière', '+Y'),
    b('z', 'arrowUp', 'dessus', '+Z'));
}

// ── multi selection ──────────────────────────────────────────
function multiPanel(): Panel {
  const el = h('div', { class: 'insp-panel' });
  const title = h('div', { class: 'hero-title' });
  const sub = h('div', { class: 'hero-sub' });
  const dimsHost = h('div');
  const alignRow = h('div', { class: 'dup-row' },
    alignBtn('x', 'alignLeft', 'gauche', 'min X'),
    alignBtn('y', 'alignFront', 'avant', 'min Y'),
    alignBtn('z', 'alignBottom', 'bas', 'min Z'));
  const delBtn = button({ icon: 'trash', label: 'Supprimer la sélection', kbd: '⌫', cls: 'btn-destructive wide', onClick: () => cmd.deleteSelection() });
  el.append(
    h('div', { class: 'insp-hero' }, h('div', { class: 'hero-icon' }, icon('duplicate', 22)), h('div', null, title, sub)),
    group('Encombrement du groupe', dimsHost),
    group('Aligner', alignRow),
    group('Dupliquer le groupe', dupRow()),
    h('div', { class: 'insp-group' }, delBtn),
  );
  const update = () => {
    const sel = store.selectedItems();
    title.textContent = `${sel.length} objets sélectionnés`;
    const k = sel.filter(i => i.kind === 'kallax').length;
    sub.textContent = `${k} Kallax · ${sel.length - k} bloc${sel.length - k > 1 ? 's' : ''}`;
    const u = unionBox(sel);
    if (u) dimsHost.replaceChildren(dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z));
  };
  update();
  return { el, update };
}

function alignBtn(axis: 'x' | 'y' | 'z', ic: string, label: string, sub: string) {
  const el = h('button', { type: 'button', class: 'dup-btn' }, icon(ic, 18), h('span', { class: 'dup-label' }, label), h('span', { class: 'dup-sub' }, sub));
  tip(el, `Aligner à ${label === 'gauche' ? 'gauche' : label === 'avant' ? 'l’avant' : 'la base'} (${sub})`);
  el.addEventListener('click', () => cmd.align(axis));
  return el;
}

// ── host ─────────────────────────────────────────────────────
export function buildInspector(host: HTMLElement) {
  const head = h('div', { class: 'insp-head' }, h('span', { class: 'insp-head-title' }, 'Inspecteur'));
  const scroll = h('div', { class: 'insp-scroll' });
  host.append(head, scroll);
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
