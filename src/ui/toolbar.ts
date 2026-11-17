// Unified toolbar: document, undo/redo, view + projection, popovers, menu.
import { store } from '../core/store';
import type { ViewPreset } from '../core/types';
import { h, MOD, SHIFT } from './dom';
import { icon } from './icons';
import { button, segmented, switchRow, tip } from './controls';
import { Popover, fillMenu } from './popover';
import * as cmd from '../interaction/commands';
import { newDocument, openJSON, exportJSON, exportPNG } from './file-io';

export interface ToolbarHooks {
  toggleSidebar(): void;
  toggleInspector(): void;
  openShortcuts(): void;
}

export function buildToolbar(host: HTMLElement, hooks: ToolbarHooks) {
  // ── left: sidebar toggle, glyph, document name, undo/redo ──
  const sideBtn = button({ icon: 'sidebarLeft', label: 'Afficher/masquer la barre latérale', iconOnly: true, cls: 'tb-btn', iconSize: 18, onClick: hooks.toggleSidebar });
  const glyph = h('div', { class: 'app-glyph', 'aria-hidden': 'true' }, icon('cube', 17));
  const nameInput = h('input', {
    class: 'doc-name', type: 'text', value: store.doc.name, spellcheck: 'false',
    'aria-label': 'Nom du document', size: '1',
  });
  const sizer = h('span', { class: 'doc-name-sizer', 'aria-hidden': 'true' });
  const nameWrap = h('div', { class: 'doc-name-wrap' }, sizer, nameInput);
  const fitName = () => { sizer.textContent = nameInput.value || ' '; };
  nameInput.addEventListener('input', fitName);
  const commitName = () => {
    const v = nameInput.value.trim() || 'Sans titre';
    if (v !== store.doc.name) store.update(d => { d.name = v; });
    nameInput.value = v; fitName();
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    if (e.key === 'Escape') { nameInput.value = store.doc.name; nameInput.blur(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('blur', commitName);
  const docSub = h('div', { class: 'doc-sub' }, 'Kallax Designer');
  const docBlock = h('div', { class: 'doc-block' }, nameWrap, docSub);

  const undoBtn = button({ icon: 'undo', label: 'Annuler', iconOnly: true, kbd: `${MOD}Z`, cls: 'tb-btn', iconSize: 18, onClick: () => store.undo() });
  const redoBtn = button({ icon: 'redo', label: 'Rétablir', iconOnly: true, kbd: `${SHIFT}${MOD}Z`, cls: 'tb-btn', iconSize: 18, onClick: () => store.redo() });
  const history = h('div', { class: 'tb-group' }, undoBtn, redoBtn);

  // ── center: view + projection ──
  const viewSeg = segmented<'iso' | 'cavalier' | 'free'>({
    ariaLabel: 'Vue',
    options: [
      { value: 'iso', label: 'Isométrique', tip: 'Vue isométrique', kbd: '1' },
      { value: 'cavalier', label: 'Cavalière', tip: 'Perspective cavalière', kbd: '2' },
      { value: 'free', label: 'Libre', tip: 'Rotation libre — glissez dans la vue pour orbiter' },
    ],
    value: viewValue(store.settings.view),
    onChange: (v) => cmd.setView(v),
    cls: 'seg-view',
  });
  const projSeg = segmented<'perspective' | 'orthographic'>({
    ariaLabel: 'Projection',
    options: [
      { value: 'perspective', label: 'Perspective', tip: 'Projection perspective', kbd: 'P' },
      { value: 'orthographic', label: 'Ortho', tip: 'Projection orthographique', kbd: 'P' },
    ],
    value: store.settings.projection,
    onChange: (v) => cmd.setProjection(v),
    cls: 'seg-proj',
  });
  const center = h('div', { class: 'tb-center' },
    h('div', { class: 'tb-labeled' }, viewSeg.el),
    h('div', { class: 'tb-labeled' }, projSeg.el));

  // ── right: popovers ──
  const cotesBtn = button({ icon: 'ruler', label: 'Cotes', tip: 'Cotes', cls: 'tb-btn tb-pill', iconSize: 17 });
  const renduBtn = button({ icon: 'render', label: 'Rendu', tip: 'Rendu et thème', cls: 'tb-btn tb-pill', iconSize: 17 });
  const grilleBtn = button({ icon: 'grid', label: 'Grille', tip: 'Grille et aimantation', cls: 'tb-btn tb-pill', iconSize: 17 });
  const fitBtn = button({ icon: 'fit', label: 'Cadrer', tip: 'Cadrer la composition', kbd: 'F', cls: 'tb-btn tb-pill', iconSize: 17, onClick: () => cmd.zoomToFit() });
  const moreBtn = button({ icon: 'moreCircle', label: 'Plus d’options', iconOnly: true, cls: 'tb-btn', iconSize: 19 });
  const inspBtn = button({ icon: 'sidebarRight', label: 'Afficher/masquer l’inspecteur', iconOnly: true, cls: 'tb-btn', iconSize: 18, onClick: hooks.toggleInspector });

  // Cotes
  const cotes = new Popover(cotesBtn, { title: 'Cotes', width: 280 });
  const swItems = switchRow({ label: 'Cotes par bloc', hint: 'L × P × H de chaque meuble', icon: 'ruler', kbd: 'M', value: store.settings.measureItems, onChange: v => store.setSettings({ measureItems: v }) });
  const swGlobal = switchRow({ label: 'Cotes globales', hint: 'Hors-tout de la composition', icon: 'fit', value: store.settings.measureGlobal, onChange: v => store.setSettings({ measureGlobal: v }) });
  cotes.body.append(h('div', { class: 'group' }, swItems.el, swGlobal.el));

  // Rendu
  const rendu = new Popover(renduBtn, { title: 'Rendu', width: 300 });
  const themeSeg = segmented<'blueprint' | 'paper'>({
    ariaLabel: 'Thème', value: store.settings.theme,
    options: [{ value: 'blueprint', label: 'Plan d’architecte' }, { value: 'paper', label: 'Papier' }],
    onChange: v => store.setSettings({ theme: v }),
  });
  const swShadows = switchRow({ label: 'Ombres', hint: 'Faces éclairées, ombre au sol', icon: 'shadow', value: store.settings.shadows, onChange: v => store.setSettings({ shadows: v }) });
  const swTransp = switchRow({ label: 'Transparence', hint: 'Arêtes cachées en pointillés', icon: 'transparency', value: store.settings.transparency, onChange: v => store.setSettings({ transparency: v }) });
  const angleSeg = segmented<number>({
    ariaLabel: 'Angle des fuyantes', size: 'sm', value: store.settings.cavalierAngle,
    options: [30, 45, 60].map(a => ({ value: a, label: `${a}°` })),
    onChange: v => store.setSettings({ cavalierAngle: v }),
  });
  const ratioSeg = segmented<number>({
    ariaLabel: 'Rapport de réduction', size: 'sm', value: store.settings.cavalierRatio,
    options: [{ value: 1, label: '1 · cavalière' }, { value: 0.5, label: '0,5 · cabinet' }],
    onChange: v => store.setSettings({ cavalierRatio: v }),
  });
  rendu.body.append(
    h('div', { class: 'pop-label' }, 'Thème'), themeSeg.el,
    h('div', { class: 'group' }, swShadows.el, swTransp.el),
    h('div', { class: 'pop-label' }, 'Perspective cavalière'),
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'row-text' }, 'Angle')), angleSeg.el),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'row-text' }, 'Rapport')), ratioSeg.el)),
  );

  // Grille
  const grille = new Popover(grilleBtn, { title: 'Grille', width: 300 });
  const stepSeg = segmented<number>({
    ariaLabel: 'Pas de la grille', value: store.settings.gridCell,
    options: [1, 5, 10, 35].map(v => ({ value: v, label: `${v} cm`, tip: v === 35 ? 'Pas Kallax (35 cm)' : undefined })),
    onChange: v => store.setSettings({ gridCell: v }),
  });
  const swSnapGrid = switchRow({ label: 'Aimanter à la grille', icon: 'grid', value: store.settings.snapGrid, onChange: v => store.setSettings({ snapGrid: v }) });
  const swSnapItems = switchRow({ label: 'Aimanter aux objets', hint: 'Faces jointives et alignements', icon: 'magnet', value: store.settings.snapItems, onChange: v => store.setSettings({ snapItems: v }) });
  const swShowGrid = switchRow({ label: 'Afficher la grille', kbd: 'G', icon: 'grid', value: store.settings.showGrid, onChange: v => store.setSettings({ showGrid: v }) });
  const swAxes = switchRow({ label: 'Afficher l’origine', hint: 'Axes X, Y, Z en 0,0,0', icon: 'target', value: store.settings.showAxes, onChange: v => store.setSettings({ showAxes: v }) });
  grille.body.append(
    h('div', { class: 'pop-label' }, 'Pas'), stepSeg.el,
    h('div', { class: 'group' }, swSnapGrid.el, swSnapItems.el),
    h('div', { class: 'group' }, swShowGrid.el, swAxes.el),
  );

  // … menu
  const menu = new Popover(moreBtn, { role: 'menu', cls: 'menu-pop', width: 248 });
  fillMenu(menu, [
    { label: 'Nouveau', icon: 'docNew', action: newDocument },
    { label: 'Ouvrir JSON…', icon: 'folder', action: openJSON },
    { label: 'Exporter JSON', icon: 'download', action: exportJSON, separatorBefore: true },
    { label: 'Exporter PNG', icon: 'photo', action: exportPNG },
    { label: 'Raccourcis clavier', icon: 'keyboard', kbd: '?', action: hooks.openShortcuts, separatorBefore: true },
  ]);

  const right = h('div', { class: 'tb-right' },
    h('div', { class: 'tb-group' }, cotesBtn, renduBtn, grilleBtn),
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }),
    fitBtn, moreBtn,
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }),
    inspBtn);

  const left = h('div', { class: 'tb-left' }, sideBtn, glyph, docBlock, h('div', { class: 'tb-sep', 'aria-hidden': 'true' }), history);
  host.append(left, center, right);
  host.setAttribute('role', 'toolbar');
  host.setAttribute('aria-label', 'Barre d’outils');
  tip(sideBtn, 'Barre latérale');
  tip(inspBtn, 'Inspecteur');
  tip(moreBtn, 'Plus');

  // ── sync ──
  const sync = () => {
    const s = store.settings;
    viewSeg.set(viewValue(s.view));
    projSeg.set(s.view === 'cavalier' ? 'orthographic' : s.projection);
    projSeg.setDisabled(s.view === 'cavalier');
    projSeg.el.title = s.view === 'cavalier' ? 'La cavalière est toujours une projection oblique orthographique' : '';
    swItems.set(s.measureItems); swGlobal.set(s.measureGlobal);
    themeSeg.set(s.theme); swShadows.set(s.shadows); swTransp.set(s.transparency);
    angleSeg.set(s.cavalierAngle); ratioSeg.set(s.cavalierRatio);
    stepSeg.set(s.gridCell); swSnapGrid.set(s.snapGrid); swSnapItems.set(s.snapItems);
    swShowGrid.set(s.showGrid); swAxes.set(s.showAxes);
    cotesBtn.classList.toggle('lit', s.measureItems || s.measureGlobal);
  };
  const syncDoc = () => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    if (document.activeElement !== nameInput) { nameInput.value = store.doc.name; fitName(); }
    document.title = `${store.doc.name} — Kallax Designer`;
  };
  store.on(ev => { if (ev === 'settings') sync(); if (ev === 'doc') syncDoc(); });
  sync(); syncDoc();
}

function viewValue(v: ViewPreset): 'iso' | 'cavalier' | 'free' {
  return v === 'iso' || v === 'cavalier' ? v : 'free';
}
