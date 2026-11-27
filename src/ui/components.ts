// Components: reusable sets of items, kept across projects.
// Signed in → the account (API); signed out / accounts unavailable → this browser.
// On sign-in, the browser's components are offered once for upload (local copies kept).
import { store, uid } from '../core/store';
import type { Item, Vec3 } from '../core/types';
import { buildBom } from '../core/finishes';
import { soleGroup, groupName } from '../core/groups';
import {
  componentFromItems, componentProxy, instantiate, COMPONENT_MAX_BYTES,
  type Component, type ComponentData,
} from '../core/components';
import { ui } from '../interaction/context';
import { freeSpot } from '../interaction/placement';
import { t, tn } from '../core/i18n';
import { toast } from './dom';
import { ApiError } from './api';
import { StorageFullError, mapLimit } from './project-store';
import { localComponents, accountComponents, type ComponentBackend } from './component-store';
import { accountReady, currentUser, onAccountChange, handleUnauthorized } from './account';
import { alertSheet, promptName } from './dialogs';
import { showSidebarTab } from './sidebar';

let backend: ComponentBackend = localComponents;
let cache: Component[] | null = null;
let loadFailed = false;
let loading = false;

const listeners = new Set<() => void>();
export function onComponentsChange(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const l of listeners) l(); }

export function componentsState() {
  return { list: cache, loading, failed: loadFailed, where: backend.kind };
}

let loadToken = 0;
export async function refreshComponents(): Promise<void> {
  const b = backend;
  const token = ++loadToken;
  loading = true; emit();
  try {
    const list = await b.list();
    if (b !== backend || token !== loadToken) return;
    cache = list.sort((a, c) => c.updatedAt - a.updatedAt);
    loadFailed = false;
  } catch (e) {
    if (b !== backend || token !== loadToken) return;
    loadFailed = true;
    report(e, 'load');
  } finally {
    if (token === loadToken) loading = false;
    emit();
  }
}

function upsert(c: Component) {
  cache = [c, ...(cache ?? []).filter(x => x.id !== c.id)];
  emit();
}

/** Startup: load the list once the account state is known. */
export function initComponents() {
  void accountReady.then(() => refreshComponents());
}

onAccountChange(({ user, reason }) => {
  const next = user ? accountComponents(user.email) : localComponents;
  if (next.scope !== backend.scope) {
    backend = next;
    cache = null;
    loadFailed = false;
    emit();
    void refreshComponents();
  }
  if (reason === 'signin' && user) void offerImport(user.email);
});

// ── sign-in: offer to upload this browser's components (once per component) ──
const LS_OFFERED = (email: string) => `kallax-designer:components-imported:${email.toLowerCase()}`;
function offered(email: string): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(LS_OFFERED(email)) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function rememberOffered(email: string, ids: string[]) {
  const all = [...new Set([...offered(email), ...ids])];
  try { localStorage.setItem(LS_OFFERED(email), JSON.stringify(all)); } catch { /* ignore */ }
}

async function offerImport(email: string) {
  // let the projects import alert go first (both are offered once, one after the other)
  await new Promise(r => setTimeout(r, 50));
  while (document.querySelector('dialog.alert[open]')) await new Promise(r => setTimeout(r, 250));
  const seen = offered(email);
  const pending = localComponents.listSync().filter(c => !seen.has(c.id));
  if (!pending.length || currentUser()?.email !== email) return;
  const r = await alertSheet({
    icon: 'component',
    title: tn('comp.importTitle', pending.length),
    message: t('comp.importMsg', { email }),
    buttons: [
      { label: t('acct.importLater'), value: 'later', kind: 'plain' },
      { label: t('acct.importDo'), value: 'import', kind: 'primary' },
    ],
  });
  if (currentUser()?.email !== email) return;
  if (r !== 'import') { rememberOffered(email, pending.map(c => c.id)); return; }
  const b = backend;
  const res = await mapLimit(pending, 3, c => b.write({ id: c.id, name: c.name, data: c.data, thumb: c.thumb, createdAt: c.createdAt }));
  const done = pending.filter((_, i) => res[i].status === 'fulfilled');
  const failed = res.find((x): x is PromiseRejectedResult => x.status === 'rejected');
  rememberOffered(email, done.map(c => c.id));
  if (b !== backend) return;
  if (failed && !done.length) { report(failed.reason, 'import'); return; }
  toast(failed ? t('comp.importPartial', { n: done.length, total: pending.length }) : tn('comp.imported', done.length), 3000);
  await refreshComponents();
}

// ── errors ─────────────────────────────────────────────────
function report(e: unknown, op: 'load' | 'save' | 'delete' | 'import') {
  if (e instanceof StorageFullError) { toast(t('comp.storageFull'), 3200); return; }
  const code = e instanceof ApiError ? e.code : 'other';
  if (code === 'unauthorized') { handleUnauthorized(op === 'save'); if (op === 'save') toast(t('comp.notSavedSession'), 3600); return; }
  if (code === 'too_many') toast(t('comp.tooMany'), 3600);
  else if (code === 'too_large') toast(t('comp.tooLarge'), 3600);
  else if (code === 'network') toast(t('net.offline'), 3200);
  else { console.error(e); toast(op === 'save' ? t('comp.saveFailed') : t('net.server'), 3200); }
}

// ── helpers ────────────────────────────────────────────────
export function componentPrice(c: Component): { total: number; priced: boolean } {
  const items = c.data.items as unknown as Item[];
  const b = buildBom(items, store.doc.finish, store.doc.basket, store.doc.eketFinish);
  return { total: b.total, priced: b.lines.some(l => l.total != null) };
}

