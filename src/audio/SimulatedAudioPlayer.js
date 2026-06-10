// Drives progress via setInterval — same cadence (0.6s ticks) as the old
// inline player loop in app.jsx. Behaves like a real player so the rest of
// the app doesn't need to know whether audio is real or simulated.
//
// Retained as the fallback factory option (createAudioPlayer({ kind: 'sim' }))
// for tests with no audio fixture. HtmlAudioPlayer is the production default.
import { EQ_FLAT, sanitizeGains } from './eqConfig.js';

const TICK_MS = 600;
const TICK_FRACTION = 0.6;

export class SimulatedAudioPlayer {
  constructor() {
    this._track = null;
    this._progress = 0;
    this._playing = false;
    this._interval = null;
    this._listeners = new Map();
    this._volume = 1;
    this._muted = false;
    this._eqGains = EQ_FLAT.slice();
  }

  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v)));
    if (!Number.isFinite(clamped)) return;
    this._volume = clamped;
    this._emit('volume', clamped);
  }
  getVolume() { return this._volume; }
  setMuted(b) { this._muted = !!b; this._emit('muted', this._muted); }
  isMuted() { return this._muted; }

  // No real DSP in sim mode — just hold the values so the EQ UI has a consistent
  // contract across both players.
  setEqBand(i, db) {
    const v = Math.max(-12, Math.min(12, Number(db)));
    if (!Number.isFinite(v) || i < 0 || i >= this._eqGains.length) return;
    this._eqGains[i] = v;
    this._emit('eq', this._eqGains.slice());
  }
  setEqGains(arr) { this._eqGains = sanitizeGains(arr); this._emit('eq', this._eqGains.slice()); }
  getEqGains() { return this._eqGains.slice(); }

  async load(track) {
    this._track = track;
    this._progress = 0;
    this._emit('progress', this._progress);
  }

  async play() {
    if (this._playing || !this._track) return;
    this._playing = true;
    this._interval = setInterval(() => this._tick(), TICK_MS);
    this._emit('play');
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    clearInterval(this._interval);
    this._interval = null;
    this._emit('pause');
  }

  seek(p) {
    this._progress = Math.max(0, Math.min(1, p));
    this._emit('progress', this._progress);
  }

  getProgress() { return this._progress; }
  getDurationSec() { return this._track ? this._track.durationSec : 0; }

  on(evt, cb) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
    return () => this._listeners.get(evt)?.delete(cb);
  }

  destroy() {
    this.pause();
    this._listeners.clear();
    this._track = null;
  }

  _tick() {
    if (!this._track) return;
    this._progress += TICK_FRACTION / this._track.durationSec;
    if (this._progress >= 1) {
      this._progress = 0;
      this._emit('ended');
    } else {
      this._emit('progress', this._progress);
    }
  }

  _emit(evt, ...args) {
    this._listeners.get(evt)?.forEach(cb => cb(...args));
  }
}
