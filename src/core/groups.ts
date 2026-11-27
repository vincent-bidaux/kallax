// ─────────────────────────────────────────────────────────────
// Groups — items sharing a `groupId` behave as one object: a click selects
// the whole group, and every command (move, ⌥-drag copy, delete, rotate,
// nudge, duplicate) then acts on all of its members. Double-click (or ⌥-click)
// "enters" a group to select a single member; Escape leaves it.
//
// Groups are flat: grouping items that already belong to groups merges them
// into one new group. Names live in `doc.groups[groupId]`.
// ─────────────────────────────────────────────────────────────
import type { DesignDoc, Item } from './types';
import { t } from './i18n';

/** Visible members of a group. */
export function groupMembers(items: Item[], gid: string): Item[] {
  return items.filter(i => i.groupId === gid);
}

/**
 * Add the other members of every group touched by `ids` (except the entered
 * group, whose members are selected one by one). Keeps the input order first.
 */
export function expandToGroups(ids: string[], items: Item[], entered: string | null): string[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const gids = new Set<string>();
  for (const id of ids) {
    const g = byId.get(id)?.groupId;
    if (g && g !== entered) gids.add(g);
  }
  if (!gids.size) return ids;
  const out = [...ids];
  for (const it of items) if (it.groupId && gids.has(it.groupId)) out.push(it.id);
  return [...new Set(out)];
}

/** Groups whose (visible) members are all in `selection`. */
export function fullGroups(selection: string[], items: Item[]): string[] {
  const sel = new Set(selection);
  const seen = new Map<string, boolean>();
  for (const it of items) {
    if (!it.groupId) continue;
    const all = seen.get(it.groupId) ?? true;
    seen.set(it.groupId, all && sel.has(it.id));
  }
  // a group counts only if at least one member is selected
  const touched = new Set(items.filter(i => i.groupId && sel.has(i.id)).map(i => i.groupId!));
  return [...seen].filter(([g, all]) => all && touched.has(g)).map(([g]) => g);
}

/** The group when the selection is exactly one whole group, else null. */
export function soleGroup(selection: string[], items: Item[]): string | null {
  if (selection.length < 2) return null;
  const sel = new Set(selection);
  const picked = items.filter(i => sel.has(i.id));
  const g = picked[0]?.groupId;
  if (!g || picked.some(i => i.groupId !== g)) return null;
  return items.every(i => i.groupId !== g || sel.has(i.id)) ? g : null;
}

/** Any grouped item in the selection? */
export function selectionHasGroups(selection: string[], items: Item[]): boolean {
  const sel = new Set(selection);
  return items.some(i => i.groupId && sel.has(i.id));
}

/** Display name of a group (stored name, else "Groupe"). */
export function groupName(doc: DesignDoc, gid: string): string {
  return doc.groups?.[gid]?.name || t('group.defaultName', { n: 1 });
}

/** Next default name: "Groupe 1", "Groupe 2"… (first number not used by a live group). */
export function nextGroupName(doc: DesignDoc): string {
  const used = new Set(Object.values(doc.groups ?? {}).map(g => g.name));
  for (let n = 1; ; n++) {
    const name = t('group.defaultName', { n });
    if (!used.has(name)) return name;
  }
}

/**
 * Housekeeping after any document change: a group needs at least two members
 * (a lone member is ungrouped), and names of dead groups are dropped.
 */
export function normalizeGroups(doc: DesignDoc): void {
  const count = new Map<string, number>();
  for (const it of doc.items) if (it.groupId) count.set(it.groupId, (count.get(it.groupId) ?? 0) + 1);
  for (const it of doc.items) if (it.groupId && (count.get(it.groupId) ?? 0) < 2) delete it.groupId;
  if (doc.groups) {
    for (const g of Object.keys(doc.groups)) if ((count.get(g) ?? 0) < 2) delete doc.groups[g];
    if (!Object.keys(doc.groups).length) delete doc.groups;
  }
}

/**
 * Copies of grouped items get fresh groupIds (one per source group), so a
 * duplicate is a new group, not more members of the original. `names` receives
 * the copied group names (new gid → name).
 */
export function regroupCopies(copies: Item[], newId: () => string, doc: DesignDoc, names: Record<string, { name: string }>): void {
  const map = new Map<string, string>();
  for (const c of copies) {
    if (!c.groupId) continue;
    let g = map.get(c.groupId);
    if (!g) {
      g = newId();
      map.set(c.groupId, g);
      names[g] = { name: groupName(doc, c.groupId) };
    }
    c.groupId = g;
  }
}
