// Projects: save / open / new / duplicate / delete / rename / download / backup.
// A "project" is an explicit, named save the user can come back to; the working
// document itself is still auto-saved in localStorage by the store.
//
// Where projects live depends on the account (see project-store.ts):
//   signed out (or accounts unavailable) → this browser (localStorage)
//   signed in                            → the account, through the API
import { store, uid } from '../core/store';
import type { DesignDoc } from '../core/types';
import { ui } from '../interaction/context';
import { downloadJSON, slug, validDoc } from './file-io';
import { h, toast, MOD } from './dom';
import { icon } from './icons';
import { t, tn, locale } from '../core/i18n';
import { alertSheet, promptName as promptText } from './dialogs';
import { ApiError } from './api';
import {
  localBackend, accountBackend, mapLimit, StorageFullError,
  type ProjectBackend, type ProjectMeta,
} from './project-store';
import {
  accountReady, accountState, currentUser, onAccountChange, openSignIn, handleUnauthorized,
  ACCOUNT_HOST, ACCOUNT_URL,
} from './account';

export type { ProjectMeta };

const LS_CURRENT = 'kallax-designer:current-project';
const LS_IMPORTED = (email: string) => `kallax-designer:imported:${email.toLowerCase()}`;

// ── active backend + list cache ────────────────────────────
let backend: ProjectBackend = localBackend;
/** Project list of the active backend (null = not loaded yet). */
let cache: ProjectMeta[] | null = null;
let loading: Promise<void> | null = null;
let loadFailed = false;

const listeners = new Set<() => void>();
export function onProjectsChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const l of listeners) l(); }
store.on(ev => { if (ev === 'doc') emit(); });

/** Reload the list of the active backend. */
let loadToken = 0;
function refresh(): Promise<void> {
  const b = backend;
  const token = ++loadToken;
  const p: Promise<void> = (async () => {
    try {
      const list = await b.list();
      if (b !== backend) return;
      cache = list;
      loadFailed = false;
    } catch (e) {
      if (b !== backend) return;
      loadFailed = true;
      report(e, 'load');
    } finally {
      if (token === loadToken) loading = null;
      emit();
    }
  })();
  loading = p;
  emit();
  return p;
}
function upsertCache(meta: ProjectMeta) {
  if (cache) cache = [meta, ...cache.filter(p => p.id !== meta.id)];
}
function cachedMeta(id: string) { return cache?.find(p => p.id === id); }

// ── current project ────────────────────────────────────────
// The document open in the editor may correspond to a saved project of the
// active backend: `current`. `savedJson` is that project as last saved / opened;
// at startup only its hash is known (persisted with the id).
interface Current { id: string; scope: string; hash: string }
let current: Current | null = null;
let savedJson: string | null = null;
let saving = false;

/** cyrb53 — small fast string hash, enough to tell "modified" apart. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function persistCurrent() {
  try {
    if (current) localStorage.setItem(LS_CURRENT, JSON.stringify(current));
    else localStorage.removeItem(LS_CURRENT);
  } catch { /* ignore */ }
}

function setCurrent(id: string | null, doc: DesignDoc | null, json?: string) {
  if (id) {
    savedJson = json ?? JSON.stringify(doc);
    current = { id, scope: backend.scope, hash: hash(savedJson) };
  } else {
    current = null;
    savedJson = null;
  }
  persistCurrent();
  emit();
}

// Startup: restore the current project. Legacy format = a bare local id.
(function restoreCurrent() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LS_CURRENT); } catch { /* ignore */ }
  if (!raw) return;
  let c: Current | null = null;
  try { const v = JSON.parse(raw); if (v && typeof v.id === 'string') c = v; } catch { /* legacy */ }
  if (!c) {
    const doc = localBackend.readSync(raw);
    if (!doc || !localBackend.listSync().some(p => p.id === raw)) return;
    savedJson = JSON.stringify(doc);
    c = { id: raw, scope: 'local', hash: hash(savedJson) };
  } else if (c.scope === 'local' && !localBackend.listSync().some(p => p.id === c!.id)) return;
  // An account project stays "pending" until GET /api/me confirms the same account (no status flash).
  current = c;
  persistCurrent();
})();

/** The current document no longer corresponds to a saved project (e.g. after a JSON import). */
export function detachProject() { setCurrent(null, null); }

