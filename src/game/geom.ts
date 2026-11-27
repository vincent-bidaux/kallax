// ─────────────────────────────────────────────────────────────
// Game mode — small geometry builders (sphere, capsule, torus, merged box
// skyline helpers). Written here rather than imported from three.js so the
// game does not pull extra three.js classes into the shared `three` module
// of the app's main bundle (the game chunk must not grow the app).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Surface of revolution about +Y from a (radius, y) profile (bottom → top). */
export function latheGeo(profile: [number, number][], segments = 16): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const n = profile.length;
  // profile normals (2D), averaged at the joints
  const pn: [number, number][] = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
    const dr = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i], [nr, ny] = pn[i];
      pos.push(r * si, y, r * c);
      nrm.push(nr * si, ny, nr * c);
    }
  }
  for (let s = 0; s < segments; s++) for (let i = 0; i < n - 1; i++) {
    const a = s * n + i, b = (s + 1) * n + i;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function sphereGeo(r: number, ws = 16, hs = 12): THREE.BufferGeometry {
  const prof: [number, number][] = [];
  for (let i = 0; i <= hs; i++) { const a = -Math.PI / 2 + (i / hs) * Math.PI; prof.push([Math.cos(a) * r, Math.sin(a) * r]); }
  prof[0][0] = 0; prof[hs][0] = 0;
  return latheGeo(prof, ws);
}

/** Capsule along Y (like three's CapsuleGeometry): radius r, straight part `len`. */
export function capsuleGeo(r: number, len: number, capSeg = 5, radial = 14): THREE.BufferGeometry {
  const prof: [number, number][] = [];
  for (let i = 0; i <= capSeg; i++) { const a = -Math.PI / 2 + (i / capSeg) * (Math.PI / 2); prof.push([Math.cos(a) * r, -len / 2 + Math.sin(a) * r]); }
  for (let i = 0; i <= capSeg; i++) { const a = (i / capSeg) * (Math.PI / 2); prof.push([Math.cos(a) * r, len / 2 + Math.sin(a) * r]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  return latheGeo(prof, radial);
}

/** Torus in the XY plane (like three's TorusGeometry), optional arc. */
export function torusGeo(R: number, tube: number, radial = 8, tubular = 20, arc = Math.PI * 2): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let j = 0; j <= radial; j++) for (let i = 0; i <= tubular; i++) {
    const u = (i / tubular) * arc, v = (j / radial) * Math.PI * 2;
    const cx = R * Math.cos(u), cy = R * Math.sin(u);
    const x = (R + tube * Math.cos(v)) * Math.cos(u), y = (R + tube * Math.cos(v)) * Math.sin(u), z = tube * Math.sin(v);
    pos.push(x, y, z);
    const nx = x - cx, ny = y - cy, l = Math.hypot(nx, ny, z) || 1;
    nrm.push(nx / l, ny / l, z / l);
  }
  for (let j = 1; j <= radial; j++) for (let i = 1; i <= tubular; i++) {
    const a = (tubular + 1) * j + i - 1, b = (tubular + 1) * (j - 1) + i - 1, c = (tubular + 1) * (j - 1) + i, d = (tubular + 1) * j + i;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Linear fog without the THREE.Fog class (the renderer only reads `isFog`,
 * `color`, `near`, `far`).
 */
export function linearFog(color: THREE.Color, near: number, far: number): THREE.Fog {
  return { isFog: true, name: '', color, near, far, clone() { return linearFog(color.clone(), near, far); }, toJSON() { return {}; } } as unknown as THREE.Fog;
}
