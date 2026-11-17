// "Habillage" tool: pick a fitting (door, 2 drawers, basket, shelf, eraser),
// then click inside a KALLAX cell to fit it. Click the same fitting again to remove it.
import type { ViewportAPI } from '../core/contracts';
import type { BlockItem, KallaxItem, Vec3 } from '../core/types';
import { store } from '../core/store';
import { INSERTS, KALLAX, itemBox, localSize, worldSize } from '../core/kallax';
import { itemMatrix } from '../core/orient';
import { kallaxCellRects } from './cells';
import { ui } from './context';
import { toast } from '../ui/dom';
import { t } from '../core/i18n';

interface CellHit { item: KallaxItem; c: number; r: number }

/** World point → item-local (content) coordinates: local = Rᵀ (p − centre) + size/2. */
function toLocal(it: KallaxItem, p: Vec3): Vec3 {
  const m = itemMatrix(it), ws = worldSize(it), ls = localSize(it);
  const q = { x: p.x - (it.position.x + ws.w / 2), y: p.y - (it.position.y + ws.d / 2), z: p.z - (it.position.z + ws.h / 2) };
  return {
    x: m[0] * q.x + m[3] * q.y + m[6] * q.z + ls.w / 2,
    y: m[1] * q.x + m[4] * q.y + m[7] * q.z + ls.d / 2,
    z: m[2] * q.x + m[5] * q.y + m[8] * q.z + ls.h / 2,
  };
}
function toWorld(it: KallaxItem, l: Vec3): Vec3 {
  const m = itemMatrix(it), ws = worldSize(it), ls = localSize(it);
  const q = { x: l.x - ls.w / 2, y: l.y - ls.d / 2, z: l.z - ls.h / 2 };
  return {
    x: m[0] * q.x + m[1] * q.y + m[2] * q.z + it.position.x + ws.w / 2,
    y: m[3] * q.x + m[4] * q.y + m[5] * q.z + it.position.y + ws.d / 2,
    z: m[6] * q.x + m[7] * q.y + m[8] * q.z + it.position.z + ws.h / 2,
  };
}

/** Slab test against the item's world AABB. */
function rayBox(o: Vec3, d: Vec3, it: KallaxItem): [number, number] | null {
  const b = itemBox(it);
  let t0 = 0, t1 = Infinity;
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < b.min[a] || o[a] > b.max[a]) return null; continue; }
    let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** Cell under the pointer: walk the ray through the unit until it is inside a cell opening. */
export function cellUnderPointer(vp: ViewportAPI, x: number, y: number): CellHit | null {
  const { origin: o, direction: d } = vp.pickRay(x, y);
  let best: { hit: CellHit; t: number } | null = null;
  for (const it of store.visibleItems()) {
    if (it.kind !== 'kallax') continue;
    const span = rayBox(o, d, it);
    if (!span || (best && span[0] >= best.t)) continue;
    const L = it.legs ? KALLAX.legs : 0;
    const rects = kallaxCellRects(it.cols, it.rows);
    const N = 48;
    let found: CellHit | null = null, nearest: { c: number; r: number; dist: number } | null = null;
    for (let k = 0; k <= N && !found; k++) {
      const t = span[0] + (span[1] - span[0]) * (k / N) + 1e-3;
      const l = toLocal(it, { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });
      const lz = l.z - L;
      for (const rc of rects) {
        if (l.x >= rc.x0 && l.x <= rc.x1 && lz >= rc.z0 && lz <= rc.z1) { found = { item: it, c: rc.c, r: rc.r }; break; }
        if (k === 0) {
          const dist = Math.hypot(Math.max(rc.x0 - l.x, 0, l.x - rc.x1), Math.max(rc.z0 - lz, 0, lz - rc.z1));
          if (!nearest || dist < nearest.dist) nearest = { c: rc.c, r: rc.r, dist };
        }
      }
    }
    const hit = found ?? (nearest && nearest.dist < 6 ? { item: it, c: nearest.c, r: nearest.r } : null);
    if (hit) best = { hit, t: span[0] };
  }
  return best?.hit ?? null;
}

/** World AABB of one cell (for the hover preview). */
function cellBox(h: CellHit): BlockItem {
  const L = h.item.legs ? KALLAX.legs : 0;
  const rc = kallaxCellRects(h.item.cols, h.item.rows).find(r => r.c === h.c && r.r === h.r)!;
  const corners: Vec3[] = [];
  for (const lx of [rc.x0, rc.x1]) for (const ly of [0, KALLAX.depth]) for (const lz of [rc.z0 + L, rc.z1 + L]) corners.push(toWorld(h.item, { x: lx, y: ly, z: lz }));
  const min = { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), z: Math.min(...corners.map(p => p.z)) };
  const max = { x: Math.max(...corners.map(p => p.x)), y: Math.max(...corners.map(p => p.y)), z: Math.max(...corners.map(p => p.z)) };
  return { id: '__cell', kind: 'block', name: '', size: { w: max.x - min.x, d: max.y - min.y, h: max.z - min.z }, position: min, rotation: 0, layerId: '' };
}

export function installInsertTool(vp: ViewportAPI) {
  const el = vp.container;
  const canvas = () => vp.getRenderer().domElement;
  let raf = 0, last: PointerEvent | null = null;

  const preview = (ev: PointerEvent) => {
    const tool = ui.insertTool;
    if (!tool) return;
    const h = cellUnderPointer(vp, ev.clientX, ev.clientY);
    if (!h) { vp.setGhost(null); ui.setToolHint(null); vp.requestRender(); return; }
    const cur = h.item.inserts?.[`${h.c},${h.r}`];
    const removing = tool === 'erase' || cur === tool;
    vp.setGhost({ item: cellBox(h), valid: !removing });
    ui.setToolHint(`${t('ins.hintCell', { name: h.item.name, c: h.c + 1, r: h.r + 1 })}${cur ? ` (${INSERTS[cur].label.toLowerCase()})` : ''} — ${removing ? (cur ? t('ins.remove') : t('ins.empty')) : t('ins.place', { label: INSERTS[tool as keyof typeof INSERTS].label.toLowerCase() })}`);
    vp.requestRender();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!ui.insertTool || e.target !== canvas() || e.button !== 0) return;
    const h = cellUnderPointer(vp, e.clientX, e.clientY);
    if (!h) return; // empty space: let the camera orbit
    e.stopImmediatePropagation();
    e.preventDefault();
    if (store.isLocked(h.item)) { toast(t('cmd.lockedShort')); return; }
    const tool = ui.insertTool;
    const key = `${h.c},${h.r}`;
    store.update(d => {
      const it = d.items.find(i => i.id === h.item.id);
      if (!it || it.kind !== 'kallax') return;
      const ins = { ...(it.inserts ?? {}) };
      if (tool === 'erase' || ins[key] === tool) delete ins[key];
      else ins[key] = tool;
      if (Object.keys(ins).length) it.inserts = ins; else delete it.inserts;
    });
    if (last) preview(last);
  }, true);

  el.addEventListener('pointermove', (e) => {
    if (!ui.insertTool || e.buttons) return;
    last = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) preview(last); });
  });
  el.addEventListener('pointerleave', () => { if (ui.insertTool) { vp.setGhost(null); ui.setToolHint(null); vp.requestRender(); } });

  ui.on(ev => {
    if (ev !== 'tool') return;
    canvas().style.cursor = ui.insertTool ? 'cell' : '';
    if (!ui.insertTool) { vp.setGhost(null); vp.requestRender(); }
  });
}
