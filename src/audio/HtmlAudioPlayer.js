import { EQ_FREQS, EQ_FLAT, sanitizeGains, dbToGain } from './eqConfig.js';
import { getAudioQuality, subscribeAudioQuality, bitrateFor, qualityLadder } from '../lib/audioQuality.js';
import { isIOS } from '../lib/platform.js';

// EQ boosts add level the source (loud-mastered AAC near 0 dBFS) has no room
// for, so the graph hard-clips at ctx.destination — crackle. Two stages give it
// headroom: a makeup GainNode pre-attenuates by the peak boost, and a brick-wall
// limiter sits right at the 0 dBFS clip ceiling. The makeup keeps flat/cuts and
// every realistic boost at or below full scale (verified: presets land ≥2 dB
// under), so the limiter is inert there — fully transparent — and engages only
// on pathological multi-band overshoot (e.g. several bands slammed to +12) that
// would otherwise hard-clip.
const EQ_HEADROOM_MARGIN_DB = 3.0;  // covers typical adjacent-peak crossover sum
const EQ_GAIN_RAMP_TC = 0.02;       // setTargetAtTime time-constant (~60 ms to track)

// Real audio via HTMLAudioElement. Plays track.streamUrl (catalog CDN mp4).
// Tracks without a streamUrl (e.g. the mock demo catalog) become no-ops:
// load/play/pause silently succeed so the UI doesn't crash.
export class HtmlAudioPlayer {
  constructor() {
    this._el = new Audio();
    // Route the stream through Web Audio (for the equalizer) without the browser
    // muting it as tainted cross-origin media. The catalog CDN sends
    // `Access-Control-Allow-Origin: *`, so anonymous CORS succeeds. Must be set
    // before any src is assigned.
    this._el.crossOrigin = 'anonymous';
    this._silent = true;
    this._listeners = new Map();
    this._raf = 0;
    this._lastEmit = 0;
    // Web Audio EQ graph — built lazily, and only when the EQ is actually in use
    // (first slider/preset touch, or first play with a saved non-flat preset).
    // Until then the bare <audio> element plays untapped, which is what iOS keeps
    // alive on the lock screen — tapping via createMediaElementSource forfeits
    // native background playback. createMediaElementSource can run only once.
    this._ctx = null;
    this._src = null;
    this._bands = null;
    this._makeup = null;   // pre-EQ attenuation for boost headroom
    this._limiter = null;  // brick-wall safety for residual crossover overshoot
    this._eqGains = EQ_FLAT.slice();
    // Tracks user/app intent to be playing, independent of the element's actual
    // paused state — iOS can pause the element on screen-lock without us asking,
    // so on return to foreground we re-arm playback if we still mean to play.
    this._intendedPlaying = false;
    // HTMLAudio's native `timeupdate` cadence is browser-dependent (~250 ms
    // to ~1 s). We drive a rAF loop while playing and gate the emit to 250 ms
    // so every browser gets the same even ~4 Hz progress signal — enough for
    // line-synced lyrics and the seek bar. Each emit re-renders the whole App
    // tree (setProgress/setAudioTime in App.jsx), so the old ~30 Hz cap
    // ground low-end phones to a halt under the blurred player backdrop.
    // Bind handlers once and store them so destroy() can remove them.
    this._onTimeUpdate = () => this._emitProgress();
    this._onEnded     = () => { this._stopTick(); this._emit('ended'); };
    this._onPlay      = () => { this._startTick(); this._emit('play'); };
    this._onPause     = () => { this._stopTick(); this._emit('pause'); };
    // While a quality-ladder probe is in flight, a candidate that doesn't exist
    // (e.g. a track with no 320 variant) fires this 'error' too — but that's an
    // expected "this bitrate is missing, try the next" signal, NOT a playback
    // failure. Swallow it: _loadUrl handles the descent and emits a real 'error'
    // only if EVERY candidate fails. Surfacing probe misses here used to trip
    // App's expired-URL recovery, which refetched + reloaded the track mid-
    // descent and made playback stutter/restart/skip.
    this._onError     = (e) => { if (this._probing) return; this._stopTick(); this._emit('error', e); };
    // Native `seeked` fires after the audio element finishes seeking. Emitting
    // here covers the case where a seek happens during a rAF-throttled window
    // (e.g., tab backgrounded) so the UI bar snaps to the new position.
    this._onSeeked    = () => { this._lastEmit = 0; this._emitProgress(); };
    // When the tab returns to foreground, rAF resumes — but the throttle
    // window may still suppress the first emit. Reset it and snap progress.
    this._onVisible   = () => {
      if (document.hidden) return;
      // Back to foreground. Resume a context iOS auto-suspended on lock so a
      // tapped (EQ) graph isn't left silent.
      if (this._ctx?.state === 'suspended') { this._ctx.resume().catch(() => {}); }
      // iOS may have paused the element on lock even though we still mean to be
      // playing — re-arm so playback continues instead of just stopping.
      if (this._intendedPlaying && this._el.paused && !this._silent) {
        this._el.play().catch(() => {});
      }
      this._lastEmit = 0;
      this._emitProgress();
      if (!this._el.paused) this._startTick();
    };
    this._el.addEventListener('timeupdate', this._onTimeUpdate);
    this._el.addEventListener('ended', this._onEnded);
    this._el.addEventListener('play',  this._onPlay);
    this._el.addEventListener('pause', this._onPause);
    this._el.addEventListener('error', this._onError);
    this._el.addEventListener('seeked', this._onSeeked);
    document.addEventListener('visibilitychange', this._onVisible);
    // Restore volume/mute prefs so first playback respects the user's last
    // session. Bad localStorage values fall back to safe defaults.
    try {
      const v = parseFloat(localStorage.getItem('aura.volume'));
      this._el.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
      this._el.muted  = localStorage.getItem('aura.muted') === '1';
      const eq = JSON.parse(localStorage.getItem('aura.eq.gains') ?? 'null');
      if (Array.isArray(eq)) this._eqGains = sanitizeGains(eq);
    } catch { /* localStorage disabled / corrupt — leave flat defaults */ }
    // True while _loadUrl is walking the bitrate ladder (see _onError above).
    this._probing = false;
    // Monotonic load token: every load()/_setBitrate() bumps it so an older,
    // still-in-flight descent can detect it was superseded and bail instead of
    // racing a newer one over the same <audio> element.
    this._loadSeq = 0;
    // Audio quality: bitrate is a swappable suffix in the stream url (see
    // lib/audioQuality). Resolve the chosen bitrate now and react to later
    // changes by hot-reloading the current track at the new quality.
    this._baseUrl = null;
    this._bitrate = bitrateFor(getAudioQuality());
    this._unsubQuality = subscribeAudioQuality(id => this._setBitrate(bitrateFor(id)));
  }

