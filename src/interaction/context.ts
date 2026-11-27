// Shared runtime context: the viewport instance + ephemeral UI state
// (cursor position, live snapping info) that does not belong in the store.
import type { ViewportAPI } from '../core/contracts';
import type { Vec3 } from '../core/types';

import type { InsertType } from '../core/types';

type UIEvent = 'cursor' | 'snap' | 'gesture' | 'layout' | 'tool';
export type InsertTool = InsertType | 'erase';

class UIState {
  viewport!: ViewportAPI;
  /** Ground (z = 0) point under the pointer, or null when outside the canvas. */
  cursor: Vec3 | null = null;
  /** Human-readable description of the last snap ("Accolé à Kallax 2×4 (X)"), null when none. */
  snap: string | null = null;
  /** Current gesture: none / placing from library / moving items / turning them with the rotation handle. */
  gesture: 'none' | 'place' | 'move' | 'rotate' = 'none';
  /** Placement validity during a gesture. */
  gestureValid = true;
  /** Active "habillage" tool: click a Kallax cell to fit it. */
  insertTool: InsertTool | null = null;
  /** Angle eyedropper armed: the next click on an item copies its Z angle to the selection. */
  eyedropper = false;
  /** Cross-angle corner / edge magnet that caught during a move / placement (snap marker), null when none. */
  snapMark: { x: number; y: number; z0: number; z1: number } | null = null;
  /** Hovered cell label while a tool is active. */
  toolHint: string | null = null;
  private ls = new Set<(e: UIEvent) => void>();

  on(fn: (e: UIEvent) => void) { this.ls.add(fn); return () => this.ls.delete(fn); }
  emit(e: UIEvent) { for (const l of this.ls) l(e); }

  setInsertTool(t: InsertTool | null) { if (t !== this.insertTool) { this.insertTool = t; this.toolHint = null; this.emit('tool'); } }
  setEyedropper(on: boolean) { if (on !== this.eyedropper) { this.eyedropper = on; this.emit('tool'); } }
  setToolHint(h: string | null) { if (h !== this.toolHint) { this.toolHint = h; this.emit('tool'); } }
  setCursor(p: Vec3 | null) { this.cursor = p; this.emit('cursor'); }
  setSnap(s: string | null) { if (s !== this.snap) { this.snap = s; this.emit('snap'); } }
  setSnapMark(m: UIState['snapMark']) {
    const o = this.snapMark;
    if (o === m || (o && m && o.x === m.x && o.y === m.y && o.z0 === m.z0 && o.z1 === m.z1)) return;
    this.snapMark = m; this.emit('snap');
  }
  setGesture(g: UIState['gesture'], valid = true) {
    if (g !== this.gesture || valid !== this.gestureValid) {
      this.gesture = g; this.gestureValid = valid; this.emit('gesture');
    }
  }
}

export const ui = new UIState();
