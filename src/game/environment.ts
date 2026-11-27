// ─────────────────────────────────────────────────────────────
// Game mode — outdoor environment seen through the windows:
//   · sky dome: gradient shader (zenith → horizon haze → ground tone) with a
//     sun disc + glow, no fog, drawn first;
//   · downtown skyline: 3 rings of boxes (15–120 m high, set back
//     25–150 m from the scene), dark facades whose window grid is computed in
//     the shader from the world position (floors 3,4 m, bays 2,6 m), a random
//     share of the windows lit (warm / cool); distance haze via scene fog;
//   · outdoor paving ground (the room's parquet sits on top of it).
// One draw call for the whole skyline (static boxes merged into one geometry,
// per-building seed / tint as vertex attributes). Units: cm, Z up.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, pavingTexture } from './textures';
import { sphereGeo } from './geom';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; maxZ: number }

export const HORIZON = new THREE.Color('#d9c9b4');

export function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geo = sphereGeo(90000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: sunDir.clone().normalize() },
      uZenith: { value: new THREE.Color('#3a6fb6') },
      uMid: { value: new THREE.Color('#8fb3dc') },
      uHorizon: { value: HORIZON.clone() },
      uGround: { value: new THREE.Color('#6f6a63') },
      uSunCol: { value: new THREE.Color('#fff1d6') },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uZenith, uMid, uHorizon, uGround, uSunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.z;
        vec3 col;
        if (h >= 0.0) {
          float a = pow(clamp(h, 0.0, 1.0), 0.45);
          col = mix(uHorizon, uMid, smoothstep(0.0, 0.35, a));
          col = mix(col, uZenith, smoothstep(0.35, 1.0, a));
        } else {
          col = mix(uHorizon, uGround, smoothstep(0.0, 0.08, -h));
        }
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += uSunCol * (pow(s, 9.0) * 0.35 + pow(s, 64.0) * 0.6);
        col += uSunCol * smoothstep(0.9993, 0.9997, s) * 3.0;          // disc
        // warm haze towards the sun along the horizon
        col += vec3(1.0, 0.75, 0.45) * pow(s, 3.0) * (1.0 - smoothstep(0.0, 0.25, abs(h))) * 0.25;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.name = 'sky';
  return m;
}

/** Skyline around the scene bounds: one merged mesh. */
export function buildSkyline(b: Bounds, seed = 7): THREE.Mesh {
  const r = rng(seed);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const half = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  type B = { x: number; y: number; w: number; d: number; h: number; yaw: number; tint: number };
  const list: B[] = [];
  // rings: near low-rise, mid, far towers ("downtown")
  const rings = [
    { d0: 3500, d1: 6000, h0: 600, h1: 1500, n: 30, w0: 1400, w1: 2600 },
    { d0: 8000, d1: 12000, h0: 1200, h1: 3600, n: 44, w0: 1600, w1: 3200 },
    { d0: 14000, d1: 22000, h0: 2500, h1: 9000, n: 58, w0: 1800, w1: 3800 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + (r() - 0.5) * (Math.PI * 2 / ring.n) * 0.8;
      const dist = half + ring.d0 + r() * (ring.d1 - ring.d0);
      const w = ring.w0 + r() * (ring.w1 - ring.w0), d = ring.w0 + r() * (ring.w1 - ring.w0);
      // taller buildings cluster on one side (the "downtown" quadrant)
      const down = 0.4 + 0.6 * Math.pow(Math.max(0, Math.cos(a - 0.9)), 2);
      const h = (ring.h0 + Math.pow(r(), 1.6) * (ring.h1 - ring.h0)) * down;
      list.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, w, d, h: Math.max(1500, h), yaw: a + (r() - 0.5) * 0.3, tint: r() });
    }
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.05, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSeed;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec3 vSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        vSeed = aSeed;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        varying vec3 vSeed;
        float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWNrm);
          float side = 1.0 - step(0.5, abs(n.z));
          vec2 t = normalize(vec2(-n.y, n.x) + 1e-5);
          float u = dot(vWPos.xy - vSeed.xy, t);
          float z = vWPos.z;
          vec2 cellSize = vec2(260.0, 340.0);
          vec2 cell = floor(vec2(u, z) / cellSize);
          vec2 f = fract(vec2(u, z) / cellSize);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78) * side;
          win *= step(300.0, z);  // no windows at street level (shops band)
          float hsh = hash3(vec3(cell, 0.0) + vSeed * 0.013);
          float lit = step(0.64, hsh) * win;
          float warm = hash3(vec3(cell.yx, 7.0) + vSeed * 0.007);
          vec3 lc = mix(vec3(1.0, 0.78, 0.48), vec3(0.75, 0.86, 1.0), step(0.75, warm));
          totalEmissiveRadiance += lc * lit * (0.35 + 0.35 * hash3(vec3(cell, 3.0)));
          // unlit glass: darker, bluish
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.26), win * (1.0 - lit) * 0.8);
          // street-level band
          diffuseColor.rgb *= mix(0.6, 1.0, step(300.0, z));
        }`);
  };
  const palette = ['#5f6670', '#6d6a66', '#4f5863', '#7a7570', '#58606b', '#686f78', '#827b72'].map(c => new THREE.Color(c));
  const parts = list.map((bd) => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(0, 0, 0.5);
    g.scale(bd.w, bd.d, bd.h);
    g.rotateZ(bd.yaw);
    g.translate(bd.x, bd.y, -1);
    const n = g.getAttribute('position').count;
    const seed = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = palette[Math.floor(bd.tint * palette.length) % palette.length];
    for (let i = 0; i < n; i++) { seed.set([bd.x, bd.y, 0], i * 3); col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const geo = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  geo.computeBoundingSphere();
  const im = new THREE.Mesh(geo, mat);
  im.frustumCulled = false;
  im.castShadow = false;
  im.receiveShadow = false;
  im.name = 'skyline';
  return im;
}

/** Outdoor paving, a 3 km square under everything (the room floor sits 0.3 cm above). */
export function buildGround(b: Bounds): { mesh: THREE.Mesh; tex: THREE.Texture } {
  const tex = pavingTexture();
  const size = 300000;
  const geo = new THREE.PlaneGeometry(size, size);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 400, uv.getY(i) * size / 400);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, -0.3);
  m.receiveShadow = true;
  m.name = 'ground';
  return { mesh: m, tex };
}
