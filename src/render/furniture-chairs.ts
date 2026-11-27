// Chair geometry (IKEA models). OWNED BY THE CHAIRS AGENT — placeholder box.
import type { Size3 } from '../core/types';
import { buildBlock, type ItemGeometry } from './item-geometry';
export function buildChair(key: string, s: Size3, _variant?: string): ItemGeometry { return buildBlock(key, s); }
