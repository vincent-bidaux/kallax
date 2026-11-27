// Unified toolbar: document, undo/redo, view + projection, popovers, menu.
import { store } from '../core/store';
import type { ViewPreset } from '../core/types';
import { h, MOD, SHIFT } from './dom';
import { icon } from './icons';
import { button, segmented, switchRow, tip } from './controls';
import { Popover, fillMenu } from './popover';
import * as cmd from '../interaction/commands';
import { openJSON, exportJSON, exportPNG } from './file-io';
import { newProject, saveProject, openProjectsSheet, onProjectsChange, saveStatus, isDirty } from './projects';
import { t, lang, setLang, type Lang } from '../core/i18n';
import { buildAccountButton } from './account';
import { addSelectionToComponents } from './components';
import { selectionHasGroups } from '../core/groups';
import type { MenuItem } from './popover';
import { toggleWalk } from '../interaction/walk/walk-mode';

export interface ToolbarHooks {
  toggleSidebar(): void;
  toggleInspector(): void;
  openShortcuts(): void;
}

export function buildToolbar(host: HTMLElement, hooks: ToolbarHooks) {
  // ── left: sidebar toggle, glyph, document name, projects / account, undo/redo ──
  const sideBtn = button({ icon: 'sidebarLeft', label: t('tb.toggleSidebar'), iconOnly: true, cls: 'tb-btn', iconSize: 18, onClick: hooks.toggleSidebar });
  const glyph = h('div', { class: 'app-glyph', 'aria-hidden': 'true' }, icon('cube', 17));
  const nameInput = h('input', {
    class: 'doc-name', type: 'text', value: store.doc.name, spellcheck: 'false',
    'aria-label': t('tb.docName'), size: '1',
  });
  const sizer = h('span', { class: 'doc-name-sizer', 'aria-hidden': 'true' });
  const nameWrap = h('div', { class: 'doc-name-wrap' }, sizer, nameInput);
  const fitName = () => { sizer.textContent = nameInput.value || ' '; };
  nameInput.addEventListener('input', fitName);
  const commitName = () => {
    const v = nameInput.value.trim() || t('doc.untitled');
    if (v !== store.doc.name) store.update(d => { d.name = v; });
    nameInput.value = v; fitName();
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    if (e.key === 'Escape') { nameInput.value = store.doc.name; nameInput.blur(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('blur', commitName);
  const docSub = h('div', { class: 'doc-sub' }, t('app.title'));
  const docBlock = h('div', { class: 'doc-block' }, nameWrap, docSub);

  const undoBtn = button({ icon: 'undo', label: t('tb.undo'), iconOnly: true, kbd: `${MOD}Z`, cls: 'tb-btn', iconSize: 18, onClick: () => store.undo() });
  const redoBtn = button({ icon: 'redo', label: t('tb.redo'), iconOnly: true, kbd: `${SHIFT}${MOD}Z`, cls: 'tb-btn', iconSize: 18, onClick: () => store.redo() });
  const history = h('div', { class: 'tb-group' }, undoBtn, redoBtn);
  const projBtn = button({ icon: 'folder', label: t('tb.projects'), iconOnly: true, kbd: `${MOD}O`, cls: 'tb-btn', iconSize: 18, onClick: openProjectsSheet });
  const saveBtn = button({ icon: 'floppy', label: t('tb.save'), iconOnly: true, kbd: `${MOD}S`, cls: 'tb-btn', iconSize: 18, onClick: () => saveProject() });
  const moreBtn = button({ icon: 'moreCircle', label: t('tb.more'), iconOnly: true, cls: 'tb-btn', iconSize: 19 });
  const accountBtn = buildAccountButton({ openProjects: openProjectsSheet });
  const files = h('div', { class: 'tb-group' }, projBtn, saveBtn, moreBtn, accountBtn);

  // ── center: view + projection ──
  const viewSeg = segmented<'iso' | 'cavalier' | 'free'>({
    ariaLabel: t('tb.view'),
    options: [
      { value: 'iso', label: t('view.iso'), tip: t('view.isoTip'), kbd: '1' },
      { value: 'cavalier', label: t('view.cavalier'), tip: t('view.cavalierTip'), kbd: '2' },
      { value: 'free', label: t('view.free'), tip: t('view.freeTip') },
    ],
    value: viewValue(store.settings.view),
    onChange: (v) => cmd.setView(v),
    cls: 'seg-view',
  });
  const projSeg = segmented<'perspective' | 'orthographic'>({
    ariaLabel: t('tb.projection'),
    options: [
      { value: 'perspective', label: t('proj.persp'), tip: t('proj.perspTip'), kbd: 'P' },
      { value: 'orthographic', label: t('proj.ortho'), tip: t('proj.orthoTip'), kbd: 'P' },
    ],
    value: store.settings.projection,
    onChange: (v) => cmd.setProjection(v),
    cls: 'seg-proj',
  });
  // first-person walk: a separate action (not a camera preset), right of the projection
  const walkBtn = button({ icon: 'walk', label: t('walk.button'), tip: t('walk.buttonTip'), kbd: 'V', cls: 'tb-btn tb-pill tb-walk', iconSize: 17, onClick: toggleWalk });
  const center = h('div', { class: 'tb-center' },
    h('div', { class: 'tb-labeled' }, viewSeg.el),
    h('div', { class: 'tb-labeled' }, projSeg.el),
    walkBtn);

  // ── right: popovers ──
  const cotesBtn = button({ icon: 'ruler', label: t('tb.dims'), tip: t('tb.dims'), cls: 'tb-btn tb-pill', iconSize: 17 });
  const renduBtn = button({ icon: 'render', label: t('tb.render'), tip: t('tb.renderTip'), cls: 'tb-btn tb-pill', iconSize: 17 });
  const grilleBtn = button({ icon: 'grid', label: t('tb.grid'), tip: t('tb.gridTip'), cls: 'tb-btn tb-pill', iconSize: 17 });
  const fitBtn = button({ icon: 'fit', label: t('tb.fit'), tip: t('tb.fitTip'), kbd: 'F', cls: 'tb-btn tb-pill', iconSize: 17, onClick: () => cmd.zoomToFit() });
  const inspBtn = button({ icon: 'sidebarRight', label: t('tb.toggleInspector'), iconOnly: true, cls: 'tb-btn', iconSize: 18, onClick: hooks.toggleInspector });

  // Cotes
  const cotes = new Popover(cotesBtn, { title: t('tb.dims'), width: 280 });
  const swItems = switchRow({ label: t('dims.items'), hint: t('dims.itemsHint'), icon: 'ruler', kbd: 'M', value: store.settings.measureItems, onChange: v => store.setSettings({ measureItems: v }) });
  const swGlobal = switchRow({ label: t('dims.global'), hint: t('dims.globalHint'), icon: 'fit', value: store.settings.measureGlobal, onChange: v => store.setSettings({ measureGlobal: v }) });
  cotes.body.append(h('div', { class: 'group' }, swItems.el, swGlobal.el));

  // Rendu
  const rendu = new Popover(renduBtn, { title: t('tb.render'), width: 300 });
  const themeSeg = segmented<'blueprint' | 'paper'>({
    ariaLabel: t('render.theme'), value: store.settings.theme,
    options: [{ value: 'blueprint', label: t('render.blueprint') }, { value: 'paper', label: t('render.paper') }],
    onChange: v => store.setSettings({ theme: v }),
  });
  const swShadows = switchRow({ label: t('render.shadows'), hint: t('render.shadowsHint'), icon: 'shadow', value: store.settings.shadows, onChange: v => store.setSettings({ shadows: v }) });
  const swTransp = switchRow({ label: t('render.transparency'), hint: t('render.transparencyHint'), icon: 'transparency', value: store.settings.transparency, onChange: v => store.setSettings({ transparency: v }) });
  const swFinish = switchRow({ label: t('render.finishColors'), hint: t('render.finishColorsHint'), icon: 'swatch', value: store.settings.finishColors, onChange: v => store.setSettings({ finishColors: v }) });
  const angleSeg = segmented<number>({
    ariaLabel: t('render.angleAria'), size: 'sm', value: store.settings.cavalierAngle,
    options: [30, 45, 60].map(a => ({ value: a, label: `${a}°` })),
    onChange: v => store.setSettings({ cavalierAngle: v }),
  });
  const ratioSeg = segmented<number>({
    ariaLabel: t('render.ratioAria'), size: 'sm', value: store.settings.cavalierRatio,
    options: [{ value: 1, label: t('render.ratioCavalier') }, { value: 0.5, label: t('render.ratioCabinet') }],
    onChange: v => store.setSettings({ cavalierRatio: v }),
  });
  rendu.body.append(
    h('div', { class: 'pop-label' }, t('render.theme')), themeSeg.el,
    h('div', { class: 'group' }, swShadows.el, swTransp.el, swFinish.el),
    h('div', { class: 'pop-label' }, t('render.cavalier')),
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'row-text' }, t('render.angle'))), angleSeg.el),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'row-text' }, t('render.ratio'))), ratioSeg.el)),
  );

  // Grille
  const grille = new Popover(grilleBtn, { title: t('tb.grid'), width: 300 });
  const stepSeg = segmented<number>({
    ariaLabel: t('grid.stepAria'), value: store.settings.gridCell,
    options: [1, 5, 10, 35].map(v => ({ value: v, label: `${v} cm`, tip: v === 35 ? t('grid.kallaxPitch') : undefined })),
    onChange: v => store.setSettings({ gridCell: v }),
  });
  const swSnapGrid = switchRow({ label: t('grid.snapGrid'), icon: 'grid', value: store.settings.snapGrid, onChange: v => store.setSettings({ snapGrid: v }) });
  const swSnapItems = switchRow({ label: t('grid.snapItems'), hint: t('grid.snapItemsHint'), icon: 'magnet', value: store.settings.snapItems, onChange: v => store.setSettings({ snapItems: v }) });
  const swShowGrid = switchRow({ label: t('grid.show'), kbd: 'G', icon: 'grid', value: store.settings.showGrid, onChange: v => store.setSettings({ showGrid: v }) });
  const swAxes = switchRow({ label: t('grid.origin'), hint: t('grid.originHint'), icon: 'target', value: store.settings.showAxes, onChange: v => store.setSettings({ showAxes: v }) });
  grille.body.append(
    h('div', { class: 'pop-label' }, t('grid.step')), stepSeg.el,
    h('div', { class: 'group' }, swSnapGrid.el, swSnapItems.el),
    h('div', { class: 'group' }, swShowGrid.el, swAxes.el),
  );

  // … menu
  const menu = new Popover(moreBtn, { role: 'menu', cls: 'menu-pop', width: 264, align: 'start' });
  const menuItems = (): MenuItem[] => [
    { label: t('menu.newProject'), icon: 'docNew', action: () => newProject() },
    { label: t('menu.projects'), icon: 'folder', kbd: `${MOD}O`, action: openProjectsSheet },
    { label: t('menu.save'), icon: 'floppy', kbd: `${MOD}S`, action: () => saveProject(), separatorBefore: true },
    { label: t('menu.saveAs'), icon: 'floppy', kbd: `${SHIFT}${MOD}S`, action: () => saveProject(true) },
    { label: t('menu.importJSON'), icon: 'folder', action: openJSON, separatorBefore: true },
    { label: t('menu.exportJSON'), icon: 'download', action: exportJSON },
    { label: t('menu.exportPNG'), icon: 'photo', action: exportPNG },
    // Édition: groups + components (state follows the selection)
    { label: t('group.group'), icon: 'group', kbd: `${MOD}G`, action: () => cmd.groupSelection(), separatorBefore: true, heading: t('menu.edit'),
      disabled: store.selection.length < 2 },
    { label: t('group.ungroup'), icon: 'ungroup', kbd: `${SHIFT}${MOD}G`, action: () => cmd.ungroupSelection(),
      disabled: !selectionHasGroups(store.selection, store.items) },
    { label: `${t('comp.addTitle')}…`, icon: 'component', action: () => { void addSelectionToComponents(); }, disabled: !store.selection.length },
    { label: t('menu.shortcuts'), icon: 'keyboard', kbd: '?', action: hooks.openShortcuts, separatorBefore: true },
    // Language: two checkable items (labels in their own language, like macOS)
    ...(([['fr', 'Français'], ['en', 'English']] as [Lang, string][]).map(([l, label], i) => ({
      label, lang: l, checked: lang === l, heading: i === 0 ? t('menu.language') : undefined,
      separatorBefore: i === 0, action: () => setLang(l),
    }))),
  ];
  fillMenu(menu, menuItems());
  menu.onOpen = () => { menu.body.replaceChildren(); fillMenu(menu, menuItems()); };

  const right = h('div', { class: 'tb-right' },
    h('div', { class: 'tb-group' }, cotesBtn, renduBtn, grilleBtn),
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }),
    fitBtn,
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }),
    inspBtn);

  // left: sidebar · glyph + document · projects / save / … / account · undo / redo
  const left = h('div', { class: 'tb-left' }, sideBtn, glyph, docBlock,
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }), files,
    h('div', { class: 'tb-sep', 'aria-hidden': 'true' }), history);
  host.append(left, center, right);
  host.setAttribute('role', 'toolbar');
  host.setAttribute('aria-label', t('tb.aria'));
  tip(sideBtn, t('tb.sidebarTip'));
  tip(inspBtn, t('inspector.title'));
  tip(moreBtn, t('tb.moreTip'));

  // ── sync ──
  const sync = () => {
    const s = store.settings;
    viewSeg.set(viewValue(s.view));
    projSeg.set(s.view === 'cavalier' ? 'orthographic' : s.projection);
    projSeg.setDisabled(s.view === 'cavalier');
    projSeg.el.title = s.view === 'cavalier' ? t('tb.cavalierOrtho') : '';
    swItems.set(s.measureItems); swGlobal.set(s.measureGlobal);
    themeSeg.set(s.theme); swShadows.set(s.shadows); swTransp.set(s.transparency); swFinish.set(s.finishColors);
    angleSeg.set(s.cavalierAngle); ratioSeg.set(s.cavalierRatio);
    stepSeg.set(s.gridCell); swSnapGrid.set(s.snapGrid); swSnapItems.set(s.snapItems);
    swShowGrid.set(s.showGrid); swAxes.set(s.showAxes);
    cotesBtn.classList.toggle('lit', s.measureItems || s.measureGlobal);
  };
  const syncDoc = () => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    if (document.activeElement !== nameInput) { nameInput.value = store.doc.name; fitName(); }
    document.title = `${isDirty() ? '• ' : ''}${store.doc.name} — ${t('app.title')}`;
    docSub.textContent = saveStatus();
    docSub.classList.toggle('dirty', isDirty());
    saveBtn.classList.toggle('dirty', isDirty());
  };
  onProjectsChange(syncDoc);
  store.on(ev => { if (ev === 'settings') sync(); if (ev === 'doc') syncDoc(); });
  sync(); syncDoc();
}

function viewValue(v: ViewPreset): 'iso' | 'cavalier' | 'free' {
  return v === 'iso' || v === 'cavalier' ? v : 'free';
}
