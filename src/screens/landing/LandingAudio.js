// A tiny self-contained generative ambient pad for the hero orb — REAL sound via
// Web Audio (a few detuned oscillators on a soft chord + an amplitude tremolo so
// the level rises/falls), routed through an AnalyserNode so the orb can react to
// it. No bundled audio file, no licensing. Created on a user gesture (browsers
// block autoplay-with-sound). Standalone — not coupled to the in-app players.
const CHORD = [110, 164.81, 220, 277.18]; // A2 / E3 / A3 / C#4 — warm, open

export class LandingAudio {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.lfoGain = null;
    this.oscs = [];
    this.lfo = null;
    this.playing = false;
  }

  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;                  // silent until play() ramps it up
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    // Soft detuned chord.
    this.oscs = CHORD.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 7;
      const g = ctx.createGain();
      g.gain.value = 0.14 / CHORD.length;
      o.connect(g); g.connect(master);
      o.start();
      return o;
    });

    // Slow amplitude tremolo → the level breathes so the orb visibly pulses.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;                  // ramped in on play
    lfo.connect(lfoGain); lfoGain.connect(master.gain);
    lfo.start();

    this.ctx = ctx; this.master = master; this.analyser = analyser;
    this.lfo = lfo; this.lfoGain = lfoGain;
    return true;
  }

  async play() {
    try {
      if (!this.ctx && !this._build()) return false;
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.55, t, 0.4);   // fade in
      this.lfoGain.gain.setTargetAtTime(0.18, t, 0.5);  // tremolo depth
      this.playing = true;
      return true;
    } catch { return false; }
  }

  pause() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0.0001, t, 0.3);
    this.lfoGain.gain.setTargetAtTime(0, t, 0.3);
    this.playing = false;
  }

  getAnalyser() { return this.analyser; }

  destroy() {
    try { this.oscs.forEach((o) => o.stop()); } catch { /* already stopped */ }
    try { this.lfo?.stop(); } catch { /* already stopped */ }
    try { this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = this.analyser = this.master = this.lfo = this.lfoGain = null;
    this.oscs = [];
  }
}
