// ─────────────────────────────────────────────────────────────
// First-person walk mode ("Visite"): controller + HUD.
//
//   enter (toolbar button / V) → the 3D view fills the window, editing is
//   off (a layer covers the canvas, the app chrome is inert, shortcuts are
//   swallowed), a perspective camera (vertical FOV 60°, near 5 cm) is put at
//   eye height (adult 1.68 m / child 1.30 m) — at the selected Human if any,
//   else in front of the scene looking at its centre.
//   click → pointer lock (mouse look) + AudioContext; ZQSD / WASD / arrows
//   move (event.code, so both keyboard layouts work), ⇧ run, Space jump,
//   C crouch; E adult / child, M sound, B head bob.
//   Esc → the browser releases the pointer: pause card (Reprendre / Quitter);
//   Esc again (or Quitter) → back to the editor view exactly as it was.
//   No pointer lock (headless / refused): drag in the view to look.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { store } from '../../core/store';
import { t } from '../../core/i18n';
import { h, toast } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { segmented, switchRow } from '../../ui/controls';
import { closeAllPopovers } from '../../ui/popover';
import { ui } from '../context';
import { cancelActiveDrag } from '../drag-drop';
import { cancelActiveMove } from '../select-move';
import { cancelActiveRotate } from '../rotate-tool';
import { HUMAN_EYE, HUMAN_HEIGHT, humanVariant } from '../../core/objects-human';
import { itemOBB } from '../../core/obb';
import type { BlockItem } from '../../core/types';
import { Walker, buildColliders, findFree, spawnPoint, type WalkInput } from './walk-world';
import { Footsteps } from './walk-audio';

const LS_WALK = 'kallax-designer:walk';
const FOV = 60;
const PITCH_MAX = THREE.MathUtils.degToRad(85);
const LOOK_RAD_PER_PX = 0.0022;

interface WalkPrefs { child: boolean; sound: boolean; bob: boolean; sens: number }
function loadPrefs(): WalkPrefs {
  const def: WalkPrefs = { child: false, sound: true, bob: true, sens: 1 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LS_WALK) || '{}') }; } catch { return def; }
}
const bodyOf = (child: boolean) => {
  const v = child ? 'child' : 'adult';
  return { height: HUMAN_HEIGHT[v], eye: HUMAN_EYE[v], radius: child ? 16 : 20 };
};

type Phase = 'start' | 'running' | 'paused';

class WalkMode {
  active = false;
  private phase: Phase = 'start';
  private prefs = loadPrefs();
  private walker: Walker | null = null;
  private cam = new THREE.PerspectiveCamera(FOV, 1, 5, 30000);
  readonly audio = new Footsteps();
  private keys = new Set<string>();
  private input: WalkInput = { forward: 0, side: 0, run: false, crouch: false, jump: false };
  /** Smoothed eye height (adult ↔ child switch glides). */
  private eye = HUMAN_EYE.adult;
  private lockedOnce = false;
  private dragLook = false;
  private pausedAt = 0;
  private savedSelection: string[] = [];
  private cleanup: (() => void)[] = [];
  private dom: ReturnType<WalkMode['buildDom']> | null = null;
  private drag: { id: number; x: number; y: number } | null = null;

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    if (this.active || !ui.viewport) return;
    cancelActiveDrag(); cancelActiveMove(); cancelActiveRotate();
    ui.setInsertTool(null); ui.setEyedropper(false);
    closeAllPopovers();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const items = store.visibleItems();
    // starting point: the selected Human, else in front of the scene
    const sel = store.selection.length === 1 ? store.getItem(store.selection[0]) : undefined;
    const human = sel && sel.kind === 'block' && sel.shape === 'human' ? sel as BlockItem : null;
    if (human) this.prefs.child = humanVariant(human.variant) === 'child';
    this.savedSelection = [...store.selection];
    store.select([]);
    store.setHover(null);

