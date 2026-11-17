// Projects: save / open / new / duplicate / delete, stored in the browser
// (localStorage). The working document itself is still auto-saved by the store;
// a "project" is an explicit, named save the user can come back to.
import { store } from '../core/store';
import { uid } from '../core/store';
import type { DesignDoc } from '../core/types';
import { ui } from '../interaction/context';
import { downloadJSON, slug, validDoc } from './file-io';
import { h, toast, MOD } from './dom';
import { icon } from './icons';
import { t, tn, locale } from '../core/i18n';

interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  items: number;
  thumb?: string; // small JPEG data URL
}

const LS_INDEX = 'kallax-designer:projects';
const LS_CURRENT = 'kallax-designer:current-project';
const LS_PROJECT = (id: string) => `kallax-designer:project:${id}`;

// ── storage ────────────────────────────────────────────────
function readIndex(): ProjectMeta[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeIndex(list: ProjectMeta[]) {
  localStorage.setItem(LS_INDEX, JSON.stringify(list));
}
function readProject(id: string): DesignDoc | null {
  try { return JSON.parse(localStorage.getItem(LS_PROJECT(id)) || 'null'); } catch { return null; }
}

let currentId: string | null = localStorage.getItem(LS_CURRENT);
if (currentId && !readIndex().some(p => p.id === currentId)) currentId = null;
let savedJson: string | null = currentId ? JSON.stringify(readProject(currentId)) : null;

const listeners = new Set<() => void>();
export function onProjectsChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const l of listeners) l(); }
store.on(ev => { if (ev === 'doc') emit(); });

function setCurrent(id: string | null, doc: DesignDoc | null) {
  currentId = id;
  savedJson = doc ? JSON.stringify(doc) : null;
  if (id) localStorage.setItem(LS_CURRENT, id); else localStorage.removeItem(LS_CURRENT);
  emit();
}

/** The current document no longer corresponds to a saved project (e.g. after a JSON import). */
export function detachProject() { setCurrent(null, null); }

// ── state ──────────────────────────────────────────────────
export function currentProject(): ProjectMeta | null {
  return currentId ? readIndex().find(p => p.id === currentId) ?? null : null;
}
/** Unsaved changes? An empty, never-saved document is not "dirty". */
export function isDirty(): boolean {
  if (!currentId) return store.doc.items.length > 0;
  return JSON.stringify(store.doc) !== savedJson;
}
export function saveStatus(): string {
  if (!currentId) return store.doc.items.length ? t('prj.statusUnsaved') : t('prj.statusNew');
  return isDirty() ? t('prj.statusModified') : t('prj.statusSaved');
}

// ── thumbnail ──────────────────────────────────────────────
function captureThumb(): Promise<string | undefined> {
  return new Promise(resolve => {
    const vp = ui.viewport;
    let done = false;
    const off = vp.onAfterRender(() => {
      if (done) return;
      done = true;
      queueMicrotask(() => off());
      try {
        const src = vp.getRenderer().domElement;
        const w = 320, hgt = Math.round(w * src.height / Math.max(1, src.width));
        const c = document.createElement('canvas');
        c.width = w; c.height = hgt;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = vp.getTheme().bg;
        ctx.fillRect(0, 0, w, hgt);
        ctx.drawImage(src, 0, 0, w, hgt);
        resolve(c.toDataURL('image/jpeg', 0.78));
      } catch { resolve(undefined); }
    });
    vp.requestRender();
    setTimeout(() => { if (!done) { done = true; off(); resolve(undefined); } }, 600);
  });
}

