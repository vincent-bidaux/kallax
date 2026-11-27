// ─────────────────────────────────────────────────────────────
// Game mode — procedural canvas textures (no image files):
//   wood grain (greyscale, multiplied by the finish colour), oak parquet,
//   light plaster, rattan weave, outdoor paving, soft dust puff and the
//   muzzle-flash star. All seeded (stable between runs), built once per
//   game session and disposed on exit.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

export function rng(seed: number) {
  let s = (Math.floor(seed * 9973) % 2147483647) || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Tileable value noise on a `cells`×`cells` lattice, sampled at (u, v) ∈ [0, 1). */
function valueNoise(cells: number, seed: number) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells).map(() => r());
  const at = (i: number, j: number) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * cells, y = v * cells;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = sm(x - i), fy = sm(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise on an anisotropic `cx`×`cy` lattice (long features along U when cx ≪ cy). */
function anisoNoise(cx: number, cy: number, seed: number) {
  const r = rng(seed);
  const g = new Float32Array(cx * cy).map(() => r());
  const at = (i: number, j: number) => g[((j % cy + cy) % cy) * cx + ((i % cx + cx) % cx)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * cx, y = v * cy;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = sm(x - i), fy = sm(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/**
 * Wood grain, light greyscale (mean ≈ 0.86): multiplied by a finish colour it
 * keeps that colour's tone. Long fibres and soft bands run along U. Tileable.
 */
export function woodGrainTexture(seed = 3): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const warp = anisoNoise(3, 4, seed), bands = anisoNoise(2, 14, seed + 1), fibres = anisoNoise(6, 170, seed + 2), pores = anisoNoise(24, 340, seed + 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S + (warp(u, y / S) - 0.5) * 0.035;
      const b = bands(u, v), f = fibres(u, v), p = pores(u, v);
      let l = 0.95 - b * 0.12 - Math.pow(f, 2.2) * 0.13 - (p > 0.78 ? (p - 0.78) * 0.5 : 0);
      l = Math.max(0.6, Math.min(1, l));
      const k = (y * S + x) * 4;
      img.data[k] = l * 255; img.data[k + 1] = l * 248; img.data[k + 2] = l * 240; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/**
 * Oak strip parquet: the texture covers 210 × 210 cm — 15 rows of 14 cm
 * planks, random lengths, staggered joints, per-plank tone and grain.
 */
export const PARQUET_CM = 210;
export function parquetTexture(seed = 11): THREE.CanvasTexture {
  const S = 1024, rows = 15;
  const pxcm = S / PARQUET_CM;
  const rowH = S / rows;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const r = rng(seed);
  const fine = valueNoise(128, seed + 5), warp = valueNoise(16, seed + 6);
  // planks per row: [x0, x1, tone, grain seed]
  const planks: [number, number, number, number][][] = [];
  for (let j = 0; j < rows; j++) {
    const list: [number, number, number, number][] = [];
    let x = -r() * 90 * pxcm;
    while (x < S) {
      const len = (60 + r() * 70) * pxcm;
      list.push([x, x + len, r(), r() * 100]);
      x += len;
    }
    // wrap: the last plank continues into the first one (tileable)
    planks.push(list);
  }
  for (let y = 0; y < S; y++) {
    const j = Math.floor(y / rowH), fy = (y - j * rowH) / rowH;
    const list = planks[j];
    for (let x = 0; x < S; x++) {
      let p = list[0];
      for (const q of list) if (x >= q[0] && x < q[1]) { p = q; break; }
      const tone = p[2];
      const u = (x - p[0]) / S, v = y / S;
      const gr = Math.pow(0.5 + 0.5 * Math.sin((fy * 7 + warp(u * 2 + p[3], v) * 2.5 + p[3]) * Math.PI * 2), 4);
      const pore = fine(x / S, y / S * 0.25);
      // oak: warm honey, ± per plank
      let R = 192 - tone * 34, G = 146 - tone * 30, B = 98 - tone * 26;
      const k2 = 1 - gr * 0.14 - pore * 0.08;
      R *= k2; G *= k2; B *= k2;
      // joints: dark gaps between rows and plank ends, slight bevel shading
      const edgeY = Math.min(fy, 1 - fy) * rowH;
      const edgeX = Math.min(x - p[0], p[1] - x);
      const e = Math.min(edgeY, edgeX);
      if (e < 1.2) { R *= 0.45; G *= 0.42; B *= 0.4; }
      else if (e < 3) { const f = 0.86 + 0.14 * (e - 1.2) / 1.8; R *= f; G *= f; B *= f; }
      const k = (y * S + x) * 4;
      img.data[k] = R; img.data[k + 1] = G; img.data[k + 2] = B; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** Light, slightly mottled plaster (greyscale around 0.96). 1 texture = 100 cm. */
export function plasterTexture(seed = 21): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const n1 = valueNoise(8, seed), n2 = valueNoise(48, seed + 1), n3 = valueNoise(160, seed + 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const l = 0.955 + (n1(u, v) - 0.5) * 0.05 + (n2(u, v) - 0.5) * 0.035 + (n3(u, v) - 0.5) * 0.03;
    const k = (y * S + x) * 4;
    img.data[k] = l * 255; img.data[k + 1] = l * 253; img.data[k + 2] = l * 249; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** BRANÄS-like rattan weave (light greyscale, multiplied by the basket colour). 1 texture = 12 cm. */
export function rattanTexture(): THREE.CanvasTexture {
  const S = 256, n = 8, cell = S / n;
  const { c, g } = canvas(S);
  g.fillStyle = '#6d6d6d'; g.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const horiz = (i + j) % 2 === 0;
    const x = i * cell, y = j * cell;
    const grad = horiz ? g.createLinearGradient(x, y, x, y + cell) : g.createLinearGradient(x, y, x + cell, y);
    grad.addColorStop(0, '#9a9a9a'); grad.addColorStop(0.5, '#f2f2f2'); grad.addColorStop(1, '#9a9a9a');
    g.fillStyle = grad;
    g.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    g.strokeStyle = 'rgba(80,80,80,.35)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      if (horiz) { g.moveTo(x + 2, y + k * cell / 4); g.lineTo(x + cell - 2, y + k * cell / 4); }
      else { g.moveTo(x + k * cell / 4, y + 2); g.lineTo(x + k * cell / 4, y + cell - 2); }
      g.stroke();
    }
  }
  return finish(c);
}

/** Outdoor concrete paving (colour). 1 texture = 400 cm. */
export function pavingTexture(seed = 31): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  const img = g.createImageData(S, S);
  const n1 = valueNoise(12, seed), n2 = valueNoise(96, seed + 1), n3 = valueNoise(256, seed + 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let l = 0.5 + (n1(u, v) - 0.5) * 0.12 + (n2(u, v) - 0.5) * 0.08 + (n3(u, v) - 0.5) * 0.1;
    // slab joints every 100 cm
    const ex = Math.min((x % 128), 128 - (x % 128)), ey = Math.min((y % 128), 128 - (y % 128));
    if (Math.min(ex, ey) < 1.5) l *= 0.7;
    const k = (y * S + x) * 4;
    img.data[k] = l * 168; img.data[k + 1] = l * 166; img.data[k + 2] = l * 160; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** Soft round puff (alpha), for dust / smoke particles. */
export function puffTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = canvas(S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return finish(c, false, false);
}

/** Muzzle flash: hot core + uneven spikes (additive sprite). */
export function flashTexture(seed = 41): THREE.CanvasTexture {
  const S = 128, C = S / 2;
  const { c, g } = canvas(S);
  const r = rng(seed);
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r() * 0.4, len = C * (0.55 + r() * 0.45), wd = 0.12 + r() * 0.1;
    g.beginPath();
    g.moveTo(C, C);
    g.lineTo(C + Math.cos(a - wd) * len * 0.35, C + Math.sin(a - wd) * len * 0.35);
    g.lineTo(C + Math.cos(a) * len, C + Math.sin(a) * len);
    g.lineTo(C + Math.cos(a + wd) * len * 0.35, C + Math.sin(a + wd) * len * 0.35);
    g.closePath();
    const gr = g.createRadialGradient(C, C, 0, C, C, len);
    gr.addColorStop(0, 'rgba(255,240,200,.95)'); gr.addColorStop(0.5, 'rgba(255,170,60,.55)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = gr; g.fill();
  }
  const core = g.createRadialGradient(C, C, 0, C, C, C * 0.42);
  core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(0.5, 'rgba(255,210,120,.8)'); core.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = core; g.fillRect(0, 0, S, S);
  return finish(c, true, false);
}

/** Bullet hole / scorch decal (dark centre, soft burnt rim). */
export function holeTexture(): THREE.CanvasTexture {
  const S = 64, C = S / 2;
  const { c, g } = canvas(S);
  const gr = g.createRadialGradient(C, C, 0, C, C, C);
  gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.28, 'rgba(18,14,10,.95)');
  gr.addColorStop(0.45, 'rgba(40,32,24,.55)'); gr.addColorStop(1, 'rgba(40,32,24,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return finish(c, true, false);
}
