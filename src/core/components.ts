// ─────────────────────────────────────────────────────────────
// Reusable components ("Composants") — a set of items saved once and
// inserted into any project as a new group. Positions are stored relative
// to the set's min corner; ids, layers and group ids are dropped (fresh ones
// are given on every insert). Finishes left to the document stay inherited:
// an inserted component follows the destination's global finish.
// ─────────────────────────────────────────────────────────────
import type { BlockItem, Item, Size3, Vec3 } from './types';
import { unionBox } from './kallax';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An item as stored in a component (no id / layer / group). */
export type ComponentItem = DistributiveOmit<Item, 'id' | 'layerId' | 'groupId'>;

export interface ComponentData {
  version: 1;
  items: ComponentItem[];
  /** Overall size (union box). */
  size: Size3;
}

export interface Component {
  id: string;
  name: string;
  data: ComponentData;
  /** Small JPEG data URL. */
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}

export const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
export const COMPONENT_MAX_BYTES = 512 * 1024;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Deep copy of `items`, positions relative to their union min corner. */
export function componentFromItems(items: Item[]): ComponentData {
  const u = unionBox(items)!;
  const out: ComponentItem[] = items.map(it => {
    const c = structuredClone(it) as Partial<Item>;
    delete c.id; delete c.layerId; delete c.groupId;
    c.position = { x: r3(it.position.x - u.min.x), y: r3(it.position.y - u.min.y), z: r3(it.position.z - u.min.z) };
    return c as ComponentItem;
  });
  return {
    version: 1,
    items: out,
    size: { w: r3(u.max.x - u.min.x), d: r3(u.max.y - u.min.y), h: r3(u.max.z - u.min.z) },
  };
}

/** Fresh items for an insert at `at` (min corner), on `layerId`, in group `groupId` (null = no group). */
export function instantiate(data: ComponentData, at: Vec3, layerId: string, groupId: string | null, newId: () => string): Item[] {
  return data.items.map(ci => {
    const it = structuredClone(ci) as Item;
    it.id = newId();
    it.layerId = layerId;
    if (groupId) it.groupId = groupId; else delete it.groupId;
    it.position = { x: r3(at.x + ci.position.x), y: r3(at.y + ci.position.y), z: r3(at.z + ci.position.z) };
    return it;
  });
}

/**
 * Stand-in used for placement (snapping, reach, drop surface): a plain box the
 * size of the component's union box. Validity is then checked on the real items.
 */
export function componentProxy(data: ComponentData, layerId: string): BlockItem {
  return {
    id: '__component__', kind: 'block', shape: 'box', name: '',
    position: { x: 0, y: 0, z: 0 }, rotation: 0, layerId,
    size: { ...data.size },
  };
}

const KINDS = new Set(['kallax', 'block', 'eket']);
/** Shape check of data coming from storage / the server. */
export function validComponentData(d: unknown): d is ComponentData {
  const x = d as ComponentData;
  if (!x || !Array.isArray(x.items) || !x.items.length || !x.size) return false;
  return x.items.every(i => i && KINDS.has((i as Item).kind) && i.position
    && [i.position.x, i.position.y, i.position.z].every(Number.isFinite));
}

/** Number of items by kind, for card captions. */
export function componentCount(d: ComponentData): number { return d.items.length; }
