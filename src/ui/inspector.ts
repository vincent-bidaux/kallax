// Right inspector: composition summary / single item / multi-selection.
import { store } from '../core/store';
import type { Item, KallaxItem, Rotation } from '../core/types';
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

/** "Non proposée en 2×2, 1×4" when a finish is not sold for some of these (IKEA-sold) frames. */
function notSoldIn(ks: KallaxItem[], f: FinishId): string | null {
  const miss = new Set<string>();
  for (const k of ks) if (frameSold(k.cols, k.rows) && !frameFinishes(k.cols, k.rows).includes(f)) miss.add(`${k.cols}×${k.rows}`);
  return miss.size ? `Non proposée en ${[...miss].join(', ')}` : null;
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
  if (fr.length) parts.push(fr.every(l => l.total == null) ? 'cadre sur mesure' : `${cnt(fr) > 1 ? `${cnt(fr)} cadres` : 'cadre'} ${fmtEur(tot(fr))}`);
  if (lg.length) parts.push(`piètement${cnt(lg) > 1 ? 's' : ''} ${lg.every(l => l.total == null) ? '—' : fmtEur(tot(lg))}`);
  if (ins.length) parts.push(`${cnt(ins)} habillage${cnt(ins) > 1 ? 's' : ''} ${fmtEur(tot(ins))}`);
  // insert notes don't name the fitting: prefix it ("Bloc 2 tiroirs : pas en noyer — brun noir")
  const notes = [...new Set(b.lines.filter(l => l.note).map(l => l.kind === 'insert'
    ? `${l.label.replace(/^KALLAX /, '').replace(/^./, c => c.toUpperCase())} : ${l.note!.replace(/^./, c => c.toLowerCase())}`
    : l.note!))];
  const priced = b.lines.some(l => l.total != null);
  return h('div', { class: 'price-card', role: 'group', 'aria-label': `${label} : ${priced ? fmtEur(b.total) : 'non chiffré'}` },
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
        h('div', null, h('div', { class: 'hero-title' }, 'Composition'), h('div', { class: 'hero-sub' }, store.doc.name))),
      h('div', { class: 'stats' },
        stat('Objets', String(all.length)),
        stat('Cases', String(cells)),
        stat('Calques', String(store.doc.layers.length))),
    );
    if (u) el.append(group('Hors-tout', dimsBlock(u.max.x - u.min.x, u.max.y - u.min.y, u.max.z - u.min.z)));
    // finish (global) + basket variant
    const gf = store.doc.finish ?? DEFAULT_FINISH;
    const fp = finishPicker({
      title: 'Finition', ariaLabel: 'Finition globale des Kallax',
      onPick: f => { if (f && f !== (store.doc.finish ?? DEFAULT_FINISH)) store.update(d => { d.finish = f; }); },
    });
    const visK = items.filter((i): i is KallaxItem => i.kind === 'kallax');
    fp.set({ value: gf, global: gf, unavailable: f => notSoldIn(visK, f) });
    const overrides = kallax.filter(k => k.finish && k.finish !== gf).length;
    if (overrides) fp.el.append(h('p', { class: 'hint finish-hint' },
      overrides > 1 ? `${overrides} meubles ont leur propre finition.` : '1 meuble a sa propre finition.'));
    const basket = segmented<BasketVariant>({
      ariaLabel: 'Paniers BRANÄS', size: 'sm', value: store.doc.basket ?? 'naturel', cls: 'basket-seg',
      options: BASKET_VARIANTS.map(v => ({ value: v.id, label: v.id === 'naturel' ? 'Naturel' : 'Blanc', tip: `${v.label} · ${fmtEur(v.price)}` })),
      onChange: v => { if (v !== (store.doc.basket ?? 'naturel')) store.update(d => { d.basket = v; }); },
    });
    fp.el.append(h('div', { class: 'basket-row' }, h('span', { class: 'basket-label' }, 'Paniers'), basket.el));
    el.append(fp.el);

    // priced shopping list
    const bom = currentBom();
    const copy = bom.lines.length ? button({
      icon: 'duplicate', label: 'Copier', cls: 'mini-btn text', iconSize: 13,
      tip: 'Copier la liste chiffrée dans le presse-papiers',
      onClick: () => {
        navigator.clipboard?.writeText(bomText(bom, store.doc.name)).then(() => toast('Liste copiée'), () => toast('Copie impossible'));
      },
    }) : null;
    el.append(h('div', { class: 'insp-group bom-group' },
      h('div', { class: 'insp-title-row' }, h('h4', { class: 'insp-title' }, 'Liste de courses'), copy), bomList(bom)));
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
  const heroIcon = h('div', { class: 'hero-icon' }, icon(isK ? 'grid' : shapeIcon(it0.shape), 22));
  const lockBanner = h('div', { class: 'banner', role: 'note' }, icon('lock', 13), 'Calque verrouillé — lecture seule');
  const overlapBanner = h('div', { class: 'banner warn', role: 'alert' }, icon('warning', 13), 'Chevauche un autre objet');
  const dimsHost = h('div');

  const fx = numberField({ label: 'X', axis: 'x', ariaLabel: 'Position X (cm)', value: it0.position.x, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { x: v }) });
  const fy = numberField({ label: 'Y', axis: 'y', ariaLabel: 'Position Y (cm)', value: it0.position.y, step: step(), suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { y: v }) });
  const fz = numberField({ label: 'Z', axis: 'z', ariaLabel: 'Position Z (cm)', value: it0.position.z, step: step(), min: 0, suffix: 'cm', onCommit: v => cmd.moveItemTo(id, { z: v }) });
  tip(fx.el, 'Coin gauche (X) — glisser l’étiquette pour ajuster');
  tip(fy.el, 'Coin avant (Y) — glisser l’étiquette pour ajuster');
  tip(fz.el, 'Base (Z) — glisser l’étiquette pour ajuster');

  const rotRows = (['x', 'y', 'z'] as Axis3[]).map(ax => {
    const val = h('output', { class: 'rot-val' });
    const kb = ax === 'z' ? 'R' : ax === 'x' ? 'X' : 'Y';
    const m = button({ icon: 'rotateCw', label: `Pivoter de −90° autour de ${ax.toUpperCase()}`, iconOnly: true, kbd: `⇧${kb}`, cls: 'seg-like', onClick: () => rotateOne(-90, ax) });
    const p = button({ icon: 'rotateCcw', label: `Pivoter de +90° autour de ${ax.toUpperCase()}`, iconOnly: true, kbd: kb, cls: 'seg-like', onClick: () => rotateOne(90, ax) });
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
  if (it0.kind === 'kallax') {
    colsSt = stepper({ label: 'Colonnes', value: it0.cols, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, v, x.rows); x.cols = v; } }) });
    rowsSt = stepper({ label: 'Lignes', value: it0.rows, min: 1, max: MAX_CELLS, onChange: v => store.update(d => { const x = d.items.find(i => i.id === id); if (x && x.kind === 'kallax') { x.name = renameKallax(x, x.cols, x.rows, x.cols, v); x.rows = v; } }) });
    legsSw = switchRow({
      label: 'Piètement', hint: `+${fmtCm(KALLAX.legs)} cm · 2×2, 2×4, 4×3, 4×4`, icon: 'arrowUp', value: !!it0.legs,
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
  } else if (it0.shape === 'cylinder' || it0.shape === 'square') {
    const patchCyl = (k: 'diameter' | 'length', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id);
      if (!x || x.kind !== 'block') return;
      const c = cylinderDims(x);
      x.size = cylinderSize(k === 'diameter' ? v : c.diameter, k === 'length' ? v : c.length, c.axis);
    });
    const c0 = cylinderDims(it0);
    const sq = it0.shape === 'square';
    fw = numberField({ label: sq ? '□' : 'Ø', ariaLabel: sq ? 'Côté (cm)' : 'Diamètre (cm)', value: c0.diameter, step: 0.5, min: 0.5, suffix: 'cm', onCommit: v => patchCyl('diameter', v) });
    fh = numberField({ label: 'L', ariaLabel: 'Longueur (cm)', value: c0.length, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchCyl('length', v) });
    sizeGroup = group(sq ? 'Poutre carrée' : 'Poutre ronde', h('div', { class: 'fields-2' }, fw.el, fh.el));
  } else if (it0.shape === 'wall') {
    const patchSize = (k: 'w' | 'h', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.size = { ...x.size, [k]: v };
    });
    fw = numberField({ label: 'L', axis: 'x', ariaLabel: 'Largeur (cm)', value: it0.size.w, step: 1, min: 1, suffix: 'cm', onCommit: v => patchSize('w', v) });
    fh = numberField({ label: 'H', axis: 'z', ariaLabel: 'Hauteur (cm)', value: it0.size.h, step: 1, min: 1, suffix: 'cm', onCommit: v => patchSize('h', v) });
    sizeGroup = group('Mur (plan)', h('div', { class: 'fields-2' }, fw.el, fh.el));
  } else {
    const patchSize = (k: 'w' | 'd' | 'h', v: number) => store.update(d => {
      const x = d.items.find(i => i.id === id); if (x && x.kind === 'block') x.size = { ...x.size, [k]: v };
    });
    fw = numberField({ label: 'L', axis: 'x', ariaLabel: 'Largeur (cm)', value: it0.size.w, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('w', v) });
    fd = numberField({ label: 'P', axis: 'y', ariaLabel: 'Profondeur (cm)', value: it0.size.d, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('d', v) });
    fh = numberField({ label: 'H', axis: 'z', ariaLabel: 'Hauteur (cm)', value: it0.size.h, step: 1, min: 0.5, suffix: 'cm', onCommit: v => patchSize('h', v) });
    sizeGroup = group(it0.shape === 'window' ? 'Fenêtre' : 'Taille du bloc', h('div', { class: 'fields-3' }, fw.el, fd.el, fh.el));
  }

  const priceHost = h('div', { class: 'price-host' });
  const finishP = isK ? finishPicker({
    withGlobal: true, ariaLabel: 'Finition de ce Kallax',
    onPick: f => {
      const cur = store.getItem(id);
      if (!cur || cur.kind !== 'kallax' || store.isLocked(cur) || (cur.finish ?? null) === f) return;
      store.update(d => {
        const x = d.items.find(i => i.id === id);
        if (x && x.kind === 'kallax') { if (f) x.finish = f; else delete x.finish; }
      });
    },
  }) : null;

  const layerSel = h('select', { class: 'popup', 'aria-label': 'Calque' });
  layerSel.addEventListener('change', () => store.patchItem(id, { layerId: layerSel.value }));
  const layerWrap = h('div', { class: 'popup-wrap' }, layerSel, icon('chevronDown', 12, 'popup-chev'));

  const dupBtns = dupRow();
  const delBtn = button({ icon: 'trash', label: 'Supprimer', kbd: '⌫', cls: 'btn-destructive wide', onClick: () => { if (!store.selection.includes(id)) store.select([id]); cmd.deleteSelection(); } });

  el.append(
    h('div', { class: 'insp-hero' }, heroIcon, h('div', { class: 'hero-text' }, nameField.el, typeLabel)),
    lockBanner, overlapBanner,
    dimsHost,
    priceHost,
    group('Position', h('div', { class: 'fields-3' }, fx.el, fy.el, fz.el)),
    group('Rotation (pas de 90°)', h('div', { class: 'rot-rows' }, rotRows.map(r => r.row))),
    sizeGroup,
    ...(finishP ? [finishP.el] : []),
    group('Calque', layerWrap),
    group('Dupliquer', dupBtns),
    h('div', { class: 'insp-group' }, delBtn),
  );

  const editables: { setDisabled(d: boolean): void }[] = [fx, fy, fz, nameField];
  if (colsSt) editables.push(colsSt, rowsSt!);
  for (const f of [fw, fd, fh]) if (f) editables.push(f);

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
      const can = legsAvailable(it.cols, it.rows) || !!it.legs;
      legsSw!.set(!!it.legs);
      legsSw!.input.disabled = !can || locked;
      legsSw!.el.classList.toggle('disabled', !can);
      legsSw!.el.title = can ? '' : 'Piètement IKEA : 2×2, 2×4 debout, 4×2 / 4×3 couchés, 4×4';
      finishP!.set({
        value: it.finish ?? null, inherit: !it.finish, global: store.doc.finish ?? DEFAULT_FINISH,
        unavailable: f => notSoldIn([it], f), disabled: locked,
      });
      priceHost.replaceChildren(priceCard([it], 'Prix'));
    } else if (it.shape === 'cylinder' || it.shape === 'square') {
      const c = cylinderDims(it);
      typeLabel.textContent = it.shape === 'square'
        ? `Poutre carrée · □ ${fmtCm(c.diameter)} × ${fmtCm(c.length)} cm`
        : `Poutre ronde · Ø ${fmtCm(c.diameter)} × ${fmtCm(c.length)} cm`;
      fw!.set(c.diameter); fh!.set(c.length);
    } else if (it.shape === 'window') {
      typeLabel.textContent = 'Fenêtre · 2 vantaux';
      fw!.set(it.size.w); fd!.set(it.size.d); fh!.set(it.size.h);
    } else if (it.shape === 'wall') {
      typeLabel.textContent = 'Mur · plan opaque';
      fw!.set(it.size.w); fh!.set(it.size.h);
    } else {
      typeLabel.textContent = 'Bloc libre';
      fw!.set(it.size.w); fd!.set(it.size.d); fh!.set(it.size.h);
    }
    dimsHost.replaceChildren(dimsBlock(s.w, s.d, s.h));
    fx.set(it.position.x); fy.set(it.position.y); fz.set(it.position.z);
    for (const f of [fx, fy, fz]) f.setStep(step());
    const eul = itemEuler(it);
    for (const r of rotRows) {
      r.val.textContent = `${eul[r.ax]}°`;
      r.val.setAttribute('aria-label', `Rotation ${r.ax.toUpperCase()} ${eul[r.ax]} degrés`);
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
  const selKallax = () => store.selectedItems().filter((i): i is KallaxItem => i.kind === 'kallax' && !store.isLocked(i));
  const finishP = finishPicker({
    withGlobal: true, ariaLabel: 'Finition des Kallax sélectionnés',
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
    group('Encombrement du groupe', dimsHost),
    priceHost,
    finishP.el,
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
    // finish of the selected KALLAX (one undo step for all)
    const ks = sel.filter((i): i is KallaxItem => i.kind === 'kallax');
    finishP.el.hidden = !ks.length;
    priceHost.replaceChildren(...(ks.length ? [priceCard(ks, ks.length > 1 ? `${ks.length} Kallax` : 'Kallax')] : []));
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
  tip(el, `Aligner à ${label === 'gauche' ? 'gauche' : label === 'avant' ? 'l’avant' : 'la base'} (${sub})`);
  el.addEventListener('click', () => cmd.align(axis));
  return el;
}

// ── host ─────────────────────────────────────────────────────
export function buildInspector(host: HTMLElement) {
  const head = h('div', { class: 'insp-head' }, h('span', { class: 'insp-head-title' }, 'Inspecteur'));
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

export function shapeIcon(shape: string | undefined): string {
  return shape === 'cylinder' ? 'cylinder' : shape === 'square' ? 'beamSquare' : shape === 'wall' ? 'wall' : shape === 'window' ? 'window' : 'box';
}
