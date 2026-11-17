// First-launch demo composition.
import { store, uid } from '../core/store';
import type { Item, Layer } from '../core/types';
import { kallaxOuter, KALLAX } from '../core/kallax';

const LS_SEEDED = 'kallax-designer:seeded';

/** Seeds a demo once (flag in localStorage). Returns true when a demo was created. */
export function seedIfFirstLaunch(): boolean {
  let seeded = false;
  try { seeded = !!localStorage.getItem(LS_SEEDED); } catch { /* ignore */ }
  if (seeded || store.items.length) return false;
  try { localStorage.setItem(LS_SEEDED, '1'); } catch { /* ignore */ }

  const base = store.doc.layers[0];
  const existing: Layer = { id: uid('layer'), name: 'Existant', visible: true, locked: false };
  const w4 = kallaxOuter(4), w2 = kallaxOuter(2);
  const h2 = kallaxOuter(2);
  const items: Item[] = [
    // 4×2 lying on the floor
    { id: uid(), kind: 'kallax', name: 'Kallax 4×2', cols: 4, rows: 2, position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId: base.id },
    // 2×2 on top, flush right
    { id: uid(), kind: 'kallax', name: 'Kallax 2×2', cols: 2, rows: 2, position: { x: w4 - w2, y: 0, z: h2 }, rotation: 0, layerId: base.id },
    // 1×4 standing next to it
    { id: uid(), kind: 'kallax', name: 'Kallax 1×4', cols: 1, rows: 4, position: { x: w4, y: 0, z: 0 }, rotation: 0, layerId: base.id },
    // radiator against the wall behind, to the left
    { id: uid(), kind: 'block', name: 'Radiateur', size: { w: 80, d: 10, h: 60 }, position: { x: -95, y: KALLAX.depth - 10, z: 15 }, rotation: 0, layerId: existing.id },
  ];
  store.update(d => {
    d.name = 'Salon — meuble TV';
    d.layers = [{ ...base, name: 'Meubles' }, existing];
    d.activeLayerId = base.id;
    d.items = items;
  });
  // The demo should not be undoable back to an empty canvas.
  store.clearHistory();
  return true;
}
