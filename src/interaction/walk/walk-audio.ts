// ─────────────────────────────────────────────────────────────
// First-person walk — synthesised footsteps (WebAudio, no sound files).
//
// Each footfall = a short band-passed noise burst (sole on the floor) with a
// quieter "toe" scuff ~40 ms later, plus a low sine thump with a falling
// pitch (body weight), with slight random pitch / gain / timbre variations
// and alternating left / right stereo pan. Running: louder, brighter,
// shorter; child: lighter and higher. Landing after a jump: both feet + a
// deeper thump. The AudioContext is created on the user's click (autoplay
// policy); every node is disconnected when it ends.
// ─────────────────────────────────────────────────────────────

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Footsteps {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  /** Counters (tests / debugging). */
  readonly stats = { steps: 0, lands: 0, nodes: 0, errors: 0 };

  /** Create / resume the context — call from a user gesture. */
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.8;
        master.connect(comp); comp.connect(ctx.destination);
        // 0.5 s of white noise, shared by every burst
        const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.5), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx; this.master = master; this.noise = buf;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) { this.stats.errors++; console.warn('walk audio', e); }
  }

  get ready() { return !!this.ctx; }
  get state(): string { return this.ctx?.state ?? 'none'; }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }

  suspend() { if (this.ctx?.state === 'running') void this.ctx.suspend(); }

  /** One footfall. */
  step(foot: 0 | 1, o: { run: boolean; child: boolean; crouch: boolean }) {
    this.stats.steps++;
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + 0.005;
      const pan = (foot ? 1 : -1) * rand(0.16, 0.28);
      const loud = (o.run ? 1.35 : 1) * (o.crouch ? 0.55 : 1) * (o.child ? 0.75 : 1) * rand(0.82, 1.08);
      const bright = (o.run ? 1.35 : 1) * (o.child ? 1.25 : 1) * rand(0.85, 1.18);
      const out = this.panner(pan, t + 0.5);
      this.burst(out, t, 0.34 * loud, 950 * bright, o.run ? 0.075 : 0.11);
      this.burst(out, t + rand(0.035, 0.05), 0.12 * loud, 1700 * bright, 0.05);
      this.thump(out, t, 0.5 * loud, (o.child ? 115 : 82) * rand(0.9, 1.1), o.run ? 0.1 : 0.13);
    } catch (e) { this.stats.errors++; console.warn('walk audio', e); }
  }

  /** Landing after a fall: strength 0…1. */
  land(strength: number, child: boolean) {
    this.stats.lands++;
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + 0.005;
      const k = 0.55 + 0.6 * strength;
      const out = this.panner(0, t + 0.6);
      this.burst(out, t, 0.36 * k, 800, 0.12);
      this.burst(out, t + 0.022, 0.3 * k, 900, 0.1);
      this.thump(out, t, 0.75 * k, child ? 85 : 58, 0.24);
    } catch (e) { this.stats.errors++; console.warn('walk audio', e); }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null; this.master = null; this.noise = null;
  }

  // ── voices ─────────────────────────────────────────────────
  private panner(pan: number, end: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.stats.nodes++;
    if (!p) return this.master!;
    p.pan.value = pan;
    p.connect(this.master!);
    window.setTimeout(() => p.disconnect(), Math.max(0, (end - ctx.currentTime) * 1000) + 50);
    return p;
  }

  private burst(out: AudioNode, t: number, gain: number, freq: number, dur: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rand(0.85, 1.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = rand(0.7, 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    src.start(t, rand(0, 0.3), dur + 0.02);
    src.onended = () => { src.disconnect(); bp.disconnect(); lp.disconnect(); g.disconnect(); };
    this.stats.nodes += 4;
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
    this.stats.nodes += 2;
  }
}