export function currentProject(): ProjectMeta | null {
  return current ? cachedMeta(current.id) ?? null : null;
}
/** Unsaved changes? An empty, never-saved document is not "dirty". */
export function isDirty(): boolean {
  if (!current) return store.doc.items.length > 0;
  const j = JSON.stringify(store.doc);
  return savedJson !== null ? j !== savedJson : hash(j) !== current.hash;
}
export function saveStatus(): string {
  if (saving) return t('prj.statusSaving');
  if (!current) return store.doc.items.length ? t('prj.statusUnsaved') : t('prj.statusNew');
  return isDirty() ? t('prj.statusModified') : t('prj.statusSaved');
}

// ── account switching ──────────────────────────────────────
/** The local project detached by a sign-in, re-attached if the import uploads it. */
let detachedLocal: { id: string; json: string | null; hash: string } | null = null;

onAccountChange(({ user, reason }) => {
  const next = user ? accountBackend(user.email) : localBackend;
  if (next.scope !== backend.scope) {
    backend = next;
    cache = null;
    loadFailed = false;
  }
  // The open document stays open; it is just no longer a saved project of the active backend.
  if (current && current.scope !== backend.scope) {
    detachedLocal = current.scope === 'local' ? { id: current.id, json: savedJson, hash: current.hash } : null;
    setCurrent(null, null);
  } else emit();
  if (sheetOpen()) void refresh();
  if (reason === 'signin' && user) void offerImport(user.email);
});

/** Local projects this account was never offered / given. */
function pendingLocal(email: string): ProjectMeta[] {
  let known: string[] = [];
  try { known = JSON.parse(localStorage.getItem(LS_IMPORTED(email)) || '[]'); } catch { /* ignore */ }
  const seen = new Set(Array.isArray(known) ? known : []);
  return localBackend.listSync().filter(p => !seen.has(p.id));
}
function rememberOffered(email: string, ids: string[]) {
  let known: string[] = [];
  try { known = JSON.parse(localStorage.getItem(LS_IMPORTED(email)) || '[]'); } catch { /* ignore */ }
  const all = [...new Set([...(Array.isArray(known) ? known : []), ...ids])];
  try { localStorage.setItem(LS_IMPORTED(email), JSON.stringify(all)); } catch { /* ignore */ }
}

/** After sign-in: offer once to copy this browser's projects into the account (local copies are kept). */
async function offerImport(email: string) {
  const pending = pendingLocal(email);
  if (!pending.length) return;
  const r = await alertSheet({
    icon: 'cloud',
    title: tn('acct.importTitle', pending.length),
    message: t('acct.importMsg', { email }),
    buttons: [
      { label: t('acct.importLater'), value: 'later', kind: 'plain' },
      { label: t('acct.importDo'), value: 'import', kind: 'primary' },
    ],
  });
  if (currentUser()?.email !== email) return; // signed out meanwhile
  if (r !== 'import') { rememberOffered(email, pending.map(p => p.id)); return; }
  const b = backend;
  const res = await mapLimit(pending, 3, async (p) => {
    const doc = localBackend.readSync(p.id);
    if (!doc) return null;
    // Same id as the local copy: importing twice overwrites instead of duplicating.
    return b.write({ id: p.id, name: p.name, items: doc.items.length, thumb: p.thumb, createdAt: p.createdAt }, doc);
  });
  const done = pending.filter((_, i) => res[i].status === 'fulfilled');
  const failed = res.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  rememberOffered(email, done.map(p => p.id));
  if (b !== backend) return;
  if (failed && done.length === 0) { report(failed.reason, 'import'); return; }
  toast(failed ? t('acct.importPartial', { n: done.length, total: pending.length }) : tn('acct.imported', done.length), 3000);
  // The document that was open is now in the account: attach it again.
  if (detachedLocal && !current && done.some(p => p.id === detachedLocal!.id)) {
    current = { id: detachedLocal.id, scope: backend.scope, hash: detachedLocal.hash };
    savedJson = detachedLocal.json;
    persistCurrent();
  }
  detachedLocal = null;
  await refresh();
}