  // Build the AudioContext graph: source → [BiquadFilter per band] → destination.
  // Idempotent + best-effort. The critical invariant: once createMediaElementSource
  // taps the element, the element's audio ONLY comes out through the graph — so the
  // tapped source MUST reach destination or playback goes silent. We therefore
  // commit _ctx the instant the tap succeeds (so we never re-tap, which would throw
  // InvalidStateError) and, if building the band chain then fails, wire the source
  // straight to destination so audio survives — just without EQ. Called lazily on
  // first EQ use (or first play with a saved preset), never on every play — see
  // the lazy-tap note in the constructor.
  _ensureGraph() {
    if (this._ctx || this._silent) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    let ctx;
    try { ctx = new Ctx(); } catch { return; }          // no context — element plays as-is
    let src;
    try {
      src = ctx.createMediaElementSource(this._el);
    } catch {                                            // tap failed — element NOT rerouted
      try { ctx.close(); } catch { /* ignore */ }
      return;
    }
    // The element is now tapped; commit so the guard above never re-runs this.
    this._ctx = ctx;
    this._src = src;
    try {
      const bands = EQ_FREQS.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.0;
        f.gain.value = this._eqGains[i] ?? 0;
        return f;
      });
      // Headroom stage: makeup pre-attenuates boosts; limiter is the no-clip
      // ceiling. Set makeup synchronously from the current gains so the very
      // first audio already has room (later changes ramp — see _rampParam).
      const makeup = ctx.createGain();
      makeup.gain.value = this._makeupGain();
      // Threshold at 0 dBFS (not below): the makeup already holds flat/cuts and
      // realistic boosts ≤ full scale, so a ceiling exactly at the clip point
      // stays transparent for in-range audio and only acts on true overshoot —
      // a lower threshold would squash hot masters even when the EQ is flat.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = 0; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.003; limiter.release.value = 0.25;
      // source → b0 → b1 → … → bN → makeup → limiter → destination
      let node = src;
      for (const b of bands) { node.connect(b); node = b; }
      node.connect(makeup); makeup.connect(limiter); limiter.connect(ctx.destination);
      this._bands = bands;
      this._makeup = makeup;
      this._limiter = limiter;
    } catch {
      // Band chain failed AFTER the tap — keep audio alive (un-EQ'd) by routing
      // the tapped source straight to the speakers. No EQ gain here, so no clip
      // to guard against — and nothing in this path may throw.
      try { src.disconnect(); } catch { /* ignore */ }
      try { src.connect(ctx.destination); } catch { /* ignore */ }
      this._bands = null;
      this._makeup = null;
      this._limiter = null;
    }
  }

  setEqBand(i, db) {
    const v = Math.max(-12, Math.min(12, Number(db)));
    if (!Number.isFinite(v) || i < 0 || i >= this._eqGains.length) return;
    this._eqGains[i] = v;
    this._enableEq();
    if (this._bands?.[i]) this._rampParam(this._bands[i].gain, v);
    if (this._makeup) this._rampParam(this._makeup.gain, this._makeupGain());
    this._persistEq();
    this._emit('eq', this._eqGains.slice());
  }
  setEqGains(arr) {
    this._eqGains = sanitizeGains(arr);
    this._enableEq();
    if (this._bands) this._bands.forEach((b, i) => this._rampParam(b.gain, this._eqGains[i] ?? 0));
    if (this._makeup) this._rampParam(this._makeup.gain, this._makeupGain());
    this._persistEq();
    this._emit('eq', this._eqGains.slice());
  }
  // Boost headroom: attenuate by the loudest positive band (+ margin) so the EQ
  // re-balances tone instead of overflowing. Cuts-only / flat → unity (1.0).
  _makeupGain() {
    const maxPos = Math.max(0, ...this._eqGains);
    return maxPos > 0 ? dbToGain(-(maxPos + EQ_HEADROOM_MARGIN_DB)) : 1;
  }
  // Ramp an AudioParam to a new value instead of snapping it — kills zipper
  // noise when the UI streams setEqBand on every pointermove during a drag.
  _rampParam(param, value) {
    param.setTargetAtTime(value, this._ctx.currentTime, EQ_GAIN_RAMP_TC);
  }
  getEqGains() { return this._eqGains.slice(); }
  // First EQ touch builds the Web Audio tap. A slider/preset interaction is a
  // user gesture, so creating + resuming the context here is allowed; resuming
  // matters because once tapped the element's audio ONLY flows through the
  // (possibly suspended) graph.
  _enableEq() {
    this._ensureGraph();
    if (this._ctx?.state === 'suspended') { this._ctx.resume().catch(() => {}); }
  }
  _eqActive() { return this._eqGains.some(g => g !== 0); }
  _persistEq() {
    try { localStorage.setItem('aura.eq.gains', JSON.stringify(this._eqGains)); } catch { /* ignore */ }
  }

  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v)));
    if (!Number.isFinite(clamped)) return;
    this._el.volume = clamped;
    try { localStorage.setItem('aura.volume', String(clamped)); } catch { /* ignore */ }
    this._emit('volume', clamped);
  }
  getVolume() { return this._el.volume; }
  setMuted(b) {
    const next = !!b;
    this._el.muted = next;
    try { localStorage.setItem('aura.muted', next ? '1' : '0'); } catch { /* ignore */ }
    this._emit('muted', next);
  }
  isMuted() { return this._el.muted; }

  _emitProgress() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._lastEmit < 250) return;  // ~4 Hz cap — see ctor comment
    this._lastEmit = now;
    const p = this._el.currentTime / (this._el.duration || 1);
    this._emit('progress', p, this._el.currentTime);
  }
  _startTick() {
    if (this._raf) return;
    const tick = () => {
      this._emitProgress();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  _stopTick() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  async load(track) {
    const url = track?.streamUrl;
    const seq = ++this._loadSeq;   // supersede any in-flight load
    this._baseUrl = url ?? null;
    this._silent = !url;
    this._el.pause();
    // Reset the progress signal up-front so the UI bar/time never carry the
    // previous track's position into the new one while it loads.
    this._emit('progress', 0, 0);
    if (!url) {
      this._el.removeAttribute('src');
      return;
    }
    await this._loadUrl(url, seq);
  }

  // Try the chosen bitrate, then descending fallbacks (qualityLadder), so
  // "highest by default" never breaks a track that lacks a 320 variant. Resolves
  // on the first source that can play. Candidate misses are swallowed (via the
  // _probing guard the 'error' handler checks); a real 'error' is emitted ONLY
  // when every candidate fails — a genuinely dead/expired URL — so App's
  // expired-URL recovery still fires for that, but not for a routine downgrade.
  async _loadUrl(baseUrl, seq = this._loadSeq) {
    const candidates = qualityLadder(baseUrl, this._bitrate);
    let lastErr;
    this._probing = true;
    try {
      for (const candidate of candidates) {
        if (seq !== this._loadSeq) return;   // a newer load superseded this one
        try {
          await this._setSrc(candidate);
          return;                            // first playable candidate wins
        } catch (e) {
          lastErr = e;
        }
      }
    } finally {
      // Only the CURRENT load clears the probe guard — an older, superseded load
      // finishing must not unmask the newer load's in-flight probes (rapid skip).
      if (seq === this._loadSeq) this._probing = false;
    }
    if (seq !== this._loadSeq) return;        // superseded — let the newer load own the error
    const err = lastErr ?? new Error('no playable source');
    this._emit('error', err);                 // every candidate failed: real load error
    throw err;
  }

  _setSrc(url) {
    this._el.src = url;
    return new Promise((resolve, reject) => {
      const onCan = () => { cleanup(); resolve(); };
      const onErr = (e) => { cleanup(); reject(e); };
      const cleanup = () => {
        this._el.removeEventListener('canplay', onCan);
        this._el.removeEventListener('error', onErr);
      };
      this._el.addEventListener('canplay', onCan);
      this._el.addEventListener('error', onErr);
    });
  }

  // Quality changed mid-session: reload the current track at the new bitrate,
  // preserving position + play state. Best-effort — a failure leaves the current
  // source untouched. The Web Audio EQ tap survives an src change.
  async _setBitrate(bitrate) {
    if (bitrate === this._bitrate) return;
    this._bitrate = bitrate;
    if (this._silent || !this._baseUrl) return;
    const at = this._el.currentTime;
    const wasPlaying = !this._el.paused;
    const seq = ++this._loadSeq;
    try {
      await this._loadUrl(this._baseUrl, seq);
      if (seq !== this._loadSeq) return;   // a track change superseded this re-quality
      if (Number.isFinite(at)) this._el.currentTime = at;
      if (wasPlaying) await this._el.play();
    } catch { /* keep playing whatever was loaded before */ }
  }

  async play() {
    if (this._silent) return;
    this._intendedPlaying = true;
    // Tap through Web Audio when the EQ is genuinely in use: already tapped this
    // session (a real gesture built _ctx), or — off iOS, where Web Audio doesn't
    // cost background playback — a saved non-flat preset we can auto-apply. On
    // iOS we deliberately do NOT auto-tap from a saved preset: that would forfeit
    // lock-screen / background playback with no user action this session. An
    // explicit EQ adjustment still taps via _enableEq. Once tapped, stays tapped.
    if (this._ctx || (this._eqActive() && !isIOS())) {
      this._ensureGraph();
      if (this._ctx?.state === 'suspended') { try { await this._ctx.resume(); } catch { /* ignore */ } }
    }
    return this._el.play();
  }
  pause() { if (!this._silent) { this._intendedPlaying = false; this._el.pause(); } }

  seek(p) {
    if (!this._el.duration) return;
    this._el.currentTime = p * this._el.duration;
    // Emit synchronously so the UI bar lands at the new position on the same
    // React render that flips `dragging` off — otherwise the bar snaps back
    // to the stale `progress` value for a frame before the seek event lands.
    this._lastEmit = 0;
    this._emit('progress', p, this._el.currentTime);
  }

  getProgress()    { return this._el.currentTime / (this._el.duration || 1); }
  getDurationSec() { return this._el.duration || 0; }

  on(evt, cb) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
    return () => this._listeners.get(evt)?.delete(cb);
  }

  destroy() {
    this._unsubQuality?.();
    this._stopTick();
    this._el.pause();
    this._el.removeAttribute('src');
    this._el.load();
    this._el.removeEventListener('timeupdate', this._onTimeUpdate);
    this._el.removeEventListener('ended', this._onEnded);
    this._el.removeEventListener('play',  this._onPlay);
    this._el.removeEventListener('pause', this._onPause);
    this._el.removeEventListener('error', this._onError);
    this._el.removeEventListener('seeked', this._onSeeked);
    document.removeEventListener('visibilitychange', this._onVisible);
    if (this._ctx) { try { this._ctx.close(); } catch { /* ignore */ } }
    this._ctx = null; this._src = null; this._bands = null; this._makeup = null; this._limiter = null;
    this._listeners.clear();
  }

  _emit(evt, ...args) {
    this._listeners.get(evt)?.forEach(cb => cb(...args));
  }
}
