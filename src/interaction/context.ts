// Shared runtime context: the viewport instance + ephemeral UI state
// (cursor position, live snapping info) that does not belong in the store.
import type { ViewportAPI } from '../core/contracts';
import type { Vec3 } from '../core/types';

type UIEvent = 'cursor' | 'snap' | 'gesture' | 'layout';

class UIState {
  viewport!: ViewportAPI;
  /** Ground (z = 0) point under the pointer, or null when outside the canvas. */
  cursor: Vec3 | null = null;
  /** Human-readable description of the last snap ("Accolé à Kallax 2×4 (X)"), null when none. */
  snap: string | null = null;
  /** Current gesture: none / placing from library / moving items. */
  gesture: 'none' | 'place' | 'move' = 'none';
  /** Placement validity during a gesture. */
  gestureValid = true;
  private ls = new Set<(e: UIEvent) => void>();

  on(fn: (e: UIEvent) => void) { this.ls.add(fn); return () => this.ls.delete(fn); }
  emit(e: UIEvent) { for (const l of this.ls) l(e); }

  setCursor(p: Vec3 | null) { this.cursor = p; this.emit('cursor'); }
  setSnap(s: string | null) { if (s !== this.snap) { this.snap = s; this.emit('snap'); } }
  setGesture(g: UIState['gesture'], valid = true) {
    if (g !== this.gesture || valid !== this.gestureValid) {
      this.gesture = g; this.gestureValid = valid; this.emit('gesture');
    }
  }
}

export const ui = new UIState();
