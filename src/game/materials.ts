// ─────────────────────────────────────────────────────────────
// Game mode — PBR materials (MeshStandardMaterial) in the real finish
// colours: KALLAX finishes (wood-effect finishes get a grain map), BRANÄS
// rattan, underframes, EKET colours and legs, object colours (core/objects
// colorOf), house parts (plaster walls, painted skirting, radiator, PVC
// window frames, glass, translucent door leaves). Cached by key; every
// material / texture is disposed with the session.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { FinishId } from '../core/finishes';
import { FINISH_BY_ID } from '../core/finishes';
import { woodGrainTexture, plasterTexture, rattanTexture } from './textures';

/** Finishes printed with a wood grain (the others are plain melamine / lacquer). */
const WOOD_FINISHES = new Set<FinishId>(['chene', 'chene-blanchi', 'noyer', 'brun-noir']);

export type MatKind = 'wood' | 'plain' | 'gloss' | 'metal' | 'fabric' | 'rattan' | 'plaster' | 'glass' | 'door' | 'leaf' | 'skin' | 'emissive';

export class GameMaterials {
  private cache = new Map<string, THREE.Material>();
  private textures: THREE.Texture[] = [];
  private grain: THREE.Texture | null = null;
  private plaster: THREE.Texture | null = null;
  private rattan: THREE.Texture | null = null;

  private tex(kind: 'grain' | 'plaster' | 'rattan'): THREE.Texture {
    if (kind === 'grain') return this.grain ??= this.keep(woodGrainTexture());
    if (kind === 'plaster') return this.plaster ??= this.keep(plasterTexture());
    return this.rattan ??= this.keep(rattanTexture());
  }
  keep<T extends THREE.Texture>(t: T): T { this.textures.push(t); return t; }

  /** Material for a colour + surface kind. */
  get(kind: MatKind, hex: string): THREE.Material {
    const key = `${kind}|${hex}`;
    let m = this.cache.get(key);
    if (m) return m;
    const color = new THREE.Color(hex);
    switch (kind) {
      case 'wood': m = new THREE.MeshStandardMaterial({ color, map: this.tex('grain'), roughness: 0.62, metalness: 0 }); break;
      case 'gloss': m = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0 }); break;
      case 'metal': m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.35 }); break;
      case 'fabric': m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }); break;
      case 'rattan': m = new THREE.MeshStandardMaterial({ color, map: this.tex('rattan'), roughness: 0.85, metalness: 0 }); break;
      case 'plaster': m = new THREE.MeshStandardMaterial({ color, map: this.tex('plaster'), roughness: 0.92, metalness: 0 }); break;
      case 'glass':
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
        break;
      case 'door':
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false });
        break;
      case 'leaf': m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, flatShading: true }); break;
      case 'skin': m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 }); break;
      case 'emissive': m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.6 }); break;
      default: m = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0 });
    }
    m.name = key;
    this.cache.set(key, m);
    return m;
  }

  /** KALLAX finish: grain for the wood effects, gloss for "blanc brillant". */
  kallax(f: FinishId): THREE.Material {
    const fin = FINISH_BY_ID[f] ?? FINISH_BY_ID.blanc;
    if (WOOD_FINISHES.has(f)) return this.get('wood', woodTone(f, fin.color));
    if (f === 'blanc-brillant') return this.get('gloss', fin.color);
    return this.get('plain', fin.color);
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    this.cache.clear();
    this.textures = [];
    this.grain = this.plaster = this.rattan = null;
  }
}

/** The grain map darkens by ~14 %: lift the base colour so the average stays the finish colour. */
function woodTone(f: FinishId, hex: string): string {
  const c = new THREE.Color(hex);
  const k = f === 'brun-noir' ? 1.22 : 1.12;
  c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return '#' + c.getHexString();
}

/**
 * Box-projected UVs (cm / `scale`) computed per triangle from its dominant
 * normal axis, in the geometry's own (item-local) space. Grain runs along U:
 * horizontal panels → along X, vertical side panels → along Z (upright grain),
 * fronts → along X.
 */
export function boxUVs(g: THREE.BufferGeometry, scale = 60) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a);
    const nx = Math.abs(e1.y * e2.z - e1.z * e2.y), ny = Math.abs(e1.z * e2.x - e1.x * e2.z), nz = Math.abs(e1.x * e2.y - e1.y * e2.x);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number, v: number;
      if (nz >= nx && nz >= ny) { u = p.x; v = p.y; }
      else if (nx >= ny) { u = p.z; v = p.y; }
      else { u = p.x; v = p.z; }
      uv[(i + k) * 2] = u / scale; uv[(i + k) * 2 + 1] = v / scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