// ── actions ────────────────────────────────────────────────
/** Save the current document. `asNew` = "Enregistrer sous…". */
export async function saveProject(asNew = false): Promise<boolean> {
  let name = store.doc.name || t('doc.untitled');
  if (asNew || !currentId) {
    const v = await promptName(asNew ? t('prj.saveAsTitle') : t('prj.saveTitle'),
      asNew ? t('doc.copyName', { name }) : name);
    if (v === null) return false;
    name = v;
    if (name !== store.doc.name) store.update(d => { d.name = name; });
  }
  const id = asNew || !currentId ? uid('prj') : currentId;
  const doc = structuredClone(store.doc);
  const thumb = await captureThumb();
  const list = readIndex();
  const now = Date.now();
  const prev = list.find(p => p.id === id);
  const meta: ProjectMeta = { id, name: doc.name, updatedAt: now, createdAt: prev?.createdAt ?? now, items: doc.items.length, thumb };
  try {
    localStorage.setItem(LS_PROJECT(id), JSON.stringify(doc));
    writeIndex([meta, ...list.filter(p => p.id !== id)]);
  } catch {
    // Quota: retry without thumbnail
    try {
      meta.thumb = undefined;
      localStorage.setItem(LS_PROJECT(id), JSON.stringify(doc));
      writeIndex([meta, ...list.filter(p => p.id !== id)]);
    } catch {
      toast(t('prj.storageFullJSON'));
      return false;
    }
  }
  setCurrent(id, doc);
  toast(t('prj.saved', { name: doc.name }));
  return true;
}

/** Ask what to do with unsaved changes. Resolves false if the user cancels. */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const r = await alertSheet({
    title: t('prj.confirmTitle', { name: store.doc.name }),
    message: t('prj.confirmMsg'),
    buttons: [
      { label: t('prj.dontSave'), value: 'discard', kind: 'plain' },
      { label: t('common.cancel'), value: 'cancel', kind: 'plain' },
      { label: t('common.save'), value: 'save', kind: 'primary' },
    ],
  });
  if (r === 'save') return saveProject();
  return r === 'discard';
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  store.newDoc();
  store.clearHistory();
  setCurrent(null, null);
  ui.viewport.setView('iso', true);
  sheet?.close();
  toast(t('prj.newToast'));
}

export async function openProject(id: string) {
  if (id === currentId && !isDirty()) { sheet?.close(); return; }
  if (!(await confirmDiscard())) return;
  const doc = readProject(id);
  if (!doc) { toast(t('prj.notFound')); return; }
  store.loadDoc(doc);
  store.clearHistory();
  setCurrent(id, doc);
  ui.viewport.zoomToFit(true);
  sheet?.close();
  toast(t('file.opened', { name: doc.name }));
}

function duplicateProject(id: string) {
  const doc = readProject(id);
  const meta = readIndex().find(p => p.id === id);
  if (!doc || !meta) return;
  const nid = uid('prj');
  doc.name = t('doc.copyName', { name: doc.name });
  const now = Date.now();
  try {
    localStorage.setItem(LS_PROJECT(nid), JSON.stringify(doc));
    writeIndex([{ ...meta, id: nid, name: doc.name, createdAt: now, updatedAt: now }, ...readIndex()]);
  } catch { toast(t('prj.storageFull')); return; }
  emit();
}

async function deleteProject(id: string) {
  const meta = readIndex().find(p => p.id === id);
  if (!meta) return;
  const r = await alertSheet({
    title: t('prj.deleteTitle', { name: meta.name }),
    message: t('prj.deleteMsg'),
    buttons: [
      { label: t('common.cancel'), value: 'cancel', kind: 'plain' },
      { label: t('common.delete'), value: 'delete', kind: 'destructive' },
    ],
  });
  if (r !== 'delete') return;
  localStorage.removeItem(LS_PROJECT(id));
  writeIndex(readIndex().filter(p => p.id !== id));
  if (id === currentId) setCurrent(null, null); else emit();
}

function renameProject(id: string, name: string) {
  name = name.trim();
  if (!name) return;
  const doc = readProject(id);
  const list = readIndex();
  const meta = list.find(p => p.id === id);
  if (!doc || !meta || meta.name === name) return;
  doc.name = name; meta.name = name;
  localStorage.setItem(LS_PROJECT(id), JSON.stringify(doc));
  writeIndex(list);
  if (id === currentId) {
    store.update(d => { d.name = name; });
    savedJson = JSON.stringify({ ...JSON.parse(savedJson || '{}'), name });
  }
  emit();
}

// ── backups ───────────────────────────────────────────────
interface Backup { kind: 'kallax-designer-backup'; version: 1; exportedAt: string; projects: { name: string; createdAt: number; updatedAt: number; doc: DesignDoc }[] }

