// ─────────────────────────────────────────────────────────────
// Game mode — collision world and player movement (no THREE, no DOM).
// COPY of src/interaction/walk/walk-world.ts (the game must not depend on
// the walk mode's internals), with: an `item` id on every collider (so the
// game can remove / move the colliders of destroyed / falling furniture).
//
// Colliders are oriented boxes (core/obb.ts) of the visible items: a
// footprint rectangle (centre, X axis, half sizes) and a height range.
//   · walls (zero thickness) are split around their openings (the holes cut
//     by doors / windows, render/wall-openings.ts) into thin slabs, so a door
//     opening can be walked through; door leaves themselves are passable
//     (treated as open), humans too;
//   · an item blocks when its height range overlaps the body above the step
//     height: lower items (≤ STEP above the feet) are stepped onto, items
//     entirely above the head are walked under.
// The player is a vertical cylinder (radius R); horizontal collisions push it
// out of the boxes and remove the velocity into them, so it slides along walls.
// Movement follows Quake: ground friction + acceleration towards the wished
// velocity, weak air control, gravity and a jump.
// ─────────────────────────────────────────────────────────────
import type { BlockItem, Item } from '../core/types';
import { itemOBB } from '../core/obb';
import { itemMatrix, isUpright } from '../core/orient';
import { localSize, unionBox } from '../core/kallax';
import { computeWallHoles } from '../render/wall-openings';

export interface Collider {
  id: string;
  /** Id of the item this collider belongs to. */
  item: string;
  /** Footprint centre (world). */
  cx: number; cy: number;
  /** Unit X axis of the footprint frame. */
  ux: number; uy: number;
  /** Half sizes along the frame axes. */
  hx: number; hy: number;
  /** Height range (world z). */
  z0: number; z1: number;
}

/** Body dimensions (cm). */
export interface Body {
  /** Standing height and eye height. */
  height: number;
  eye: number;
  /** Cylinder radius. */
  radius: number;
}

export const STEP = 35;            // cm: highest step climbed without jumping
const WALL_HALF = 1;               // cm: half thickness given to the zero-thickness walls
const GRAVITY = 1600;              // cm/s² (a bit more than g: snappy, not floaty)
const JUMP_V = 400;                // cm/s → ~50 cm jump
export const WALK_SPEED = 140;     // cm/s (1.4 m/s)
export const RUN_SPEED = 350;      // cm/s (3.5 m/s)
const CROUCH_SPEED = 70;
const ACCEL = 12;                  // ground acceleration (Quake sv_accelerate-like, ×wishspeed)
const AIR_ACCEL = 2.5;
const FRICTION = 8;
const STOP_SPEED = 100;            // below this, friction acts as if moving at STOP_SPEED (crisp stops)

export const passable = (it: Item) => it.kind === 'block' && (it.shape === 'human' || it.shape === 'door');

/** Thin slabs of a wall around its openings (wall-local x / z rectangles → colliders). */
function wallColliders(wall: BlockItem, holes: [number, number, number, number][]): Collider[] {
  const ls = localSize(wall);
  const o = itemOBB(wall);
  const m = itemMatrix(wall);
  const w = ls.w, h = ls.h;
  // grid of hole edges, filled cells merged per row
  const uniq = (v: number[]) => [...new Set(v.map(x => Math.round(x * 100) / 100))].sort((p, q) => p - q);
  const xs = uniq([0, w, ...holes.flatMap(r => [r[0], r[2]])].filter(x => x >= 0 && x <= w));
  const zs = uniq([0, h, ...holes.flatMap(r => [r[1], r[3]])].filter(z => z >= 0 && z <= h));
  const rects: [number, number, number, number][] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    let run: [number, number] | null = null;
    const flush = () => { if (run) rects.push([run[0], zs[j], run[1], zs[j + 1]]); run = null; };
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      const hole = holes.some(r => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]);
      if (hole) flush();
      else if (run) run[1] = xs[i + 1];
      else run = [xs[i], xs[i + 1]];
    }
    flush();
  }
  // local → world: p = c + R (l − half); local X = column 0 of R
  const ux0 = m[0], uy0 = m[3];
  const ul = Math.hypot(ux0, uy0) || 1;
  return rects.map(([x0, z0, x1, z1], k) => {
    const lx = (x0 + x1) / 2 - w / 2, lz = (z0 + z1) / 2 - h / 2, ly = -ls.d / 2;
    const wx = o.c.x + m[0] * lx + m[1] * ly + m[2] * lz;
    const wy = o.c.y + m[3] * lx + m[4] * ly + m[5] * lz;
    const wz = o.c.z + m[6] * lx + m[7] * ly + m[8] * lz;
    return { id: `${wall.id}#${k}`, item: wall.id, cx: wx, cy: wy, ux: ux0 / ul, uy: uy0 / ul, hx: (x1 - x0) / 2, hy: WALL_HALF, z0: wz - (z1 - z0) / 2, z1: wz + (z1 - z0) / 2 };
  });
}

