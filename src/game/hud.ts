// ─────────────────────────────────────────────────────────────
// Game mode — overlay DOM: canvas host, HUD (crosshair + hit marker,
// completion bar, weapon corner + switch popup, sound state, hints), the
// start / pause card and the WIN screen (canvas stars: bursting, bouncing,
// twinkling). Styles are injected with the overlay and removed with it.
// ─────────────────────────────────────────────────────────────
import { gt } from './i18n';
import type { Weapon } from './viewmodel';

const CSS = /* css */`
.kg-root { position: fixed; inset: 0; z-index: 2147483000; background: #0b0d10; color: #fff; overflow: hidden;
  font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none; cursor: default; }
.kg-root canvas.kg-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
.kg-root.locked { cursor: none; }
.kg-hud { position: absolute; inset: 0; pointer-events: none; }
.kg-hud[hidden] { display: none; }
.kg-cross { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; transform: translate(-50%, -50%); }
.kg-cross::before, .kg-cross::after { content: ""; position: absolute; background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.35); border-radius: 1px; }
.kg-cross::before { left: 10px; top: 2px; width: 2px; height: 18px; clip-path: polygon(0 0,100% 0,100% 38%,0 38%,0 62%,100% 62%,100% 100%,0 100%); }
.kg-cross::after { top: 10px; left: 2px; height: 2px; width: 18px; clip-path: polygon(0 0,38% 0,38% 100%,0 100%,0 0,62% 0,100% 0,100% 100%,62% 100%); }
.kg-cross.wide::before { top: -4px; height: 30px; } .kg-cross.wide::after { left: -4px; width: 30px; }
.kg-cross .kg-dot { position: absolute; left: 10px; top: 10px; width: 2px; height: 2px; background: #fff; border-radius: 1px; }
.kg-hit { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; transform: translate(-50%, -50%) rotate(45deg); opacity: 0; }
.kg-hit::before, .kg-hit::after { content: ""; position: absolute; background: #ffd36b; }
.kg-hit::before { left: 16px; top: 0; width: 2px; height: 34px; clip-path: polygon(0 0,100% 0,100% 32%,0 32%,0 68%,100% 68%,100% 100%,0 100%); }
.kg-hit::after { top: 16px; left: 0; height: 2px; width: 34px; clip-path: polygon(0 0,32% 0,32% 100%,0 100%,0 0,68% 0,100% 0,100% 100%,68% 100%); }
.kg-hit.on { animation: kg-hit .28s ease-out; }
.kg-hit.kill::before, .kg-hit.kill::after { background: #ff6b5b; }
@keyframes kg-hit { 0% { opacity: 1; transform: translate(-50%,-50%) rotate(45deg) scale(.7); } 100% { opacity: 0; transform: translate(-50%,-50%) rotate(45deg) scale(1.15); } }

.kg-progress { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); width: min(420px, 60vw);
  padding: 8px 12px 10px; border-radius: 12px; background: rgba(16,18,22,.55); backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%); box-shadow: 0 6px 24px rgba(0,0,0,.35), inset 0 0 0 .5px rgba(255,255,255,.14); }
.kg-progress-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.78); margin-bottom: 6px; }
.kg-progress-row b { font: 700 15px/1 ui-monospace, "SF Mono", Menlo, monospace; color: #fff; letter-spacing: 0; text-transform: none; }
.kg-bar { position: relative; height: 8px; border-radius: 5px; background: rgba(255,255,255,.14); overflow: hidden; }
.kg-bar i { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 5px;
  background: linear-gradient(90deg, #ffb340, #ff6a3d 60%, #ff3d6e); box-shadow: 0 0 12px rgba(255,120,60,.7); transition: width .25s ease-out; }
.kg-bar i::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); animation: kg-shine 1.8s linear infinite; }
@keyframes kg-shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
.kg-progress.bump { animation: kg-bump .3s ease-out; }
@keyframes kg-bump { 40% { transform: translateX(-50%) scale(1.05); } }

.kg-weapon { position: absolute; left: 22px; bottom: 22px; display: flex; align-items: center; gap: 10px; padding: 10px 14px 10px 12px;
  border-radius: 12px; background: rgba(16,18,22,.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 6px 24px rgba(0,0,0,.35), inset 0 0 0 .5px rgba(255,255,255,.14); }
.kg-weapon svg { width: 34px; height: 34px; color: #fff; }
.kg-weapon .kg-wname { font-weight: 650; font-size: 14px; }
.kg-weapon .kg-wkey { font-size: 11px; color: rgba(255,255,255,.6); }
.kg-pop { position: absolute; left: 50%; top: 64%; transform: translate(-50%, 0); display: flex; flex-direction: column; align-items: center; gap: 6px;
  opacity: 0; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.kg-pop svg { width: 64px; height: 64px; filter: drop-shadow(0 3px 10px rgba(0,0,0,.5)); }
.kg-pop span { font: 700 18px/1 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; letter-spacing: .02em; }
.kg-pop.on { animation: kg-pop 1.3s ease-out; }
@keyframes kg-pop { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.9); } 15% { opacity: 1; transform: translate(-50%, 0) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; } }
.kg-hints { position: absolute; right: 22px; bottom: 26px; font-size: 12px; color: rgba(255,255,255,.72); text-shadow: 0 1px 4px rgba(0,0,0,.6); }
.kg-sound { position: absolute; right: 22px; top: 22px; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  background: rgba(16,18,22,.55); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.14); }
.kg-sound svg { width: 18px; height: 18px; }
.kg-sound.off { color: #ff8a7a; }
.kg-toast { position: absolute; left: 50%; bottom: 90px; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px; background: rgba(16,18,22,.7); font-size: 12.5px; opacity: 0; transition: opacity .2s; }
.kg-toast.on { opacity: 1; }

.kg-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 400px; max-width: calc(100% - 32px);
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 24px 22px 18px; border-radius: 18px;
  color: #f4f6fa; background: rgba(22,24,30,.72); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
  box-shadow: 0 24px 60px rgba(0,0,0,.5), inset 0 0 0 .5px rgba(255,255,255,.16); animation: kg-in .25s ease-out; cursor: pointer; }
.kg-card[hidden], .kg-win[hidden], .kg-card [hidden] { display: none !important; }
@keyframes kg-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.97); } }
.kg-card-icon { width: 54px; height: 54px; border-radius: 14px; display: grid; place-items: center; margin-bottom: 8px;
  background: linear-gradient(180deg, #ff8a3d, #e0452c); box-shadow: 0 3px 10px rgba(0,0,0,.35), inset 0 0 0 .5px rgba(255,255,255,.3); }
.kg-card-icon svg { width: 30px; height: 30px; }
.kg-card-title { font: 700 19px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; letter-spacing: -.01em; }
.kg-card-sub { font-size: 12.5px; color: rgba(255,255,255,.66); }
.kg-card-goal { margin-top: 6px; font-size: 13px; color: #ffcf8a; }
.kg-card-retry { font-size: 12px; color: #ffcc66; }
.kg-btns { display: flex; gap: 8px; width: 100%; margin-top: 14px; }
.kg-btn { flex: 1; height: 34px; border: 0; border-radius: 9px; font: 650 13px/1 inherit; font-family: inherit; color: #fff; background: rgba(255,255,255,.12); cursor: pointer; transition: background .15s, transform .1s; }
.kg-btn:hover { background: rgba(255,255,255,.2); } .kg-btn:active { transform: scale(.98); }
.kg-btn.primary { background: linear-gradient(180deg, #ff8a3d, #e5502e); } .kg-btn.primary:hover { filter: brightness(1.08); }
.kg-btn:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
.kg-keys { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin-top: 16px; width: 100%; text-align: left; font-size: 12px; color: rgba(255,255,255,.75); }
.kg-keys dt { display: flex; gap: 3px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.kg-keys dd { margin: 0; align-self: center; }
.kg-keys kbd, .kg-hints kbd { display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 5px; font: 600 11px/16px ui-monospace, "SF Mono", Menlo, monospace;
  text-align: center; color: #fff; background: rgba(255,255,255,.14); box-shadow: inset 0 -1px 0 rgba(0,0,0,.35); }
.kg-or { opacity: .45; margin: 0 2px; }
.kg-drag-hint { position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%); font-size: 12px; color: rgba(255,255,255,.7); }
.kg-drag-hint[hidden] { display: none; }

/* Game HUD appears with a short reveal animation when the game starts. */
.kg-root:not(.kg-revealed) .kg-game { display: none !important; }
.kg-root:not(.kg-revealed) .kg-cross::before, .kg-root:not(.kg-revealed) .kg-cross::after { display: none; }
.kg-root:not(.kg-revealed) .kg-cross .kg-dot { opacity: .55; }
.kg-revealing .kg-progress { animation: kg-rv-top .6s cubic-bezier(.2,1.4,.4,1) both; }
.kg-revealing .kg-weapon { animation: kg-rv-left .55s .1s cubic-bezier(.2,1.4,.4,1) both; }
.kg-revealing .kg-hints, .kg-revealing .kg-sound { animation: kg-fade .5s .25s both; }
.kg-revealing .kg-cross { animation: kg-rv-cross .45s cubic-bezier(.2,1.8,.4,1) both; }
.kg-revealing .kg-hud::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(255,90,40,.35)); animation: kg-rv-flash .7s ease-out both; }
@keyframes kg-rv-top { from { opacity: 0; transform: translate(-50%, -40px); } }
@keyframes kg-rv-left { from { opacity: 0; transform: translateX(-60px); } }
@keyframes kg-rv-cross { from { opacity: 0; transform: translate(-50%, -50%) scale(2.6) rotate(45deg); } }
@keyframes kg-rv-flash { from { opacity: 1; } to { opacity: 0; } }

.kg-win { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(ellipse at center, rgba(40,20,70,.55), rgba(5,5,12,.85)); animation: kg-fade .4s ease-out; }
@keyframes kg-fade { from { opacity: 0; } }
.kg-win canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.kg-win-title { position: relative; display: flex; gap: .02em; font: 900 clamp(90px, 18vw, 220px)/1 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Impact, sans-serif;
  letter-spacing: 0; animation: kg-win-in .9s cubic-bezier(.2,1.6,.4,1) both, kg-win-bob 2.4s ease-in-out .9s infinite; }
.kg-win-title span { display: inline-block; padding: 0 .02em; color: transparent;
  background: linear-gradient(180deg, #fff8d6 0%, #ffd34d 40%, #ff9a1f 70%, #ff5c2b 100%); -webkit-background-clip: text; background-clip: text;
  filter: drop-shadow(0 6px 0 #9b3b12) drop-shadow(0 14px 30px rgba(255,140,40,.55)); animation: kg-letter 1.6s ease-in-out infinite; }
.kg-win-title span:nth-child(2) { animation-delay: .15s; } .kg-win-title span:nth-child(3) { animation-delay: .3s; }
@keyframes kg-win-in { 0% { transform: scale(.2) rotate(-12deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: scale(1) rotate(0); } }
@keyframes kg-win-bob { 50% { transform: translateY(-10px) scale(1.03); } }
@keyframes kg-letter { 50% { transform: translateY(-8px); } }
.kg-win-sub { position: relative; font: 700 22px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.5); animation: kg-in2 .5s .5s ease-out both; }
.kg-win-stats { position: relative; font-size: 14px; color: rgba(255,255,255,.75); animation: kg-in2 .5s .65s ease-out both; }
@keyframes kg-in2 { from { opacity: 0; transform: translateY(10px); } }
.kg-win .kg-btns { position: relative; width: 340px; margin-top: 20px; animation: kg-in2 .5s .8s ease-out both; }
.kg-win .kg-btn { height: 42px; font-size: 15px; }
`;