// ── errors ─────────────────────────────────────────────────
type Op = 'save' | 'load' | 'open' | 'delete' | 'other' | 'import';
function report(e: unknown, op: Op) {
  if (e instanceof StorageFullError) { toast(op === 'save' ? t('prj.storageFullJSON') : t('prj.storageFull'), 3200); return; }
  const code = e instanceof ApiError ? e.code : 'other';
  if (code === 'unauthorized') {
    handleUnauthorized(op === 'save');
    if (op === 'save') toast(t('prj.notSavedSession'), 3600);
    return;
  }
  if (code === 'network') toast(op === 'save' ? t('prj.saveOffline') : t('net.offline'), 3200);
  else if (code === 'too_large') toast(t('prj.tooLarge'), 3600);
  else if (code === 'not_found') toast(t('prj.notFound'));
  else { console.error(e); toast(op === 'save' ? t('prj.saveFailed') : t('net.server'), 3200); }
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
  if (saving) return false;
  await accountReady;
  let name = store.doc.name || t('doc.untitled');
  const isNew = asNew || !current;
  if (isNew) {
    const v = await promptText({
      title: asNew ? t('prj.saveAsTitle') : t('prj.saveTitle'),
      value: asNew ? t('doc.copyName', { name }) : name,
      note: saveWhere(), noteIcon: currentUser() ? 'cloud' : 'laptop',
    });
    if (v === null) return false;
    name = v;
    if (name !== store.doc.name) store.update(d => { d.name = name; });
  }
  const b = backend;
  const id = isNew ? uid('prj') : current!.id;
  const doc = structuredClone(store.doc);
  const json = JSON.stringify(doc);
  saving = true; emit();
  try {
    const thumb = await captureThumb();
    const meta = await b.write({ id, name: doc.name, items: doc.items.length, thumb, createdAt: isNew ? Date.now() : undefined }, doc);
    if (b !== backend) return false; // signed out meanwhile
    upsertCache(meta);
    saving = false;
    setCurrent(id, doc, json);
    toast(t(b.kind === 'account' ? 'prj.savedAccount' : 'prj.saved', { name: doc.name }));
    return true;
  } catch (e) {
    report(e, 'save');
    return false;
  } finally {
    saving = false;
    emit();
  }
}

