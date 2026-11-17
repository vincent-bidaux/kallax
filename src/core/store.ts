// ─────────────────────────────────────────────────────────────
// Store — single source of truth. Tiny observable + undo/redo.
// Everything that changes the design goes through `store.update()`
// (one undo step) or `store.preview()` (live, no history — used
// while dragging; call `store.commit()` when the gesture ends).
// ─────────────────────────────────────────────────────────────

import type { DesignDoc, Item, Layer, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

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
  const layer: Layer = { id: 'layer_1', name: 'Calque 1', visible: true, locked: false };
  return { version: 1, name: 'Sans titre', items: [], layers: [layer], activeLayerId: layer.id };
}

const clone = <T>(v: T): T => structuredClone(v);

class Store {
  doc: DesignDoc;
  settings: Settings;
  selection: string[] = [];
  hover: string | null = null;

  private listeners = new Set<Listener>();
  private past: DesignDoc[] = [];
  private future: DesignDoc[] = [];
  /** Snapshot taken at the start of a preview gesture. */
  private gestureBase: DesignDoc | null = null;
  private saveTimer = 0;

  constructor() {
    this.doc = this.load() ?? emptyDoc();
    this.settings = { ...DEFAULT_SETTINGS, ...this.loadSettings() };
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
    this.update(d => { Object.assign(d, emptyDoc()); });
    this.select([]);
  }
  loadDoc(doc: DesignDoc) {
    this.update(d => { Object.assign(d, clone(doc)); });
    this.select([]);
  }

  // ── selection / hover / settings ───────────────────────────
  select(ids: string[]) {
    this.selection = [...new Set(ids)];
    this.emit('selection');
  }
  toggleSelect(id: string) {
    this.select(this.selection.includes(id) ? this.selection.filter(s => s !== id) : [...this.selection, id]);
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
      return d;
    } catch { return null; }
  }
  private loadSettings(): Partial<Settings> {
    try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); } catch { return {}; }
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try { localStorage.setItem(LS_DOC, JSON.stringify(this.doc)); } catch { /* quota / private mode */ }
    }, 300);
  }
  private saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }
}

export const store = new Store();