const ICONS: Record<Weapon | 'speaker' | 'speakerOff' | 'game', string> = {
  none: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 40c-3-4-5-9-5-14V16a3 3 0 0 1 6 0v6M17 22V11a3 3 0 0 1 6 0v10M23 21V9a3 3 0 0 1 6 0v12M29 21v-9a3 3 0 0 1 6 0v14c0 6-2 10-5 14"/></svg>',
  fists: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-4a3 3 0 0 1 6 0v3M18 21v-5a3 3 0 0 1 6 0v5M24 21v-5a3 3 0 0 1 6 0v5M30 21v-3a3 3 0 0 1 6 0v8c0 7-4 12-11 12h-2c-6 0-11-4-11-10v-6z"/><path d="M12 26h9a3 3 0 0 1 0 6h-4"/></svg>',
  shotgun: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h30l3 -2h9v4H33l-1 2H21l-2 2v3l-3 6h-5l2-6H8c-3 0-5-2-5-4z"/><path d="M21 24h11M16 26l2 4"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
  game: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const kbd = (s: string) => `<kbd>${s}</kbd>`;

export class Hud {
  readonly root = el('div', 'kg-root');
  readonly canvasHost = this.root;
  private style = el('style');
  private hud = el('div', 'kg-hud');
  private cross = el('div', 'kg-cross', '<i class="kg-dot"></i>');
  private hit = el('div', 'kg-hit kg-game');
  private progress = el('div', 'kg-progress kg-game');
  private pct = el('b');
  private fill = el('i');
  private weapon = el('div', 'kg-weapon kg-game');
  private pop = el('div', 'kg-pop kg-game');
  private sound = el('div', 'kg-sound kg-game');
  private toastEl = el('div', 'kg-toast');
  readonly card = el('div', 'kg-card');
  private cardTitle = el('div', 'kg-card-title');
  private cardSub = el('div', 'kg-card-sub');
  private cardRetry = el('div', 'kg-card-retry', gt('retry'));
  readonly btnResume = el('button', 'kg-btn primary', gt('resume'));
  readonly btnQuit = el('button', 'kg-btn', gt('quit'));
  private cardBtns = el('div', 'kg-btns');
  readonly dragHint = el('div', 'kg-drag-hint', gt('dragLook'));
  readonly win = el('div', 'kg-win');
  private winCanvas = el('canvas');
  private winStats = el('div', 'kg-win-stats');
  readonly btnReplay = el('button', 'kg-btn primary', gt('replay'));
  readonly btnExit = el('button', 'kg-btn', gt('exit'));
  private stars: Stars | null = null;
  private toastTimer = 0;
  private lastPct = -1;

  constructor() {
    this.style.textContent = CSS;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', gt('title'));
    this.root.tabIndex = -1;
    const row = el('div', 'kg-progress-row');
    row.append(el('span', '', gt('completion')), this.pct);
    const bar = el('div', 'kg-bar'); bar.append(this.fill);
    this.progress.append(row, bar);
    const hints = el('div', 'kg-hints kg-game', `${kbd('T')} ${gt('keysWeapon').toLowerCase()} · ${kbd('M')} ${gt('keysSound').toLowerCase()} · ${kbd(gt('esc'))} ${gt('pauseWord')}`);
    this.hud.append(this.cross, this.hit, this.progress, this.weapon, this.pop, hints, this.sound, this.toastEl);
    // card
    const icon = el('div', 'kg-card-icon', ICONS.game);
    const goal = el('div', 'kg-card-goal', gt('goal'));
    this.cardBtns.append(this.btnResume, this.btnQuit);
    const keys = el('dl', 'kg-keys');
    const or = '<span class="kg-or">·</span>';
    const rows: [string, string][] = [
      [`${kbd('Z')}${kbd('Q')}${kbd('S')}${kbd('D')}${or}${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')}${or}${kbd('↑')}${kbd('↓')}`, gt('keysMove')],
      [`${kbd('←')}${kbd('→')}`, gt('keysTurn')],
      [kbd(gt('mouse')), gt('keysLook')],
      [kbd(gt('click')), gt('keysAttack')],
      [kbd('T'), gt('keysWeapon')],
      [kbd('⇧'), gt('keysRun')],
      [kbd(gt('space')), gt('keysJump')],
      [kbd('C'), gt('keysCrouch')],
      [kbd('M'), gt('keysSound')],
    ];
    keys.innerHTML = rows.map(([k, l]) => `<dt>${k}</dt><dd>${l}</dd>`).join('');
    this.card.append(icon, this.cardTitle, this.cardSub, goal, this.cardRetry, this.cardBtns, keys);
    // win
    const wt = el('div', 'kg-win-title', [...gt('win')].map(c => `<span>${c}</span>`).join(''));
    const ws = el('div', 'kg-win-sub', gt('winSub'));
    const wb = el('div', 'kg-btns'); wb.append(this.btnReplay, this.btnExit);
    this.win.append(this.winCanvas, wt, ws, this.winStats, wb);
    this.win.hidden = true;
    this.root.append(this.hud, this.card, this.dragHint, this.win);
    this.dragHint.hidden = true;
  }

  /** The game HUD appears (and stays for the session). */
  reveal() {
    if (this.root.classList.contains('kg-revealed')) return;
    this.root.classList.add('kg-revealed', 'kg-revealing');
    window.setTimeout(() => this.root.classList.remove('kg-revealing'), 1000);
  }
  get revealed() { return this.root.classList.contains('kg-revealed'); }

  mount() { document.head.appendChild(this.style); document.body.appendChild(this.root); }
  unmount() { this.stars?.stop(); this.stars = null; window.clearTimeout(this.toastTimer); this.root.remove(); this.style.remove(); }

  setCard(mode: 'start' | 'paused' | null, retry = false) {
    this.card.hidden = !mode;
    if (!mode) return;
    this.cardTitle.textContent = mode === 'paused' ? gt('paused') : gt('start');
    this.cardSub.textContent = mode === 'paused' ? gt('pausedSub') : gt('startSub');
    this.cardBtns.hidden = mode !== 'paused';
    this.cardRetry.hidden = !retry;
  }
  setHudVisible(v: boolean) { this.hud.hidden = !v; }
  setLocked(on: boolean) { this.root.classList.toggle('locked', on); }

  setWeapon(w: Weapon, announce: boolean) {
    const name = gt(`weapon.${w}` as 'weapon.none');
    this.weapon.innerHTML = `${ICONS[w]}<div><div class="kg-wname">${name}</div><div class="kg-wkey">${w === 'none' ? gt('noWeapon') : 'T'}</div></div>`;
    this.cross.classList.toggle('wide', w === 'shotgun');
    if (announce) {
      this.pop.innerHTML = `${ICONS[w]}<span>${name}</span>`;
      this.pop.classList.remove('on'); void this.pop.offsetWidth; this.pop.classList.add('on');
    }
  }

  setSound(on: boolean) {
    this.sound.innerHTML = on ? ICONS.speaker : ICONS.speakerOff;
    this.sound.classList.toggle('off', !on);
  }

  setCompletion(p: number) {
    const v = Math.floor(p * 100 + 1e-6);
    if (v === this.lastPct) return;
    const bump = this.lastPct >= 0 && v > this.lastPct;
    this.lastPct = v;
    this.pct.textContent = `${v} %`;
    this.fill.style.width = `${(p * 100).toFixed(2)}%`;
    if (bump) { this.progress.classList.remove('bump'); void this.progress.offsetWidth; this.progress.classList.add('bump'); }
  }

  hitMarker(kill: boolean) {
    this.hit.classList.remove('on', 'kill'); void this.hit.offsetWidth;
    this.hit.classList.add('on'); if (kill) this.hit.classList.add('kill');
  }

  toast(s: string, ms = 1200) {
    this.toastEl.textContent = s;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  showWin(stats: string) {
    this.winStats.textContent = stats;
    this.win.hidden = false;
    this.setHudVisible(false);
    this.card.hidden = true;
    this.stars?.stop();
    this.stars = new Stars(this.winCanvas);
  }
  hideWin() { this.win.hidden = true; this.stars?.stop(); this.stars = null; }
  get winVisible() { return !this.win.hidden; }
}

/** WIN screen stars: bursts from the centre, gravity bounce on the bottom edge, twinkle and spin. */
class Stars {
  private raf = 0;
  private parts: { x: number; y: number; vx: number; vy: number; r: number; a: number; va: number; hue: number; life: number; tw: number }[] = [];
  private last = 0;
  private t = 0;
  private nextBurst = 0;
  constructor(private c: HTMLCanvasElement) {
    this.raf = requestAnimationFrame(this.frame);
  }
  private burst(n: number) {
    const W = this.c.width, H = this.c.height, dpr = window.devicePixelRatio || 1;
    const cx = W * (0.3 + Math.random() * 0.4), cy = H * (0.3 + Math.random() * 0.2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (250 + Math.random() * 650) * dpr;
      this.parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 300 * dpr, r: (6 + Math.random() * 14) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 8,
        hue: 35 + Math.random() * 25 + (Math.random() < 0.2 ? 280 : 0), life: 2.5 + Math.random() * 2.5, tw: Math.random() * 10 });
    }
  }
  private frame = (now: number) => {
    const c = this.c, dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now; this.t += dt;
    if (this.t >= this.nextBurst) { this.burst(this.parts.length ? 26 : 70); this.nextBurst = this.t + 0.9 + Math.random() * 0.6; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const next: typeof this.parts = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += 900 * dpr * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > H - p.r) { p.y = H - p.r; p.vy *= -0.55; p.vx *= 0.8; }
      if (p.x < p.r || p.x > W - p.r) p.vx *= -1;
      p.a += p.va * dt;
      const tw = 0.65 + 0.35 * Math.sin(this.t * 12 + p.tw);
      const al = Math.min(1, p.life / 0.8) * tw;
      star(g, p.x, p.y, p.r, p.a, `hsla(${p.hue},100%,62%,${al})`, `hsla(${p.hue},100%,88%,${al})`);
      // sparkle cross
      if (Math.sin(this.t * 7 + p.tw * 3) > 0.92) {
        g.strokeStyle = `rgba(255,255,240,${al})`; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(p.x - p.r * 1.8, p.y); g.lineTo(p.x + p.r * 1.8, p.y); g.moveTo(p.x, p.y - p.r * 1.8); g.lineTo(p.x, p.y + p.r * 1.8); g.stroke();
      }
      next.push(p);
    }
    this.parts = next;
    this.raf = requestAnimationFrame(this.frame);
  };
  stop() { cancelAnimationFrame(this.raf); }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, fill: string, core: string) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r, an = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i) g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); else g.moveTo(Math.cos(an) * rr, Math.sin(an) * rr);
  }
  g.closePath();
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, core); gr.addColorStop(1, fill);
  g.fillStyle = gr; g.fill();
  g.restore();
}