function saveWhere(): string {
  return currentUser() ? t('prj.whereAccount') : t('prj.whereLocal');
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

let opening = false;
export async function openProject(id: string) {
  await accountReady;
  if (current && id === current.id && !isDirty()) { sheet?.close(); return; }
  if (opening || !(await confirmDiscard())) return;
  const b = backend;
  opening = true;
  sheet?.setBusy(id);
  let doc: DesignDoc | null;
  try { doc = await b.read(id); } catch (e) { report(e, 'open'); return; }
  finally { opening = false; sheet?.setBusy(null); }
  if (b !== backend) return;
  if (!doc || !validDoc(doc)) { toast(t('prj.notFound')); return; }
  store.loadDoc(doc);
  store.clearHistory();
  setCurrent(id, store.doc); // as loaded (default names follow the current language)
  ui.viewport.zoomToFit(true);
  sheet?.close();
  toast(t('file.opened', { name: doc.name }));
}

async function duplicateProject(id: string) {
  const b = backend;
  const meta = cachedMeta(id);
  try {
    const doc = await b.read(id);
    if (!doc || !meta) { toast(t('prj.notFound')); return; }
    doc.name = t('doc.copyName', { name: doc.name });
    const m = await b.write({ id: uid('prj'), name: doc.name, items: doc.items.length, thumb: meta.thumb, createdAt: Date.now() }, doc);
    if (b === backend) { upsertCache(m); emit(); }
  } catch (e) { report(e, 'other'); }
}

async function deleteProject(id: string) {
  const meta = cachedMeta(id);
  if (!meta) return;
  const r = await alertSheet({
    title: t('prj.deleteTitle', { name: meta.name }),
    message: backend.kind === 'account' ? t('prj.deleteMsgAccount') : t('prj.deleteMsg'),
    buttons: [
      { label: t('common.cancel'), value: 'cancel', kind: 'plain' },
      { label: t('common.delete'), value: 'delete', kind: 'destructive' },
    ],
  });
  if (r !== 'delete') return;
  const b = backend;
  try { await b.remove(id); } catch (e) { report(e, 'delete'); return; }
  if (b !== backend) return;
  if (cache) cache = cache.filter(p => p.id !== id);
  if (current?.id === id) setCurrent(null, null); else emit();
}

async function renameProject(id: string, name: string) {
  name = name.trim();
  const meta = cachedMeta(id);
  if (!name || !meta || meta.name === name) return;
  const b = backend;
  const old = meta.name;
  meta.name = name; emit(); // optimistic
  try {
    const doc = await b.read(id);
    if (!doc) { toast(t('prj.notFound')); return; }
    doc.name = name;
    const m = await b.write({ id, name, items: doc.items.length, thumb: meta.thumb }, doc);
    if (b !== backend) return;
    if (cache) cache = cache.map(p => (p.id === id ? { ...m, thumb: m.thumb ?? meta.thumb } : p));
    if (current?.id === id) {
      store.update(d => { d.name = name; });
      if (savedJson) savedJson = JSON.stringify({ ...JSON.parse(savedJson), name });
      current.hash = hash(savedJson ?? JSON.stringify(store.doc));
      persistCurrent();
    }
    emit();
  } catch (e) {
    meta.name = old; emit();
    report(e, 'other');
  }
}

// ── backups ───────────────────────────────────────────────
interface Backup { kind: 'kallax-designer-backup'; version: 1; exportedAt: string; projects: { name: string; createdAt: number; updatedAt: number; doc: DesignDoc }[] }

export function isBackup(d: unknown): d is Backup {
  const b = d as Backup;
  return !!b && b.kind === 'kallax-designer-backup' && Array.isArray(b.projects);
}

/** Download one saved project as JSON. */
async function downloadProject(id: string) {
  try {
    const doc = await backend.read(id);
    if (!doc) { toast(t('prj.notFound')); return; }
    downloadJSON(doc, `${slug(doc.name)}.kallax.json`);
  } catch (e) { report(e, 'other'); }
}

/** Download every saved project in one backup file. */
export async function exportAllProjects() {
  await accountReady;
  const b = backend;
  try {
    const list = cache ?? await b.list();
    if (!list.length) { toast(t('prj.emptyTitle')); return; }
    const docs = await mapLimit(list, 4, p => b.read(p.id));
    const failed = docs.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    if (failed) throw failed.reason;
    const backup: Backup = {
      kind: 'kallax-designer-backup', version: 1, exportedAt: new Date().toISOString(),
      projects: list.map((p, i) => {
        const d = docs[i];
        return { name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, doc: d.status === 'fulfilled' ? d.value! : null! };
      }).filter(p => p.doc),
    };
    downloadJSON(backup, t('file.backupName', { date: new Date().toISOString().slice(0, 10) }));
    toast(t('prj.exportAllDone', { n: backup.projects.length }));
  } catch (e) { report(e, 'other'); }
}

/** Restore a backup: every project is added to the active library (never overwrites). */
export async function importBackup(bk: Backup) {
  await accountReady;
  const b = backend;
  const valid = bk.projects.filter(p => validDoc(p.doc));
  const res = await mapLimit(valid, 3, p => b.write(
    { id: uid('prj'), name: p.doc.name || p.name, items: p.doc.items.length, createdAt: p.createdAt || Date.now() }, p.doc));
  const n = res.filter(r => r.status === 'fulfilled').length;
  const failed = res.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  if (failed) report(failed.reason, 'import');
  toast(t('prj.importedN', { n }));
  if (b === backend) { await refresh(); openProjectsSheet(); }
}

// ── "Mes projets" sheet ────────────────────────────────────
let sheet: { open(): void; close(): void; setBusy(id: string | null): void } | null = null;
let sheetDlg: HTMLDialogElement | null = null;
const sheetOpen = () => !!sheetDlg?.open;

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
  exportAllBtn.addEventListener('click', () => { void exportAllProjects(); });
  const where = h('span', { class: 'proj-where' });
  const banner = h('div', { class: 'proj-banner', hidden: true });
  const grid = h('div', { class: 'proj-grid', 'aria-live': 'polite', 'aria-busy': 'false' });
  const foot = h('p', { class: 'proj-foot' });
  const dlg = h('dialog', { class: 'sheet proj-sheet', 'aria-labelledby': 'proj-title' },
    h('div', { class: 'sheet-head' },
      icon('folder', 18),
      h('div', { class: 'proj-title-wrap' }, h('h2', { id: 'proj-title' }, t('prj.title')), where),
      exportAllBtn, importBtn, newBtn, close),
    banner,
    grid,
    foot,
  );
  sheetDlg = dlg;
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

  let busyId: string | null = null;

  const renderChrome = () => {
    const u = currentUser();
    const st = accountState();
    where.replaceChildren(
      icon(u ? 'cloud' : 'laptop', 13),
      h('span', null, u ? t('prj.whereAccountShort') : t('prj.whereLocalShort')),
      ...(u ? [h('span', { class: 'proj-where-email', title: u.email }, u.email)] : []));
    where.classList.toggle('account', !!u);
    // sign-in call to action
    banner.replaceChildren();
    banner.hidden = !!u || st === 'unknown';
    if (!u && st === 'signedOut') {
      const cta = h('button', { type: 'button', class: 'proj-new proj-cta' }, icon('personCircle', 15), t('auth.signIn'));
      cta.addEventListener('click', () => { void openSignIn(); });
      banner.append(icon('cloud', 18), h('div', { class: 'proj-banner-text' },
        h('strong', null, t('prj.ctaTitle')), h('span', null, t('prj.ctaSub'))), cta);
    } else if (!u && st === 'unavailable') {
      banner.append(icon('cloud', 18), h('div', { class: 'proj-banner-text' },
        h('strong', null, t('prj.ctaTitle')),
        h('span', null, t('prj.ctaElsewhere'), ' ',
          h('a', { href: ACCOUNT_URL, target: '_blank', rel: 'noopener' }, ACCOUNT_HOST), '.')));
    }
    foot.textContent = u ? t('prj.footAccount', { mod: MOD }) : t('prj.foot', { mod: MOD });
  };

  const render = () => {
    renderChrome();
    grid.replaceChildren();
    grid.setAttribute('aria-busy', String(!!loading && !cache));
    if (!cache) {
      if (loadFailed) {
        const retry = h('button', { type: 'button', class: 'proj-ghost' }, t('acct.retry'));
        retry.addEventListener('click', () => { void refresh(); });
        grid.append(h('div', { class: 'proj-empty' }, icon('warning', 28),
          h('strong', null, t('prj.loadFailed')), h('span', null, t('prj.loadFailedSub')), retry));
      } else {
        grid.append(h('div', { class: 'proj-empty' }, h('span', { class: 'spinner lg', 'aria-hidden': 'true' }),
          h('span', null, t('prj.loading'))));
      }
      return;
    }
    const list = [...cache].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      grid.append(h('div', { class: 'proj-empty' }, icon(currentUser() ? 'cloud' : 'folder', 28),
        h('strong', null, t('prj.emptyTitle')),
        h('span', null, t('prj.emptySub', { mod: MOD }))));
      return;
    }
    for (const p of list) {
      const isCur = p.id === current?.id;
      const name = h('input', { class: 'proj-name', value: p.name, spellcheck: 'false', 'aria-label': t('common.rename'), readonly: '' });
      const dup = h('button', { type: 'button', class: 'proj-act', 'aria-label': t('common.duplicate'), title: t('common.duplicate') }, icon('duplicate', 14));
      const dl = h('button', { type: 'button', class: 'proj-act', 'aria-label': t('prj.download'), title: t('prj.download') }, icon('download', 14));
      dl.addEventListener('click', () => { void downloadProject(p.id); });
      const del = h('button', { type: 'button', class: 'proj-act danger', 'aria-label': t('common.delete'), title: t('common.delete') }, icon('trash', 14));
      const thumb = h('button', { type: 'button', class: 'proj-thumb', 'aria-label': t('prj.open', { name: p.name }) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : icon('cube', 30),
        busyId === p.id ? h('span', { class: 'proj-thumb-busy' }, h('span', { class: 'spinner lg', 'aria-hidden': 'true' })) : null);
      const card = h('div', { class: `proj-card${isCur ? ' current' : ''}${busyId === p.id ? ' busy' : ''}` },
        thumb,
        h('div', { class: 'proj-info' },
          name,
          h('div', { class: 'proj-meta' },
            `${tn('prj.items', p.items)} · ${relTime(p.updatedAt)}`,
            isCur ? h('span', { class: 'proj-badge' }, t('prj.openBadge')) : null),
        ),
        h('div', { class: 'proj-acts' }, dl, dup, del),
      );
      thumb.addEventListener('click', () => { void openProject(p.id); });
      name.addEventListener('dblclick', () => { name.readOnly = false; name.select(); });
      name.addEventListener('click', () => { if (name.readOnly) void openProject(p.id); });
      name.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') name.blur();
        if (e.key === 'Escape') { name.value = p.name; name.blur(); }
      });
      name.addEventListener('blur', () => { name.readOnly = true; void renameProject(p.id, name.value); });
      dup.addEventListener('click', () => { void duplicateProject(p.id); });
      del.addEventListener('click', () => { void deleteProject(p.id); });
      grid.append(card);
    }
  };
  // Don't re-render while a name is being edited (it would drop the edit).
  onProjectsChange(() => {
    if (!dlg.open) return;
    const a = document.activeElement as HTMLInputElement | null;
    if (a?.classList.contains('proj-name') && !a.readOnly) return;
    render();
  });

  sheet = {
    async open() {
      if (!dlg.open) dlg.showModal();
      render();
      await accountReady;
      // local: always fresh (cheap); account: show the cached list right away, then refresh
      void refresh();
    },
    close: doClose,
    setBusy(id) { busyId = id; if (dlg.open) render(); },
  };
  return sheet;
}

export function openProjectsSheet() { sheet?.open(); }