export function buildColliders(items: Item[]): Collider[] {
  const holes = computeWallHoles(items);
  const out: Collider[] = [];
  for (const it of items) {
    if (passable(it)) continue;
    if (it.kind === 'block' && it.shape === 'wall' && isUpright(it)) { out.push(...wallColliders(it, holes.get(it.id) ?? [])); continue; }
    const o = itemOBB(it);
    const a = o.a * Math.PI / 180;
    out.push({
      id: it.id, item: it.id, cx: o.c.x, cy: o.c.y, ux: Math.cos(a), uy: Math.sin(a),
      hx: Math.max(o.h.x, WALL_HALF), hy: Math.max(o.h.y, WALL_HALF), z0: o.c.z - o.h.z, z1: o.c.z + o.h.z,
    });
  }
  return out;
}

/**
 * Circle (x, y, r) against a collider footprint: push-out normal and depth,
 * or null when they don't touch.
 */
export function contact(k: Collider, x: number, y: number, r: number): { nx: number; ny: number; depth: number } | null {
  const dx = x - k.cx, dy = y - k.cy;
  const lx = dx * k.ux + dy * k.uy, ly = -dx * k.uy + dy * k.ux;
  if (Math.abs(lx) > k.hx + r || Math.abs(ly) > k.hy + r) return null;
  const qx = Math.max(-k.hx, Math.min(k.hx, lx)), qy = Math.max(-k.hy, Math.min(k.hy, ly));
  const ox = lx - qx, oy = ly - qy;
  const d = Math.hypot(ox, oy);
  let nlx: number, nly: number, depth: number;
  if (d > 1e-6) {
    if (d >= r) return null;
    nlx = ox / d; nly = oy / d; depth = r - d;
  } else {
    // centre inside the footprint: out through the nearest side
    const px = k.hx - Math.abs(lx), py = k.hy - Math.abs(ly);
    if (px < py) { nlx = Math.sign(lx) || 1; nly = 0; depth = px + r; } else { nlx = 0; nly = Math.sign(ly) || 1; depth = py + r; }
  }
  return { nx: nlx * k.ux - nly * k.uy, ny: nlx * k.uy + nly * k.ux, depth };
}

export interface WalkInput {
  forward: number;   // −1 … 1
  side: number;      // −1 … 1 (right > 0)
  run: boolean;
  crouch: boolean;
  jump: boolean;     // consumed by step()
}

export interface StepEvents {
  /** Footfalls this frame (0 / 1 = left / right foot). */
  steps: (0 | 1)[];
  /** Landing after a fall / jump: impact strength 0…1, or 0. */
  land: number;
}

export class Walker {
  x = 0; y = 0;
  /** Feet height. */
  z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Heading (rad, 0 = +X, counter-clockwise) and pitch (rad, up > 0). */
  yaw = 0; pitch = 0;
  onGround = true;
  /** 0 = standing … 1 = crouched (smoothed). */
  crouchT = 0;
  /** Distance walked in steps (fractional): a footfall each time it crosses an integer. */
  stepPhase = 0.6;
  private foot: 0 | 1 = 0;
  /** Smoothed feet height for the camera (step-ups glide instead of popping). */
  camZ = 0;
  /** Bob amplitude envelope (0…1). */
  bobAmp = 0;