export function isBackup(d: unknown): d is Backup {
  const b = d as Backup;
  return !!b && b.kind === 'kallax-designer-backup' && Array.isArray(b.projects);
}

/** Download one saved project as JSON. */
function downloadProject(id: string) {
  const doc = readProject(id);
  if (!doc) return;
  downloadJSON(doc, `${slug(doc.name)}.kallax.json`);
}

/** Download every saved project in one backup file. */
export function exportAllProjects() {
  const list = readIndex();
  if (!list.length) { toast(t('prj.emptyTitle')); return; }
  const backup: Backup = {
    kind: 'kallax-designer-backup', version: 1, exportedAt: new Date().toISOString(),
    projects: list.map(p => ({ name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, doc: readProject(p.id)! })).filter(p => p.doc),
  };
  downloadJSON(backup, `kallax-projects-${new Date().toISOString().slice(0, 10)}.json`);
  toast(t('prj.exportAllDone', { n: backup.projects.length }));
}

/** Restore a backup: every project is added to the library (never overwrites). */
export function importBackup(b: Backup) {
  let n = 0;
  const list = readIndex();
  for (const p of b.projects) {
    if (!validDoc(p.doc)) continue;
    const id = uid('prj');
    try {
      localStorage.setItem(LS_PROJECT(id), JSON.stringify(p.doc));
      list.unshift({ id, name: p.doc.name || p.name, createdAt: p.createdAt || Date.now(), updatedAt: p.updatedAt || Date.now(), items: p.doc.items.length });
      n++;
    } catch { toast(t('prj.storageFull')); break; }
  }
  writeIndex(list);
  emit();
  toast(t('prj.importedN', { n }));
  openProjectsSheet();
}

// ── alert sheet (macOS-style) ──────────────────────────────
interface AlertBtn { label: string; value: string; kind: 'plain' | 'primary' | 'destructive' }
function alertSheet(o: { title: string; message?: string; buttons: AlertBtn[] }): Promise<string> {
  return new Promise(resolve => {
    const btns = o.buttons.map(b => h('button', { type: 'button', class: `alert-btn ${b.kind}` }, b.label));
    const dlg = h('dialog', { class: 'alert' },
      h('div', { class: 'alert-icon' }, icon('cube', 26)),
      h('h2', { class: 'alert-title' }, o.title),
      o.message ? h('p', { class: 'alert-msg' }, o.message) : null,
      h('div', { class: 'alert-btns' }, btns),
    );
    const finish = (v: string) => { dlg.close(); dlg.remove(); resolve(v); };
    btns.forEach((b, i) => b.addEventListener('click', () => finish(o.buttons[i].value)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish('cancel'); });
    document.body.appendChild(dlg);
    dlg.showModal();
    const def = o.buttons.findIndex(b => b.kind !== 'plain');
    (btns[def >= 0 ? def : btns.length - 1]).focus();
  });
}

function promptName(title: string, value: string): Promise<string | null> {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', class: 'alert-input', value, spellcheck: 'false', 'aria-label': t('prj.nameAria') });
    const cancel = h('button', { type: 'button', class: 'alert-btn plain' }, t('common.cancel'));
    const ok = h('button', { type: 'submit', class: 'alert-btn primary' }, t('common.save'));
    const form = h('form', { method: 'dialog', class: 'alert-form' }, input, h('div', { class: 'alert-btns' }, cancel, ok));
    const dlg = h('dialog', { class: 'alert' },
      h('div', { class: 'alert-icon' }, icon('cube', 26)),
      h('h2', { class: 'alert-title' }, title),
      form,
    );
    const finish = (v: string | null) => { dlg.close(); dlg.remove(); resolve(v); };
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(input.value.trim() || t('doc.untitled')); });
    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    input.addEventListener('keydown', e => e.stopPropagation());
    document.body.appendChild(dlg);
    dlg.showModal();
    input.select();
  });
}

// ── "Mes projets" sheet ────────────────────────────────────
let sheet: { open(): void; close(): void } | null = null;

