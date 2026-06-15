/**
 * SoundEngine — 100% procedural Web Audio API.
 * No audio files: every sound is synthesized at runtime.
 *
 * Sounds:
 *  - blip()      : soft, short move confirmation (tiny random pitch jitter)
 *  - echoSpawn() : rising two-note "uh-oh" warning when a new echo appears
 *  - death()     : low impact thud + a brief dissonant tone, then silence
 *  - a continuous, very subtle low drone for atmosphere
 *
 * Mute state is persisted in localStorage and respected on load.
 */

const MUTE_KEY = 'echo-muted';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted: boolean;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  /**
   * Browsers block audio until a user gesture. Call this from the first
   * input event. It lazily builds the audio graph and resumes the context.
   */
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.startDrone();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    if (this.ctx && this.master) {
      // smooth fade to avoid clicks
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(m ? 0 : 1, now, 0.04);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Warm, breathing low drone that sits under everything. */
  private startDrone(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const bed = ctx.createGain();
    bed.gain.value = 0.045; // very subtle
    bed.connect(this.master);

    // A few detuned low sines = a soft pad
    [55, 55.3, 110, 82.41].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = i >= 2 ? 0.18 : 0.5;
      o.connect(g);
      g.connect(bed);
      o.start();
    });

    // Slow LFO so the drone gently "breathes".
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(bed.gain);
    lfo.start();
  }

  /** Short pleasant blip with slight random pitch so it never grates. */
  blip(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    const base = 700 + (Math.random() * 130 - 65); // tiny pitch variation
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.03, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Rising two-note cue: the board just got more dangerous. */
  echoSpawn(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = [440, 587.33]; // A4 -> D5, a rising "uh-oh"
    notes.forEach((f, i) => {
      const st = t + i * 0.13;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      o.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.16, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.2);
      o.connect(g);
      g.connect(this.master!);
      o.start(st);
      o.stop(st + 0.22);
    });
  }

  /** Low impact thud + brief dissonant pair, then silence. */
  death(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Thud: pitch-dropping sine.
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.55);

    // Dissonant pair (a clashing minor-second-ish interval).
    [233.08, 246.94].forEach((f) => {
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      const g2 = ctx.createGain();
      o2.frequency.value = f;
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o2.connect(g2);
      g2.connect(this.master!);
      o2.start(t);
      o2.stop(t + 0.4);
    });
  }
}
