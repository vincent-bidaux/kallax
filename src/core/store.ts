// ─────────────────────────────────────────────────────────────
// Store — single source of truth. Tiny observable + undo/redo.
// Everything that changes the design goes through `store.update()`
// (one undo step) or `store.preview()` (live, no history — used
// while dragging; call `store.commit()` when the gesture ends).
// ─────────────────────────────────────────────────────────────

import type { DesignDoc, Item, Layer, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { t, onBeforeLangSwitch } from './i18n';
import { expandToGroups, normalizeGroups } from './groups';

export type StoreEvent = 'doc' | 'selection' | 'settings' | 'hover';
type Listener = (ev: StoreEvent) => void;

const LS_DOC = 'kallax-designer:doc';
const LS_SETTINGS = 'kallax-designer:settings';

let idCounter = 0;
export function uid(prefix = 'it'): string {
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function emptyDoc(): DesignDoc {
  const layer: Layer = { id: 'layer_1', name: t('layer.default', { n: 1 }), visible: true, locked: false };
  return { version: 1, name: t('doc.untitled'), items: [], layers: [layer], activeLayerId: layer.id };
}

const clone = <T>(v: T): T => structuredClone(v);

/** Items lost far away (|coord| > 100 m or NaN, from an older placement bug) are brought back next to the rest. */
const STRAY_LIMIT = 10000;
function rescueStrays(d: DesignDoc): DesignDoc {
  const ok = (i: Item) => [i.position.x, i.position.y, i.position.z].every(v => Number.isFinite(v) && Math.abs(v) < STRAY_LIMIT);
  const strays = d.items.filter(i => !ok(i));
  if (!strays.length) return d;
  let x = 0;
  for (const i of d.items) if (ok(i)) x = Math.max(x, i.position.x + 200);
  for (const i of strays) { i.position = { x, y: 0, z: 0 }; x += 200; }
  return d;
}

class Store {
  doc: DesignDoc;
  settings: Settings;
  selection: string[] = [];
  hover: string | null = null;
  /** Group being edited ("entered" by double-click / ⌥-click): its members are selected one by one. */
  enteredGroup: string | null = null;

  private listeners = new Set<Listener>();
  private past: DesignDoc[] = [];
  private future: DesignDoc[] = [];
  /** Snapshot taken at the start of a preview gesture. */
  private gestureBase: DesignDoc | null = null;
  private saveTimer = 0;
  /** Applied to every document that comes in (startup, open, import): e.g. default names → current language. */
  private importFilter: ((d: DesignDoc) => void) | null = null;

  constructor() {
    this.doc = this.load() ?? emptyDoc();
    this.settings = { ...DEFAULT_SETTINGS, ...this.loadSettings() };
    onBeforeLangSwitch(() => this.flushSave());
  }

  // ── subscription ───────────────────────────────────────────
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(ev: StoreEvent) {
    for (const l of this.listeners) l(ev);
    if (ev === 'doc') this.scheduleSave();
    if (ev === 'settings') this.saveSettings();
  }

  // ── queries ────────────────────────────────────────────────
  get items(): Item[] { return this.doc.items; }
  getItem(id: string): Item | undefined { return this.doc.items.find(i => i.id === id); }
  getLayer(id: string): Layer | undefined { return this.doc.layers.find(l => l.id === id); }
  /** Items whose layer is visible. */
  visibleItems(): Item[] {
    const vis = new Set(this.doc.layers.filter(l => l.visible).map(l => l.id));
    return this.doc.items.filter(i => vis.has(i.layerId));
  }
  isLocked(item: Item): boolean { return !!this.getLayer(item.layerId)?.locked; }
  selectedItems(): Item[] { return this.selection.map(id => this.getItem(id)).filter(Boolean) as Item[]; }
  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  // ── mutations (with history) ───────────────────────────────
  /** Apply a mutation as one undoable step. */
  update(mutator: (doc: DesignDoc) => void) {
    const base = this.gestureBase ?? clone(this.doc);
    this.gestureBase = null;
    const next = clone(this.doc);
    mutator(next);
    normalizeGroups(next);
    this.past.push(base);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.doc = next;
    this.pruneSelection();
    this.emit('doc');
  }

  /** Live mutation without history (drag in progress). */
  preview(mutator: (doc: DesignDoc) => void) {
    if (!this.gestureBase) this.gestureBase = clone(this.doc);
    mutator(this.doc);
    this.emit('doc');
  }
  /** Close a preview gesture as a single undo step. */
  commit() {
    if (!this.gestureBase) return;
    this.past.push(this.gestureBase);
    this.future = [];
    this.gestureBase = null;
    this.emit('doc');
  }
  /** Abort a preview gesture, restoring the doc. */
  cancelPreview() {
    if (!this.gestureBase) return;
    this.doc = this.gestureBase;
    this.gestureBase = null;
    this.pruneSelection();
    this.emit('doc');
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(clone(this.doc));
    this.doc = prev;
    this.pruneSelection();
    this.emit('doc');
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(clone(this.doc));
    this.doc = next;
    this.pruneSelection();
    this.emit('doc');
  }

  /** Forget undo/redo history (e.g. after seeding the demo). */
  clearHistory() {
    this.past = [];
    this.future = [];
    this.emit('doc');
  }

  addItem(item: Item, select = true) {
    this.update(d => { d.items.push(item); });
    if (select) this.select([item.id]);
  }
  removeItems(ids: string[]) {
    const set = new Set(ids);
    this.update(d => { d.items = d.items.filter(i => !set.has(i.id)); });
  }
  patchItem(id: string, patch: Partial<Item>) {
    this.update(d => {
      const it = d.items.find(i => i.id === id);
      if (it) Object.assign(it, patch);
    });
  }

  newDoc() {
    this.update(d => { for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k]; Object.assign(d, emptyDoc()); });
    this.enteredGroup = null;
    this.select([]);
  }
  /** Install the incoming-document filter and apply it to the document already loaded (no undo step). */
  setImportFilter(fn: (d: DesignDoc) => void) {
    this.importFilter = fn;
    const before = JSON.stringify(this.doc);
    try { fn(this.doc); } catch (e) { console.error(e); }
    if (JSON.stringify(this.doc) !== before) this.emit('doc');
  }
  loadDoc(doc: DesignDoc) {
    const incoming = clone(doc);
    try { this.importFilter?.(incoming); } catch (e) { console.error(e); }
    this.update(d => { for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k]; Object.assign(d, incoming); });
    this.enteredGroup = null;
    this.select([]);
  }

  // ── selection / hover / settings ───────────────────────────
  /**
   * Select items. Clicking a grouped item selects its whole group (`raw`
   * skips that, e.g. to pick a member inside the entered group). Selecting
   * nothing of the entered group leaves it.
   */
  select(ids: string[], raw = false) {
    const vis = this.visibleItems();
    const next = raw ? [...new Set(ids)] : expandToGroups([...new Set(ids)], vis, this.enteredGroup);
    if (this.enteredGroup && !next.some(id => this.getItem(id)?.groupId === this.enteredGroup)) this.enteredGroup = null;
    this.selection = next;
    this.emit('selection');
  }
  /** ⇧/⌘-click: add or remove an item — or its whole group. */
  toggleSelect(id: string) {
    const unit = expandToGroups([id], this.visibleItems(), this.enteredGroup);
    const on = this.selection.includes(id);
    const set = new Set(unit);
    this.select(on ? this.selection.filter(s => !set.has(s)) : [...this.selection, ...unit], true);
  }
  /** Edit inside a group: select one of its members alone. */
  enterGroup(gid: string, memberId: string) {
    this.enteredGroup = gid;
    this.select([memberId], true);
  }
  /** Leave the entered group, selecting the group as a whole. Returns false when no group was entered. */
  exitGroup(): boolean {
    const g = this.enteredGroup;
    if (!g) return false;
    this.enteredGroup = null;
    this.select(this.visibleItems().filter(i => i.groupId === g).map(i => i.id), true);
    return true;
  }
  setHover(id: string | null) {
    if (this.hover === id) return;
    this.hover = id;
    this.emit('hover');
  }
  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.emit('settings');
  }

  private pruneSelection() {
    if (this.enteredGroup && !this.doc.items.some(i => i.groupId === this.enteredGroup)) this.enteredGroup = null;
    const ids = new Set(this.doc.items.map(i => i.id));
    const pruned = this.selection.filter(s => ids.has(s));
    if (pruned.length !== this.selection.length) { this.selection = pruned; this.emit('selection'); }
  }

  // ── persistence ────────────────────────────────────────────
  private load(): DesignDoc | null {
    try {
      const raw = localStorage.getItem(LS_DOC);
      if (!raw) return null;
      const d = JSON.parse(raw) as DesignDoc;
      if (d?.version !== 1 || !Array.isArray(d.items) || !Array.isArray(d.layers) || !d.layers.length) return null;
      return rescueStrays(d);
    } catch { return null; }
  }
  private loadSettings(): Partial<Settings> {
    try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); } catch { return {}; }
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 300);
  }
  /** Write the document (and settings) to localStorage now, cancelling any pending autosave. */
  flushSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    try { localStorage.setItem(LS_DOC, JSON.stringify(this.doc)); } catch { /* quota / private mode */ }
    this.saveSettings();
  }
  private saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }
}

export const store = new Store();