  constructor(public colliders: Collider[], public body: Body) {}

  get speed2D() { return Math.hypot(this.vx, this.vy); }
  get height() { return this.body.height * (1 - 0.34 * this.crouchT); }
  get eyeHeight() { return this.body.eye - (this.body.height * 0.34) * this.crouchT; }

  /**
   * A collider blocks the body (feet at z) when it overlaps it above the step
   * height (on the ground) / above the feet (in the air: land on tops instead).
   */
  private blocks(k: Collider, z: number, step = this.onGround ? STEP : 0.5) { return k.z1 > z + step + 0.01 && k.z0 < z + this.height - 0.01; }

  /** Highest surface under the player whose top is within `reach` above the feet (floor = 0). */
  supportAt(x: number, y: number, z: number, reach: number): number {
    let s = 0;
    const r = this.body.radius * 0.9;
    for (const k of this.colliders) {
      if (k.z1 <= s || k.z1 > z + reach) continue;
      if (contact(k, x, y, r)) s = k.z1;
    }
    return s;
  }

  /** True when the cylinder at (x, y), feet z, touches no blocking collider. */
  isFree(x: number, y: number, z = this.z): boolean {
    for (const k of this.colliders) if (this.blocks(k, z, STEP) && contact(k, x, y, this.body.radius - 0.5)) return false;
    return true;
  }

  /** Teleport (no velocity), feet on the surface below. */
  place(x: number, y: number, z = 0) {
    this.x = x; this.y = y;
    this.z = this.supportAt(x, y, z, STEP);
    this.camZ = this.z;
    this.vx = this.vy = this.vz = 0;
    this.onGround = true;
  }