function where(): { note: string; icon: string } {
  return currentUser()
    ? { note: t('comp.whereAccount'), icon: 'cloud' }
    : { note: t('comp.whereLocal'), icon: 'laptop' };
}

/** Selected visible items (whole selection, locked layers included: saving copies them). */
function selectionItems(): Item[] {
  const vis = new Set(store.visibleItems().map(i => i.id));
  return store.selectedItems().filter(i => vis.has(i.id));
}

function defaultName(sel: Item[]): string {
  const g = soleGroup(store.selection, store.visibleItems());
  if (g) return groupName(store.doc, g);
  if (sel.length === 1) return sel[0].name;
  return t('comp.defaultName');
}

function thumbOf(ids: string[]): string | undefined {
  try { return ui.viewport.snapshot({ ids, width: 240, height: 180, quality: 0.8 }); } catch { return undefined; }
}

function tooBig(data: ComponentData): boolean {
  return JSON.stringify(data).length > COMPONENT_MAX_BYTES;
}

// ── actions ────────────────────────────────────────────────
/** "Ajouter aux composants": save the selection (a group or any items) as a new component. */
export async function addSelectionToComponents(): Promise<boolean> {
  const sel = selectionItems();
  if (!sel.length) { toast(t('comp.selectFirst')); return false; }
  await accountReady;
  const w = where();
  const name = await promptName({
    title: t('comp.addTitle'), value: defaultName(sel), icon: 'component', okLabel: t('comp.addOk'),
    ariaLabel: t('comp.nameAria'), fallback: t('comp.defaultName'), note: w.note, noteIcon: w.icon,
    message: tn('comp.addMsg', sel.length),
  });
  if (name === null) return false;
  const data = componentFromItems(sel);
  if (tooBig(data)) { toast(t('comp.tooLarge'), 3600); return false; }
  const thumb = thumbOf(sel.map(i => i.id));
  const b = backend;
  try {
    const c = await b.write({ id: uid('cmp'), name, data, thumb, createdAt: Date.now() });
    if (b !== backend) return false;
    upsert(c);
    showSidebarTab('comp');
    toast(t(b.kind === 'account' ? 'comp.addedAccount' : 'comp.added', { name }), 2600);
    return true;
  } catch (e) { report(e, 'save'); return false; }
}

/** Replace a component's content with the current selection (keeps its name and id). */
export async function updateComponentFromSelection(id: string) {
  const c = cache?.find(x => x.id === id);
  const sel = selectionItems();
  if (!c) return;
  if (!sel.length) { toast(t('comp.selectFirst')); return; }
  const r = await alertSheet({
    icon: 'component', title: t('comp.updateTitle', { name: c.name }), message: tn('comp.updateMsg', sel.length),
    buttons: [
      { label: t('common.cancel'), value: 'cancel', kind: 'plain' },
      { label: t('comp.updateOk'), value: 'update', kind: 'primary' },
    ],
  });
  if (r !== 'update') return;
  const data = componentFromItems(sel);
  if (tooBig(data)) { toast(t('comp.tooLarge'), 3600); return; }
  const b = backend;
  try {
    const n = await b.write({ id, name: c.name, data, thumb: thumbOf(sel.map(i => i.id)) });
    if (b === backend) { upsert({ ...n, thumb: n.thumb ?? c.thumb, createdAt: c.createdAt }); toast(t('comp.updated', { name: c.name })); }
  } catch (e) { report(e, 'save'); }
}

export async function renameComponent(id: string, name: string) {
  name = name.trim();
  const c = cache?.find(x => x.id === id);
  if (!c || !name || name === c.name) return;
  const b = backend;
  const old = c.name;
  c.name = name; emit(); // optimistic
  try {
    const n = await b.write({ id, name, data: c.data, thumb: c.thumb });
    if (b === backend) upsert({ ...n, thumb: n.thumb ?? c.thumb, createdAt: c.createdAt });
  } catch (e) { c.name = old; emit(); report(e, 'save'); }
}

export async function deleteComponent(id: string) {
  const c = cache?.find(x => x.id === id);
  if (!c) return;
  const r = await alertSheet({
    icon: 'component', title: t('comp.deleteTitle', { name: c.name }),
    message: backend.kind === 'account' ? t('comp.deleteMsgAccount') : t('comp.deleteMsg'),
    buttons: [
      { label: t('common.cancel'), value: 'cancel', kind: 'plain' },
      { label: t('common.delete'), value: 'delete', kind: 'destructive' },
    ],
  });
  if (r !== 'delete') return;
  const b = backend;
  try { await b.remove(id); } catch (e) { report(e, 'delete'); return; }
  if (b !== backend) return;
  cache = (cache ?? []).filter(x => x.id !== id);
  emit();
}

/**
 * Insert a component as a NEW group (fresh ids + groupId, active layer) with its
 * min corner at `at` (default: a free spot next to the composition). Selects it.
 */
export function insertComponent(c: Component, at?: Vec3): Item[] {
  const layer = store.doc.activeLayerId;
  const pos = at ?? freeSpotFor(c.data);
  const gid = c.data.items.length > 1 ? uid('grp') : null;
  const items = instantiate(c.data, pos, layer, gid, () => uid());
  store.update(d => {
    d.items.push(...items);
    if (gid) d.groups = { ...(d.groups ?? {}), [gid]: { name: c.name } };
  });
  store.enteredGroup = null;
  store.select(items.map(i => i.id), true);
  return items;
}

/** Free floor spot right of the composition where every item of the component fits. */
function freeSpotFor(data: ComponentData): Vec3 {
  const proxy = componentProxy(data, store.doc.activeLayerId);
  return freeSpot(proxy);
}

export { componentProxy };