function relTime(time: number): string {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return t('prj.justNow');
  const m = Math.round(s / 60); if (m < 60) return t('prj.minAgo', { n: m });
  const hr = Math.round(m / 60); if (hr < 24) return t('prj.hoursAgo', { n: hr });
  return new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function buildProjectsSheet(hooks: { importJSON(): void }) {
  const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': t('common.close') }, icon('xmark', 14));
  const newBtn = h('button', { type: 'button', class: 'proj-new' }, icon('docNew', 15), t('prj.new'));
  const importBtn = h('button', { type: 'button', class: 'proj-ghost' }, icon('folder', 15), t('prj.import'));
  const exportAllBtn = h('button', { type: 'button', class: 'proj-ghost' }, icon('download', 15), t('prj.exportAll'));
  exportAllBtn.addEventListener('click', () => exportAllProjects());
  const grid = h('div', { class: 'proj-grid' });
  const dlg = h('dialog', { class: 'sheet proj-sheet', 'aria-labelledby': 'proj-title' },
    h('div', { class: 'sheet-head' }, icon('folder', 18), h('h2', { id: 'proj-title' }, t('prj.title')), exportAllBtn, importBtn, newBtn, close),
    grid,
    h('p', { class: 'proj-foot' }, t('prj.foot', { mod: MOD })),
  );
  const doClose = () => {
    if (!dlg.open) return;
    dlg.classList.add('closing');
    setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 160);
  };
  close.addEventListener('click', doClose);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) doClose(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); doClose(); });
  newBtn.addEventListener('click', () => newProject());
  importBtn.addEventListener('click', () => { doClose(); hooks.importJSON(); });
  document.body.appendChild(dlg);

  const render = () => {
    grid.replaceChildren();
    const list = readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      grid.append(h('div', { class: 'proj-empty' }, icon('folder', 28),
        h('strong', null, t('prj.emptyTitle')),
        h('span', null, t('prj.emptySub', { mod: MOD }))));
      return;
    }
    for (const p of list) {
      const name = h('input', { class: 'proj-name', value: p.name, spellcheck: 'false', 'aria-label': t('common.rename'), readonly: '' });
      const dup = h('button', { type: 'button', class: 'proj-act', 'aria-label': t('common.duplicate'), title: t('common.duplicate') }, icon('duplicate', 14));
      const dl = h('button', { type: 'button', class: 'proj-act', 'aria-label': t('prj.download'), title: t('prj.download') }, icon('download', 14));
      dl.addEventListener('click', () => downloadProject(p.id));
      const del = h('button', { type: 'button', class: 'proj-act danger', 'aria-label': t('common.delete'), title: t('common.delete') }, icon('trash', 14));
      const thumb = h('button', { type: 'button', class: 'proj-thumb', 'aria-label': t('prj.open', { name: p.name }) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : icon('cube', 30));
      const card = h('div', { class: `proj-card${p.id === currentId ? ' current' : ''}` },
        thumb,
        h('div', { class: 'proj-info' },
          name,
          h('div', { class: 'proj-meta' },
            `${tn('prj.items', p.items)} · ${relTime(p.updatedAt)}`,
            p.id === currentId ? h('span', { class: 'proj-badge' }, t('prj.openBadge')) : null),
        ),
        h('div', { class: 'proj-acts' }, dl, dup, del),
      );
      thumb.addEventListener('click', () => openProject(p.id));
      name.addEventListener('dblclick', () => { name.readOnly = false; name.select(); });
      name.addEventListener('click', () => { if (name.readOnly) openProject(p.id); });
      name.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') name.blur();
        if (e.key === 'Escape') { name.value = p.name; name.blur(); }
      });
      name.addEventListener('blur', () => { name.readOnly = true; renameProject(p.id, name.value); });
      dup.addEventListener('click', () => duplicateProject(p.id));
      del.addEventListener('click', () => deleteProject(p.id));
      grid.append(card);
    }
  };
  onProjectsChange(() => { if (dlg.open) render(); });

  sheet = {
    open() { render(); if (!dlg.open) dlg.showModal(); },
    close: doClose,
  };
  return sheet;
}

export function openProjectsSheet() { sheet?.open(); }