  private resolve() {
    const r = this.body.radius;
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const k of this.colliders) {
        if (!this.blocks(k, this.z)) continue;
        const c = contact(k, this.x, this.y, r);
        if (!c) continue;
        this.x += c.nx * c.depth; this.y += c.ny * c.depth;
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) { this.vx -= vn * c.nx; this.vy -= vn * c.ny; } // slide
        moved = true;
      }
      if (!moved) break;
    }
  }

  private accelerate(wx: number, wy: number, wishSpeed: number, accel: number, dt: number) {
    const cur = this.vx * wx + this.vy * wy;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(accel * dt * wishSpeed, add);
    this.vx += a * wx; this.vy += a * wy;
  }

  step(dt: number, inp: WalkInput, strideScale = 1): StepEvents {
    const ev: StepEvents = { steps: [], land: 0 };
    // crouch (smoothed), wish velocity in the heading frame
    this.crouchT += ((inp.crouch ? 1 : 0) - this.crouchT) * Math.min(1, dt * 10);
    const fx = Math.cos(this.yaw), fy = Math.sin(this.yaw);
    const rx = Math.sin(this.yaw), ry = -Math.cos(this.yaw);
    let wx = fx * inp.forward + rx * inp.side, wy = fy * inp.forward + ry * inp.side;
    const wl = Math.hypot(wx, wy);
    if (wl > 1e-6) { wx /= wl; wy /= wl; }
    const wish = wl > 1e-6 ? (inp.crouch ? CROUCH_SPEED : inp.run ? RUN_SPEED : WALK_SPEED) : 0;

    if (this.onGround) {
      const sp = this.speed2D;
      if (sp > 0) {
        const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt;
        const k = Math.max(0, sp - drop) / sp;
        this.vx *= k; this.vy *= k;
      }
      if (wish) this.accelerate(wx, wy, wish, ACCEL, dt);
      if (inp.jump) { this.vz = JUMP_V; this.onGround = false; }
    } else if (wish) {
      this.accelerate(wx, wy, wish, AIR_ACCEL, dt);
    }
    inp.jump = false;

    // integrate in sub-steps of ≤ 4 cm (thin walls never tunnel)
    const x0 = this.x, y0 = this.y;
    const n = Math.min(8, Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy, this.vz) * dt / 4)));
    const h = dt / n;
    let fallV = 0;
    for (let s = 0; s < n; s++) {
      this.x += this.vx * h; this.y += this.vy * h;
      this.resolve();
      const zPrev = this.z;
      if (!this.onGround) {
        this.vz -= GRAVITY * h;
        this.z += this.vz * h;
        // head against an underside
        if (this.vz > 0) {
          for (const k of this.colliders) {
            if (k.z0 >= zPrev + this.height - 0.01 && k.z0 < this.z + this.height && contact(k, this.x, this.y, this.body.radius * 0.8)) {
              this.z = k.z0 - this.height; this.vz = 0;
            }
          }
        }
        const sup = this.supportAt(this.x, this.y, zPrev, 0.5);
        if (this.vz <= 0 && this.z <= sup) {
          fallV = Math.min(fallV, this.vz);
          this.z = sup; this.vz = 0; this.onGround = true;
        }
      } else {
        const sup = this.supportAt(this.x, this.y, this.z, STEP);
        if (sup >= this.z - 4) this.z = sup;                          // step up / small step down
        else { this.onGround = false; this.vz = 0; }                  // walked off an edge
      }
    }
    if (fallV < -150) ev.land = Math.min(1, (-fallV - 150) / 450);

    // camera smoothing of step-ups, footfalls / head bob from the distance walked
    if (this.onGround && Math.abs(this.z - this.camZ) < STEP + 1) this.camZ += (this.z - this.camZ) * Math.min(1, dt * 14);
    else this.camZ = this.z;
    const dist = Math.hypot(this.x - x0, this.y - y0);
    const sp = this.speed2D;
    const moving = this.onGround && sp > 25;
    this.bobAmp += ((moving ? Math.min(1.4, sp / WALK_SPEED) : 0) - this.bobAmp) * Math.min(1, dt * 8);
    if (moving) {
      const stride = (75 + 45 * Math.max(0, Math.min(1, (sp - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)))) * strideScale;
      const before = this.stepPhase;
      this.stepPhase += dist / stride;
      if (Math.floor(this.stepPhase) > Math.floor(before)) { ev.steps.push(this.foot); this.foot = this.foot ? 0 : 1; }
    } else if (sp < 5) {
      this.stepPhase = 0.6; // next start: first footfall comes quickly
    }
    return ev;
  }

  /** Head bob offsets (cm): vertical (lowest at each footfall) and lateral sway (one cycle per 2 steps). */
  bob(): { up: number; side: number } {
    const a = this.bobAmp;
    return { up: -Math.cos(this.stepPhase * Math.PI * 2) * 1.1 * a, side: Math.sin(this.stepPhase * Math.PI) * 0.7 * a };
  }
}

/**
 * Start position: in front of the scene (seen from the editor camera's
 * horizontal direction `dir`), looking at its centre, on a free spot.
 */
export function spawnPoint(items: Item[], w: Walker, dir: { x: number; y: number }): { x: number; y: number; yaw: number } {
  const b = unionBox(items);
  let fx = dir.x, fy = dir.y;
  const fl = Math.hypot(fx, fy);
  if (fl < 1e-3) { fx = 0; fy = 1; } else { fx /= fl; fy /= fl; }
  if (!b) return { x: 0, y: -250, yaw: Math.PI / 2 };
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
  let half = 0;
  for (const px of [b.min.x, b.max.x]) for (const py of [b.min.y, b.max.y]) half = Math.max(half, Math.abs((px - cx) * fx + (py - cy) * fy));
  const p = { x: cx - fx * (half + 120), y: cy - fy * (half + 120) };
  const free = findFree(w, p.x, p.y);
  return { ...free, yaw: Math.atan2(cy - free.y, cx - free.x) };
}

/** Nearest free spot around (x, y): rings of 25 cm up to 4 m. */
export function findFree(w: Walker, x: number, y: number): { x: number; y: number } {
  if (w.isFree(x, y, w.supportAt(x, y, 0, STEP))) return { x, y };
  for (let r = 25; r <= 400; r += 25) {
    const n = Math.max(8, Math.round(2 * Math.PI * r / 25));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (w.isFree(px, py, w.supportAt(px, py, 0, STEP))) return { x: px, y: py };
    }
  }
  return { x, y };
}