    const w = new Walker(buildColliders(items), bodyOf(this.prefs.child));
    if (human) {
      const o = itemOBB(human);
      const r = THREE.MathUtils.degToRad(human.rotation);
      const p = findFree(w, o.c.x, o.c.y);
      w.place(p.x, p.y, human.position.z);
      w.yaw = Math.atan2(-Math.cos(r), Math.sin(r)); // the figure's front is local −Y
      toast(t('walk.fromHuman', { name: human.name }), 1800);
    } else {
      const d = ui.viewport.getViewDirection();
      const p = spawnPoint(items, w, d);
      w.place(p.x, p.y, 0);
      w.yaw = p.yaw;
    }
    w.pitch = THREE.MathUtils.degToRad(-4);
    this.walker = w;
    this.eye = w.eyeHeight;
    this.keys.clear();
    this.active = true;
    this.phase = 'start';
    this.lockedOnce = false;
    this.dragLook = false;
    this.audio.setMuted(!this.prefs.sound);

    // immersive: the view fills the window, the chrome is inert
    document.documentElement.classList.add('walking');
    for (const id of ['toolbar', 'sidebar', 'inspector', 'statusbar']) { const el = document.getElementById(id); if (el) el.inert = true; }
    this.dom = this.buildDom();
    ui.viewport.container.appendChild(this.dom.layer);
    this.listen();
    this.placeCamera(0);
    ui.viewport.beginWalk(this.cam, (dt) => this.tick(dt), human ? [human.id] : []);
    this.render();
    this.save();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    for (const f of this.cleanup) f();
    this.cleanup = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.suspend();
    ui.viewport.endWalk();
    this.dom?.layer.remove();
    this.dom = null;
    document.documentElement.classList.remove('walking');
    for (const id of ['toolbar', 'sidebar', 'inspector', 'statusbar']) { const el = document.getElementById(id); if (el) el.inert = false; }
    // the sidebar / inspector inert state follows the layout again (main.ts applyLayout)
    const app = document.getElementById('app');
    const sb = document.getElementById('sidebar'), ins = document.getElementById('inspector');
    if (app && sb) sb.inert = app.classList.contains('no-sidebar');
    if (app && ins) ins.inert = app.classList.contains('no-inspector');
    this.keys.clear();
    this.walker = null;
    const keep = this.savedSelection.filter(id => store.getItem(id));
    if (keep.length) store.select(keep);
  }

  // ── frame ─────────────────────────────────────────────────
  private tick(dt: number) {
    const w = this.walker;
    if (!w) return;
    const running = this.phase === 'running';
    const k = (c: string) => running && this.keys.has(c);
    this.input.forward = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    this.input.side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    this.input.run = k('ShiftLeft') || k('ShiftRight');
    this.input.crouch = k('KeyC');
    if (!running) this.input.jump = false;
    const ev = w.step(dt, this.input, this.prefs.child ? 0.78 : 1);
    const o = { run: this.input.run && w.speed2D > 160, child: this.prefs.child, crouch: this.input.crouch };
    for (const f of ev.steps) this.audio.step(f, o);
    if (ev.land) this.audio.land(ev.land, this.prefs.child);
    this.placeCamera(dt);
  }

  private placeCamera(dt: number) {
    const w = this.walker!;
    const target = w.eyeHeight;
    this.eye = dt ? this.eye + (target - this.eye) * Math.min(1, dt * 6) : target;
    const b = this.prefs.bob ? w.bob() : { up: 0, side: 0 };
    const rx = Math.sin(w.yaw), ry = -Math.cos(w.yaw);
    const x = w.x + rx * b.side, y = w.y + ry * b.side, z = w.camZ + this.eye + b.up;
    const cp = Math.cos(w.pitch);
    this.cam.position.set(x, y, z);
    this.cam.up.set(0, 0, 1);
    this.cam.lookAt(x + Math.cos(w.yaw) * cp, y + Math.sin(w.yaw) * cp, z + Math.sin(w.pitch));
    this.cam.updateMatrixWorld();
  }

  private look(dx: number, dy: number) {
    const w = this.walker;
    if (!w) return;
    const k = LOOK_RAD_PER_PX * this.prefs.sens;
    w.yaw -= dx * k;
    w.pitch = THREE.MathUtils.clamp(w.pitch - dy * k, -PITCH_MAX, PITCH_MAX);
  }

  // ── pointer lock / phases ─────────────────────────────────
  private start() {
    if (!this.active || !this.dom) return;
    this.audio.init();
    this.audio.setMuted(!this.prefs.sound);
    const el = this.dom.layer;
    const fallback = () => { this.dragLook = true; this.setPhase('running'); };
    try {
      const r = el.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).catch(() => {
          if (!this.active) return;
          if (this.lockedOnce) this.setPhase('paused', true); // too soon after Esc: click again
          else fallback();
        });
      } else if (!el.requestPointerLock) fallback();
    } catch { fallback(); }
    // optimistic: running right away (pointerlockchange confirms)
    this.setPhase('running');
  }

  private onLockChange = () => {
    if (!this.active) return;
    const locked = document.pointerLockElement === this.dom?.layer;
    if (locked) { this.lockedOnce = true; this.dragLook = false; this.setPhase('running'); }
    else if (this.phase === 'running' && !this.dragLook) this.setPhase('paused');
  };

  private setPhase(p: Phase, retry = false) {
    if (p === 'paused' && this.phase !== 'paused') this.pausedAt = performance.now();
    this.phase = p;
    if (p !== 'running') this.keys.clear();
    if (this.dom) this.dom.retry.hidden = !retry;
    this.render();
  }

  // ── input ─────────────────────────────────────────────────
  private listen() {
    const on = <K extends keyof WindowEventMap>(tg: Window | Document, type: K, fn: (e: WindowEventMap[K]) => void, capture = true) => {
      tg.addEventListener(type, fn as EventListener, capture);
      this.cleanup.push(() => tg.removeEventListener(type, fn as EventListener, capture));
    };
    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => { this.keys.clear(); if (this.phase === 'running' && this.dragLook) this.setPhase('paused'); });
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', this.onLockChange));
    on(document, 'mousemove', (e) => {
      if (this.phase === 'running' && document.pointerLockElement === this.dom?.layer) this.look(e.movementX, e.movementY);
    });
    const layer = this.dom!.layer;
    // drag-to-look fallback (no pointer lock)
    layer.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'running' || !this.dragLook || e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      layer.setPointerCapture(e.pointerId);
    });
    layer.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.look(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => { if (this.drag?.id === e.pointerId) this.drag = null; };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    layer.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    layer.addEventListener('click', (e) => {
      if (this.phase === 'running') return;
      if ((e.target as HTMLElement).closest('button, input, .segmented, .walk-hud, .walk-card-ctl')) return;
      this.start();
    });
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.active) return;
    // editing shortcuts are off while walking (browser shortcuts with ⌘ / Ctrl still work)
    e.stopImmediatePropagation();
    if (e.metaKey || e.ctrlKey || e.altKey) { if (down) this.keys.clear(); return; }
    const code = e.code;
    if (!down) { this.keys.delete(code); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (document.pointerLockElement) return;                       // the browser releases the lock → pause
      if (this.phase === 'running') this.setPhase('paused');
      else if (this.phase === 'start' || performance.now() - this.pausedAt > 250) this.exit();
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (this.phase !== 'running' && (tag === 'BUTTON' || tag === 'INPUT') && (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow'))) return; // card / HUD controls
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC'];
    if (movement.includes(code)) {
      e.preventDefault();
      if (this.phase !== 'running') { if (code === 'Space') this.start(); return; }
      if (code === 'Space' && !e.repeat && this.walker?.onGround) this.input.jump = true;
      this.keys.add(code);
      return;
    }
    if (e.repeat) return;
    const kl = e.key.toLowerCase();
    // game easter egg — remove this block + src/game/ to extract
    if (kl === 't' && this.walker) {
      e.preventDefault();
      const w = this.walker, from = { x: w.x, y: w.y, z: w.z, yaw: w.yaw, pitch: w.pitch, child: this.prefs.child, sound: this.prefs.sound };
      import('../../game').then(m => {
        if (!this.active) return;
        const doc = JSON.parse(JSON.stringify(store.doc));
        this.exit();
        m.startGame({ doc, from });
      }).catch(err => console.error(err));
      return;
    }
    if (kl === 'e') { e.preventDefault(); this.setChild(!this.prefs.child, true); }
    else if (kl === 'm') { e.preventDefault(); this.setSound(!this.prefs.sound, true); }
    else if (kl === 'b') { e.preventDefault(); this.prefs.bob = !this.prefs.bob; this.save(); this.render(); }
    else if (e.key === 'Enter' && this.phase !== 'running') { e.preventDefault(); this.start(); }
  }

  // ── settings ──────────────────────────────────────────────
  setChild(child: boolean, announce = false) {
    if (this.prefs.child === child) return;
    this.prefs.child = child;
    const w = this.walker;
    if (w) {
      w.body = bodyOf(child);
      // a child is narrower: an adult can't be stuck inside a wall after the switch
      const p = findFree(w, w.x, w.y);
      w.x = p.x; w.y = p.y;
    }
    if (announce) toast(child ? t('walk.toastChild') : t('walk.toastAdult'), 1300);
    this.save(); this.render();
  }

  setSound(on: boolean, announce = false) {
    this.prefs.sound = on;
    this.audio.setMuted(!on);
    if (on && this.active) this.audio.init();
    if (announce) toast(on ? t('walk.soundOn') : t('walk.soundOff'), 1100);
    this.save(); this.render();
  }

  private save() { try { localStorage.setItem(LS_WALK, JSON.stringify(this.prefs)); } catch { /* ignore */ } }

  // ── HUD ───────────────────────────────────────────────────
  private buildDom() {
    const heightSeg = segmented<'adult' | 'child'>({
      ariaLabel: t('walk.heightAria'), size: 'sm', value: this.prefs.child ? 'child' : 'adult', cls: 'walk-seg',
      options: [{ value: 'adult', label: t('walk.adult'), kbd: 'E' }, { value: 'child', label: t('walk.child'), kbd: 'E' }],
      onChange: v => this.setChild(v === 'child'),
    });
    const soundBtn = h('button', { type: 'button', class: 'walk-icon-btn', 'aria-label': t('walk.sound'), 'aria-keyshortcuts': 'M' });
    soundBtn.addEventListener('click', () => this.setSound(!this.prefs.sound));
    const hud = h('div', { class: 'walk-hud', role: 'toolbar', 'aria-label': t('walk.title') },
      h('span', { class: 'walk-title' }, icon('walk', 16), t('walk.title')),
      h('span', { class: 'walk-sep', 'aria-hidden': 'true' }),
      heightSeg.el, soundBtn,
      h('span', { class: 'walk-sep', 'aria-hidden': 'true' }),
      h('span', { class: 'walk-esc' }, h('kbd', null, t('key.esc')), t('walk.escToExit')));
    const cross = h('div', { class: 'walk-cross', 'aria-hidden': 'true' });

    const keys = h('dl', { class: 'walk-keys' },
      h('dt', null, h('kbd', null, 'Z'), h('kbd', null, 'Q'), h('kbd', null, 'S'), h('kbd', null, 'D'), h('span', { class: 'walk-or' }, '·'), h('kbd', null, 'W'), h('kbd', null, 'A'), h('kbd', null, 'S'), h('kbd', null, 'D'), h('span', { class: 'walk-or' }, '·'), h('kbd', null, '←↑→↓')),
      h('dd', null, t('walk.keysMove')),
      h('dt', null, h('kbd', null, t('walk.mouse'))), h('dd', null, t('walk.keysLook')),
      h('dt', null, h('kbd', null, '⇧')), h('dd', null, t('walk.keysRun')),
      h('dt', null, h('kbd', null, t('walk.space'))), h('dd', null, t('walk.keysJump')),
      h('dt', null, h('kbd', null, 'C')), h('dd', null, t('walk.keysCrouch')));

    const title = h('div', { class: 'walk-card-title' });
    const sub = h('div', { class: 'walk-card-sub' });
    const retry = h('div', { class: 'walk-card-retry' }, t('walk.retry'));
    retry.hidden = true;
    const resume = h('button', { type: 'button', class: 'walk-btn primary' }, t('walk.resume'));
    const quit = h('button', { type: 'button', class: 'walk-btn' }, t('walk.quit'));
    resume.addEventListener('click', (e) => { e.stopPropagation(); this.start(); });
    quit.addEventListener('click', (e) => { e.stopPropagation(); this.exit(); });
    const btns = h('div', { class: 'walk-card-btns walk-card-ctl' }, resume, quit);
    const bobSw = switchRow({ label: t('walk.bob'), hint: t('walk.bobHint'), kbd: 'B', value: this.prefs.bob, onChange: v => { this.prefs.bob = v; this.save(); } });
    const sens = h('input', { type: 'range', min: '0.3', max: '3', step: '0.05', value: String(this.prefs.sens), 'aria-label': t('walk.sens'), class: 'walk-range' });
    sens.addEventListener('input', () => { this.prefs.sens = Number(sens.value); this.save(); });
    const settings = h('div', { class: 'walk-card-settings walk-card-ctl group' }, bobSw.el,
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, h('span', { class: 'row-text' }, t('walk.sens'))), sens));
    const card = h('div', { class: 'walk-card', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('walk.title') },
      h('div', { class: 'walk-card-icon', 'aria-hidden': 'true' }, icon('walk', 26)), title, sub, retry, btns, settings, keys,
      h('div', { class: 'walk-card-foot' }, t('walk.toggles')));
    const dragHint = h('div', { class: 'walk-drag-hint' }, t('walk.dragLook'));
    const layer = h('div', { class: 'walk-layer', 'data-ui-overlay': '' }, hud, cross, card, dragHint);
    return { layer, hud, cross, card, title, sub, retry, btns, settings, heightSeg, soundBtn, bobSw, dragHint };
  }

  private render() {
    const d = this.dom;
    if (!d) return;
    const running = this.phase === 'running';
    d.layer.classList.toggle('running', running);
    d.layer.classList.toggle('locked', running && !this.dragLook);
    d.card.hidden = running;
    d.dragHint.hidden = !(running && this.dragLook);
    const paused = this.phase === 'paused';
    d.title.textContent = paused ? t('walk.paused') : t('walk.start');
    d.sub.textContent = paused ? t('walk.pausedSub') : t('walk.startSub');
    d.btns.hidden = !paused;
    d.settings.hidden = !paused;
    d.heightSeg.set(this.prefs.child ? 'child' : 'adult');
    d.bobSw.set(this.prefs.bob);
    d.soundBtn.replaceChildren(icon(this.prefs.sound ? 'speaker' : 'speakerSlash', 17));
    d.soundBtn.classList.toggle('off', !this.prefs.sound);
    d.soundBtn.setAttribute('aria-pressed', String(this.prefs.sound));
    d.soundBtn.title = this.prefs.sound ? t('walk.soundOn') : t('walk.soundOff');
  }

  /** State for tests / debugging. */
  debug() {
    const w = this.walker;
    return {
      active: this.active, phase: this.phase, dragLook: this.dragLook, prefs: { ...this.prefs },
      pos: w ? { x: w.x, y: w.y, z: w.z } : null, eye: this.cam.position.z, eyeHeight: w?.eyeHeight,
      yaw: w ? THREE.MathUtils.radToDeg(w.yaw) : 0, pitch: w ? THREE.MathUtils.radToDeg(w.pitch) : 0,
      onGround: w?.onGround, speed: w?.speed2D ?? 0, colliders: w?.colliders.length ?? 0,
      fov: this.cam.fov, near: this.cam.near, audio: { ...this.audio.stats, state: this.audio.state },
    };
  }
  /** Test hook: put the player somewhere, heading `yawDeg`. */
  teleport(x: number, y: number, yawDeg?: number, pitchDeg?: number) {
    const w = this.walker;
    if (!w) return;
    w.place(x, y, 0);
    if (yawDeg != null) w.yaw = THREE.MathUtils.degToRad(yawDeg);
    if (pitchDeg != null) w.pitch = THREE.MathUtils.degToRad(pitchDeg);
  }
}

export const walkMode = new WalkMode();
export const toggleWalk = () => walkMode.toggle();

// Test / debug hook (dev server, or localStorage 'kallax-designer:debug' = '1').
try {
  if (import.meta.env.DEV || localStorage.getItem('kallax-designer:debug') === '1') {
    (window as unknown as { __kd?: Record<string, unknown> }).__kd = {
      ...((window as unknown as { __kd?: Record<string, unknown> }).__kd ?? {}),
      walk: walkMode, store, ui,
    };
  }
} catch { /* ignore */ }
