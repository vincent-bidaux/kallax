// ─────────────────────────────────────────────────────────────
// Game mode — audio (one AudioContext per session, closed on exit).
//
// Samples (CC0, public/game-audio/, see LICENSES.md), fetched when the game
// starts: Kenney "Impact Sounds" (punch thuds, wood / plank breaks, light
// debris, metal, soft) and Kenney "RPG Audio" (metal latch + click = pump
// rack, cloth = raising the fists).
// Synthesised (WebAudio): footsteps (copied from the walk mode), the effort
// grunt "han" (glottal pulse train through "a / uh" formants, pitch drop,
// breath, nasal end), punch whoosh, shotgun blast (crack + body + sub boom +
// room tail), wood cracks, victory arpeggio. A synthetic room impulse
// response gives the blasts a short reverb. Every voice disconnects when done.
// ─────────────────────────────────────────────────────────────

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const BASE = (import.meta.env.BASE_URL || '/') + 'game-audio/';

const SAMPLES: Record<string, string[]> = {
  punch: ['impact_punch_heavy_000', 'impact_punch_heavy_001', 'impact_punch_heavy_002'],
  woodHeavy: ['impact_wood_heavy_000', 'impact_wood_heavy_001', 'impact_wood_heavy_002'],
  plank: ['impact_plank_medium_000', 'impact_plank_medium_001', 'impact_plank_medium_002'],
  woodLight: ['impact_wood_light_000', 'impact_wood_light_001', 'impact_wood_light_002', 'impact_wood_light_003'],
  generic: ['impact_generic_light_000', 'impact_generic_light_001'],
  metal: ['impact_metal_light_000', 'impact_metal_light_001'],
  soft: ['impact_soft_medium_000', 'impact_soft_medium_001'],
  latch: ['metal_latch'],
  click: ['metal_click'],
  cloth: ['cloth_1'],
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  private muted = false;
  private lastDebris = 0;
  private debrisWindow: number[] = [];
  readonly stats = { steps: 0, samples: 0, synth: 0, loaded: 0, failed: 0, debris: 0, errors: 0, played: {} as Record<string, number> };

  get state(): string { return this.ctx?.state ?? 'none'; }
  get isMuted() { return this.muted; }

  /** Create / resume the context — call from a user gesture. Starts loading the samples. */
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.9;
        master.connect(comp); comp.connect(ctx.destination);
        const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.0), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const rev = ctx.createConvolver();
        rev.buffer = roomIR(ctx, 1.1);
        const revGain = ctx.createGain(); revGain.gain.value = 0.5;
        rev.connect(revGain); revGain.connect(master);
        this.ctx = ctx; this.master = master; this.noise = buf; this.reverb = rev;
        void this.load();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) { this.stats.errors++; console.warn('game audio', e); }
  }

  private async load() {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(Object.entries(SAMPLES).map(async ([k, names]) => {
      const list: AudioBuffer[] = [];
      for (const n of names) {
        try {
          const r = await fetch(`${BASE}${n}.ogg`);
          if (!r.ok) throw new Error(String(r.status));
          const ab = await r.arrayBuffer();
          if (this.ctx !== ctx) return;
          list.push(await ctx.decodeAudioData(ab));
          this.stats.loaded++;
        } catch { this.stats.failed++; }
      }
      if (list.length) this.buffers.set(k, list);
    }));
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }
  suspend() { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  resume() { if (this.ctx?.state === 'suspended') void this.ctx.resume(); }

  dispose() {
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.master = null; this.noise = null; this.reverb = null;
    this.buffers.clear();
  }

  private count(name: string) { this.stats.played[name] = (this.stats.played[name] ?? 0) + 1; }
  private ok() { return !!this.ctx && !this.muted && this.ctx.state !== 'closed'; }

  // ── sample playback ────────────────────────────────────────
  /** Play a random variant of a sample set; false when it isn't loaded. */
  sample(set: string, o: { gain?: number; rate?: number; pan?: number; delay?: number; wet?: number } = {}): boolean {
    this.count(set);
    if (!this.ok()) return false;
    const list = this.buffers.get(set);
    if (!list?.length) return false;
    try {
      const ctx = this.ctx!;
      const t = ctx.currentTime + (o.delay ?? 0) + 0.003;
      const src = ctx.createBufferSource();
      src.buffer = list[Math.floor(Math.random() * list.length)];
      src.playbackRate.value = o.rate ?? rand(0.93, 1.07);
      const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
      const out = this.panner(o.pan ?? 0, t + src.buffer.duration / src.playbackRate.value + 0.1);
      src.connect(g); g.connect(out);
      let send: GainNode | null = null;
      if (o.wet && this.reverb) { send = ctx.createGain(); send.gain.value = o.wet; g.connect(send); send.connect(this.reverb); }
      src.start(t);
      src.onended = () => { src.disconnect(); g.disconnect(); send?.disconnect(); };
      this.stats.samples++;
      return true;
    } catch (e) { this.stats.errors++; console.warn('game audio', e); return false; }
  }

  // ── game events ────────────────────────────────────────────
  /** Effort grunt "han" (synthesised voice). */
  grunt() {
    this.count('grunt');
    if (!this.ok()) return;
    try {
      const ctx = this.ctx!;
      const t = ctx.currentTime + 0.004;
      const f0 = rand(118, 142), dur = rand(0.27, 0.33);
      const out = this.panner(0, t + dur + 0.3);
      const voice = ctx.createGain(); voice.gain.value = 0;
      // glottal source: harmonics falling ~12 dB / octave
      const N = 40, re = new Float32Array(N), im = new Float32Array(N);
      for (let k = 1; k < N; k++) im[k] = (k % 2 ? 1 : 0.85) / Math.pow(k, 1.15);
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(re, im));
      osc.frequency.setValueAtTime(f0 * 1.08, t);
      osc.frequency.linearRampToValueAtTime(f0 * 1.18, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + dur);
      // vocal strain: slight jitter
      const lfo = ctx.createOscillator(); lfo.frequency.value = rand(24, 31);
      const lfoG = ctx.createGain(); lfoG.gain.value = f0 * 0.025;
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.2);
      osc.connect(shaper);
      // formants "a/uh" (F1 700, F2 1220, F3 2600) → nasal "n" at the end (F1 ↓ 280)
      const formants: [number, number, number, number][] = [[700, 280, 9, 1], [1220, 1450, 11, 0.55], [2600, 2500, 13, 0.22], [3400, 3300, 14, 0.08]];
      for (const [fa, fb, q, gn] of formants) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
        bp.frequency.setValueAtTime(fa, t);
        bp.frequency.setValueAtTime(fa, t + dur * 0.55);
        bp.frequency.exponentialRampToValueAtTime(fb, t + dur * 0.92);
        const g = ctx.createGain(); g.gain.value = gn * 2.2;
        shaper.connect(bp); bp.connect(g); g.connect(voice);
      }
      // breath: aspirated "h" onset + a little breath through the voice
      const nz = ctx.createBufferSource(); nz.buffer = this.noise; nz.loop = true;
      const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 1500; nbp.Q.value = 0.7;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      nz.connect(nbp); nbp.connect(ng); ng.connect(out);
      // voice envelope: after the "h", fast swell, short sustain, nasal decay
      voice.gain.setValueAtTime(0.0001, t);
      voice.gain.setValueAtTime(0.0001, t + 0.035);
      voice.gain.exponentialRampToValueAtTime(0.55, t + 0.07);
      voice.gain.setValueAtTime(0.5, t + dur * 0.5);
      voice.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.85);
      voice.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      voice.connect(lp); lp.connect(out);
      osc.start(t); lfo.start(t); nz.start(t, rand(0, 0.5));
      osc.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02); nz.stop(t + dur + 0.02);
      osc.onended = () => { osc.disconnect(); lfo.disconnect(); lfoG.disconnect(); shaper.disconnect(); voice.disconnect(); lp.disconnect(); nz.disconnect(); nbp.disconnect(); ng.disconnect(); };
      this.stats.synth++;
    } catch (e) { this.stats.errors++; console.warn('game audio', e); }
  }

  /** Air swish of a punch. */
  whoosh() {
    this.count('whoosh');
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.005;
    const out = this.panner(0.2, t + 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.09); bp.frequency.exponentialRampToValueAtTime(900, t + 0.22);
    this.noiseVoice(out, t, 0.32, 0.22, bp, 0.03);
  }

  /** Fist hitting something: real punch thud + low body. */
  punchHit(strength = 1) {
    if (!this.sample('punch', { gain: 0.9 * strength, rate: rand(0.9, 1.05) })) this.thumpSynth(0.8 * strength, 90, 0.16);
    this.thumpSynth(0.35 * strength, 70, 0.12);
  }

  /** Wood breaking (size 0…1): sample + synthetic cracks. */
  woodBreak(size = 0.5, kind: 'wood' | 'metal' | 'soft' = 'wood') {
    if (kind === 'soft') { this.sample('soft', { gain: 0.8 + size * 0.4 }); return; }
    if (kind === 'metal') { this.sample('metal', { gain: 0.8, rate: rand(0.85, 1) }); }
    this.sample(size > 0.5 ? 'woodHeavy' : 'plank', { gain: 0.7 + size * 0.5, rate: rand(0.85, 1.05), wet: 0.25 });
    if (size > 0.6) this.sample('plank', { gain: 0.6, delay: rand(0.03, 0.08), rate: rand(0.8, 0.95) });
    this.cracks(0.35 + size * 0.4);
  }

  /** A piece of debris landing (speed in cm/s). Rate-limited. */
  debris(speed: number, kind: 'wood' | 'metal' | 'soft', pan = 0) {
    if (!this.ok()) return;
    const now = this.ctx!.currentTime;
    this.debrisWindow = this.debrisWindow.filter(x => now - x < 0.25);
    if (this.debrisWindow.length >= 4 || now - this.lastDebris < 0.022) return;
    const v = Math.min(1, Math.max(0, (speed - 60) / 600));
    if (v <= 0.02) return;
    this.debrisWindow.push(now); this.lastDebris = now;
    this.stats.debris++;
    const set = kind === 'metal' ? 'metal' : kind === 'soft' ? 'soft' : (Math.random() < 0.7 ? 'woodLight' : 'generic');
    this.sample(set, { gain: 0.12 + 0.6 * v * v, rate: rand(0.9, 1.25), pan });
  }

  /** Pump-action shotgun blast. */
  shotgun() {
    this.count('shotgun');
    if (!this.ok()) return;
    try {
      const ctx = this.ctx!, t = ctx.currentTime + 0.004;
      const out = this.panner(0, t + 1.6);
      const sh = ctx.createWaveShaper(); sh.curve = softClip(3);
      const bus = ctx.createGain(); bus.gain.value = 0.9;
      bus.connect(sh); sh.connect(out);
      const send = ctx.createGain(); send.gain.value = 0.55; bus.connect(send); if (this.reverb) send.connect(this.reverb);
      // crack
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      this.noiseVoice(bus, t, 0.012, 1.1, hp, 0.0008);
      // body
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
      this.noiseVoice(bus, t, 0.26, 1.0, lp, 0.001);
      // mid "pop"
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.2;
      this.noiseVoice(bus, t, 0.35, 0.9, bp, 0.002);
      // sub boom
      for (const [f0, f1, g, d] of [[120, 38, 1.1, 0.32], [72, 30, 0.8, 0.45]] as const) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d * 0.8);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(g, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(og); og.connect(bus);
        o.start(t); o.stop(t + d + 0.02);
        o.onended = () => { o.disconnect(); og.disconnect(); };
      }
      // room tail
      const tb = ctx.createBiquadFilter(); tb.type = 'bandpass'; tb.frequency.value = 700; tb.Q.value = 0.6;
      this.noiseVoice(send, t + 0.02, 0.9, 0.35, tb, 0.02);
      window.setTimeout(() => { bus.disconnect(); sh.disconnect(); send.disconnect(); }, 1800);
      this.stats.synth++;
    } catch (e) { this.stats.errors++; console.warn('game audio', e); }
  }

  /** Pump rack: back (latch) then forward (click). */
  pump(delay = 0) {
    this.count('pump');
    if (!this.sample('latch', { gain: 0.9, rate: rand(0.95, 1.05), delay })) this.clickSynth(delay, 2200);
    if (!this.sample('click', { gain: 0.9, rate: rand(1.0, 1.1), delay: delay + 0.17 })) this.clickSynth(delay + 0.17, 3000);
  }

  switchTo(w: 'none' | 'fists' | 'shotgun') {
    if (w === 'fists') this.sample('cloth', { gain: 0.6 });
    else if (w === 'shotgun') { this.sample('cloth', { gain: 0.4 }); this.sample('click', { gain: 0.7, delay: 0.12, rate: 0.9 }); }
    else this.sample('cloth', { gain: 0.35, rate: 0.85 });
  }

  /** Victory: bell arpeggio, final chord, shimmer. */
  victory() {
    this.count('victory');
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const out = this.panner(0, t + 4);
    const send = ctx.createGain(); send.gain.value = 0.6; if (this.reverb) send.connect(this.reverb);
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.bell(out, send, t + i * 0.1, f, 0.35, 0.9));
    for (const f of [523.25, 659.25, 783.99, 1046.5]) this.bell(out, send, t + 0.62, f, 0.22, 2.4);
    this.bell(out, send, t + 0.62, 261.63, 0.25, 2.6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    this.noiseVoice(send, t + 0.6, 1.6, 0.08, hp, 0.2);
    window.setTimeout(() => send.disconnect(), 4500);
  }

  // ── footsteps (copied from the walk mode, src/interaction/walk/walk-audio.ts) ──
  step(foot: 0 | 1, o: { run: boolean; crouch: boolean }) {
    this.stats.steps++;
    if (!this.ok()) return;
    try {
      const t = this.ctx!.currentTime + 0.005;
      const pan = (foot ? 1 : -1) * rand(0.16, 0.28);
      const loud = (o.run ? 1.35 : 1) * (o.crouch ? 0.55 : 1) * rand(0.82, 1.08);
      const bright = (o.run ? 1.35 : 1) * rand(0.85, 1.18);
      const out = this.panner(pan, t + 0.5);
      this.burst(out, t, 0.34 * loud, 950 * bright, o.run ? 0.075 : 0.11);
      this.burst(out, t + rand(0.035, 0.05), 0.12 * loud, 1700 * bright, 0.05);
      this.thump(out, t, 0.5 * loud, 82 * rand(0.9, 1.1), o.run ? 0.1 : 0.13);
    } catch (e) { this.stats.errors++; console.warn('game audio', e); }
  }

  land(strength: number) {
    if (!this.ok()) return;
    try {
      const t = this.ctx!.currentTime + 0.005;
      const k = 0.55 + 0.6 * strength;
      const out = this.panner(0, t + 0.6);
      this.burst(out, t, 0.36 * k, 800, 0.12);
      this.burst(out, t + 0.022, 0.3 * k, 900, 0.1);
      this.thump(out, t, 0.75 * k, 58, 0.24);
    } catch (e) { this.stats.errors++; console.warn('game audio', e); }
  }

  /** A whole item landing after a fall. */
  itemLand(size: number) {
    this.sample('woodHeavy', { gain: 0.5 + 0.5 * size, rate: rand(0.75, 0.9), wet: 0.3 });
    this.thumpSynth(0.5 + 0.4 * size, 60, 0.25);
  }

  // ── voices ─────────────────────────────────────────────────
  private panner(pan: number, end: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (!p) return this.master!;
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master!);
    window.setTimeout(() => p.disconnect(), Math.max(0, (end - ctx.currentTime) * 1000) + 80);
    return p;
  }

  private noiseVoice(out: AudioNode, t: number, dur: number, gain: number, filter: BiquadFilterNode, attack = 0.004) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = dur > 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.max(0.0005, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(out);
    src.start(t, rand(0, 0.05), dur + 0.03);
    src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); };
  }

  private burst(out: AudioNode, t: number, gain: number, freq: number, dur: number) {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = rand(0.7, 1.1);
    this.noiseVoice(out, t, dur, gain, bp);
  }

  private thump(out: AudioNode, t: number, gain: number, f0: number, dur: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }

  private thumpSynth(gain: number, f0: number, dur: number) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime + 0.003;
    this.thump(this.panner(0, t + dur + 0.1), t, gain, f0, dur);
  }

  private cracks(gain: number) {
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime + 0.004;
    const out = this.panner(rand(-0.2, 0.2), t + 0.4);
    for (let i = 0; i < 5; i++) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1800, 4200); bp.Q.value = rand(2, 5);
      this.noiseVoice(out, t + i * rand(0.008, 0.022), rand(0.02, 0.05), gain * rand(0.4, 1), bp, 0.0008);
    }
  }

  private clickSynth(delay: number, f: number) {
    if (!this.ok()) return;
    const ctx = this.ctx!, t = ctx.currentTime + delay + 0.003;
    const out = this.panner(0.15, t + 0.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    this.noiseVoice(out, t, 0.05, 0.7, bp, 0.0008);
  }

  private bell(out: AudioNode, send: AudioNode, t: number, f: number, gain: number, dur: number) {
    const ctx = this.ctx!;
    for (const [mult, g0] of [[1, 1], [2.01, 0.35], [3.98, 0.12]] as const) {
      const o = ctx.createOscillator(); o.type = mult === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * g0, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mult);
      o.connect(g); g.connect(out); g.connect(send);
      o.start(t); o.stop(t + dur + 0.05);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
  }
}

function softClip(k: number): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

/** Small-room impulse response: decaying stereo noise, darker over time. */
function roomIR(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / n;
      const k = 0.15 + 0.8 * tt;                    // one-pole low-pass, darker as it decays
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - tt, 3.2) * (i < ctx.sampleRate * 0.004 ? 0.2 : 1);
    }
  }
  return b;
}
