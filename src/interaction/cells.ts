// Cell opening rectangles of a KALLAX frame in local front-plane coordinates
// (x from the left, z from the bottom of the frame, legs excluded).
import { KALLAX } from '../core/kallax';

export interface CellRect { c: number; r: number; x0: number; z0: number; x1: number; z1: number }

export function kallaxCellRects(cols: number, rows: number): CellRect[] {
  const out: CellRect[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x0 = KALLAX.outerPanel + c * (KALLAX.cell + KALLAX.divider);
    const z0 = KALLAX.outerPanel + r * (KALLAX.cell + KALLAX.divider);
    out.push({ c, r, x0, z0, x1: x0 + KALLAX.cell, z1: z0 + KALLAX.cell });
  }
  return out;
}
