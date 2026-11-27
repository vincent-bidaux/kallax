// Desk / table geometry. OWNED BY THE FURNITURE AGENT — placeholder box.
import type { Size3 } from '../core/types';
import { buildBlock, type ItemGeometry } from './item-geometry';
export function buildDesk(key: string, s: Size3, _variant?: string): ItemGeometry { return buildBlock(key, s); }
