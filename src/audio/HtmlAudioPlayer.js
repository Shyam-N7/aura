import { EQ_FREQS, EQ_FLAT, sanitizeGains, dbToGain, levelGainFor } from './eqConfig.js';
import { getAudioQuality, subscribeAudioQuality, bitrateFor, qualityLadder } from '../lib/audioQuality.js';
import { getLeveling, subscribeLeveling } from '../lib/audioLeveling.js';
import { isIOS } from '../lib/platform.js';

// EQ boosts can push a loud-mastered source (AAC near 0 dBFS) past full scale.
// The brick-wall LIMITER at the 0 dBFS ceiling is the real anti-clip. The makeup
// GainNode now only trims the EXCESS of EXTREME boosts (above the threshold) — it
// used to pre-attenuate by the whole peak band, which made every non-flat preset
// 4.5–6 dB QUIETER than Flat (a single +3 dB band barely changes overall loudness,
// so that was wildly over-conservative). Now a modest preset plays at full loudness
// and rides the limiter (a touch of punch — the "boosted" feel); only pathological
// multi-band overshoot (> threshold) gets pre-trimmed by just the excess.
const EQ_HEADROOM_THRESHOLD_DB = 6.0;  // peak boost ≤ this → unity makeup (limiter handles the peaks)
const EQ_GAIN_RAMP_TC = 0.02;          // setTargetAtTime time-constant (~60 ms to track)

// Per-candidate settle window for _setSrc. A paused element on a HIDDEN page can
// have its media pipeline suspended by the browser before it ever reaches
// canplay (Android Chrome suspends paused background players), so an un-bounded
// await can hang a track transition forever with the screen off. The timeout
// turns that silent hang into a rejection, so the quality ladder descends and,
// if every candidate stalls, a real 'error' finally surfaces for App's
// refetch/recovery path instead of the player dying quietly between tracks.
const SRC_SETTLE_TIMEOUT_MS = 8000;

// Loudness leveling — nudge each track toward a consistent target so playback
// feels as "leveled/boosted" as YouTube/Spotify, not at the file's raw mastering.
// Open-loop AGC: measure the program (pre-leveling) RMS, set leveling gain =
// target/program (clamped), and ramp SLOWLY so it settles per track without
// audible pumping; the existing limiter catches the resulting peaks. Needs the
// Web Audio tap, so it's gated off on iOS by default (preserves background
// playback) — see _levelingResolved.
const LEVEL_TARGET_RMS = 0.16;   // ~ -16 dBFS RMS target (tuneable in real testing)
const LEVEL_MAX_DB     = 9;      // never boost a quiet track more than +9 dB
const LEVEL_MIN_DB     = -9;     // nor pull a hot one down more than -9 dB
const LEVEL_RAMP_TC    = 1.5;    // slow ~1.5 s settle → no pumping
const LEVEL_MEASURE_MS = 400;    // RMS measurement cadence
const LEVEL_EMA_ALPHA  = 0.15;   // running-loudness smoothing

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
    // Loudness leveling stage (lives between makeup and limiter in the graph).
    this._levelGain = null;   // GainNode the AGC rides toward the target
    this._analyser = null;    // taps the program (makeup output) to measure RMS
    this._levelActive = false;
    this._levelEma = 0;       // smoothed program loudness (reset per track)
    this._lastLevel = 0;      // measurement throttle
    this._levelBuf = null;
    this._eqGains = EQ_FLAT.slice();
    // Transient mode profile (Car Mode): an EQ override applied WITHOUT persisting
    // over the user's saved EQ, + a leveling force. Cleared when the profile exits.
    this._eqOverride = null;
    this._levelForce = false;
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
      // playing — re-arm so playback continues instead of just stopping. NOT
      // when the element ENDED: play() on an ended element replays it from 0,
      // and the ended→advance hand-off is owned by App's queue logic.
      if (this._intendedPlaying && this._el.paused && !this._el.ended && !this._silent) {
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
    // React live when the user toggles volume leveling in Settings.
    this._unsubLeveling = subscribeLeveling(() => this._applyLeveling());
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
        f.gain.value = this._effGains()[i] ?? 0;
        return f;
      });
      // Headroom stage: makeup pre-attenuates boosts; limiter is the no-clip
      // ceiling. Set makeup synchronously from the current gains so the very
      // first audio already has room (later changes ramp — see _rampParam).
      const makeup = ctx.createGain();
      makeup.gain.value = this._makeupGain();
      // Loudness-leveling gain (unity until the AGC moves it) + an analyser tap on
      // the program (makeup output) so leveling measures pre-leveling loudness.
      const levelGain = ctx.createGain();
      levelGain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      // Threshold at 0 dBFS (not below): the makeup already holds flat/cuts and
      // realistic boosts ≤ full scale, so a ceiling exactly at the clip point
      // stays transparent for in-range audio and only acts on true overshoot —
      // a lower threshold would squash hot masters even when the EQ is flat. It
      // also catches the peaks the leveling boost can introduce.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = 0; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.003; limiter.release.value = 0.25;
      // source → b0 → … → bN → makeup → levelGain → limiter → destination
      // (makeup also fans out to the analyser, a measurement-only sink).
      let node = src;
      for (const b of bands) { node.connect(b); node = b; }
      node.connect(makeup);
      makeup.connect(analyser);
      makeup.connect(levelGain);
      levelGain.connect(limiter); limiter.connect(ctx.destination);
      this._bands = bands;
      this._makeup = makeup;
      this._levelGain = levelGain;
      this._analyser = analyser;
      this._limiter = limiter;
      this._levelActive = this._levelingResolved();
    } catch {
      // Band chain failed AFTER the tap — keep audio alive (un-EQ'd) by routing
      // the tapped source straight to the speakers. No EQ gain here, so no clip
      // to guard against — and nothing in this path may throw.
      try { src.disconnect(); } catch { /* ignore */ }
      try { src.connect(ctx.destination); } catch { /* ignore */ }
      this._bands = null;
      this._makeup = null;
      this._limiter = null;
      this._levelGain = null;
      this._analyser = null;
      this._levelActive = false;
    }
  }

  // Whether loudness leveling should run (single source: lib/audioLeveling). False
  // on iOS by default so native background playback is preserved (the Web Audio tap
  // would forfeit it); an iOS user can opt in, accepting that trade.
  _levelingResolved() { return this._levelForce || getLeveling(); }

  // React to a leveling toggle (subscribed in the ctor). On: tap the graph if
  // playing so it takes effect now. Off: ride the leveling gain back to unity.
  _applyLeveling() {
    if (this._levelingResolved()) {
      if (!this._silent && this._intendedPlaying) this._enableEq();
      this._levelActive = !!this._ctx;
      this._levelEma = 0;
    } else {
      this._levelActive = false;
      this._levelEma = 0;
      if (this._levelGain && this._ctx) this._levelGain.gain.setTargetAtTime(1, this._ctx.currentTime, 0.1);
    }
  }

  // Open-loop AGC step: measure the program RMS and ramp the leveling gain toward
  // target/RMS (clamped). Throttled; no-op unless leveling is active. Piggybacks
  // the progress rAF, so it only runs while playing + foregrounded.
  _measureLevel() {
    if (!this._levelActive || !this._analyser || !this._levelGain) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._lastLevel < LEVEL_MEASURE_MS) return;
    this._lastLevel = now;
    const buf = this._levelBuf ?? (this._levelBuf = new Float32Array(this._analyser.fftSize));
    this._analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms < 1e-4) return;   // silence/gap — hold the current gain
    this._levelEma = this._levelEma ? this._levelEma * (1 - LEVEL_EMA_ALPHA) + rms * LEVEL_EMA_ALPHA : rms;
    const g = levelGainFor(this._levelEma, { target: LEVEL_TARGET_RMS, minDb: LEVEL_MIN_DB, maxDb: LEVEL_MAX_DB });
    if (g != null && this._ctx) this._levelGain.gain.setTargetAtTime(g, this._ctx.currentTime, LEVEL_RAMP_TC);
  }

  setEqBand(i, db) {
    const v = Math.max(-12, Math.min(12, Number(db)));
    if (!Number.isFinite(v) || i < 0 || i >= this._eqGains.length) return;
    this._eqGains[i] = v;
    this._enableEq();
    // Reflect the effective value (override wins if a mode profile is active).
    if (this._bands?.[i]) this._rampParam(this._bands[i].gain, this._effGains()[i] ?? 0);
    if (this._makeup) this._rampParam(this._makeup.gain, this._makeupGain());
    this._persistEq();
    this._emit('eq', this._eqGains.slice());
  }
  setEqGains(arr) {
    this._eqGains = sanitizeGains(arr);
    this._enableEq();
    // Apply the EFFECTIVE gains — a transient mode override (Car Mode) keeps
    // priority over a user EQ change made while the profile is active.
    const eff = this._effGains();
    if (this._bands) this._bands.forEach((b, i) => this._rampParam(b.gain, eff[i] ?? 0));
    if (this._makeup) this._rampParam(this._makeup.gain, this._makeupGain());
    this._persistEq();
    this._emit('eq', this._eqGains.slice());
  }
  // Effective gains = the transient mode override (Car Mode) if set, else the
  // user's saved EQ. All audio-graph reads go through this so the override is
  // applied without touching/persisting the user's own curve.
  _effGains() { return this._eqOverride ?? this._eqGains; }

  // Boost headroom: unity for flat/cuts AND every modest boost (≤ threshold) so the
  // preset keeps full loudness and the limiter shaves the occasional peak; only the
  // EXCESS of an extreme boost (> threshold) is pre-trimmed to avoid heavy limiting.
  _makeupGain() {
    const maxPos = Math.max(0, ...this._effGains());
    return maxPos > EQ_HEADROOM_THRESHOLD_DB ? dbToGain(-(maxPos - EQ_HEADROOM_THRESHOLD_DB)) : 1;
  }

  // Apply a transient EQ override (null clears it back to the user's EQ). Never
  // persists. Used by Car Mode's audio profile.
  setEqOverride(arr) {
    this._eqOverride = arr ? sanitizeGains(arr) : null;
    this._enableEq();
    const eff = this._effGains();
    if (this._bands) this._bands.forEach((b, i) => this._rampParam(b.gain, eff[i] ?? 0));
    if (this._makeup) this._rampParam(this._makeup.gain, this._makeupGain());
    this._emit('eq', eff.slice());
  }

  // Force loudness leveling on regardless of the saved preference (Car Mode).
  setLevelForce(on) {
    this._levelForce = !!on;
    this._applyLeveling();
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
  _eqActive() { return this._effGains().some(g => g !== 0); }
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
      this._measureLevel();
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
    // New track → re-level from scratch so each song settles to the target.
    this._levelEma = 0;
    this._lastLevel = 0;
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
  //
  // Play-driven loading: when we already intend to be playing (a mid-session
  // track transition), a play() is kicked right after each src assignment. A
  // pending play() marks the element as playing, which (a) exempts it from the
  // hidden-page paused-player suspension that otherwise withholds canplay with
  // the screen off, (b) actively drives the resource load forward per the media
  // spec, and (c) starts audio the instant data arrives — no JS needed at
  // readiness time. Per-candidate because the load algorithm re-pauses the
  // element on every src change; a rejected kick (AbortError on descent,
  // NotSupportedError on a missing variant) is expected and swallowed. Autoplay
  // policy allows this: the sticky user activation is per-document and survives
  // src changes. Cold boot is unaffected — _intendedPlaying is false until the
  // user plays.
  async _loadUrl(baseUrl, seq = this._loadSeq, { kick = true } = {}) {
    const candidates = qualityLadder(baseUrl, this._bitrate);
    let lastErr;
    this._probing = true;
    try {
      for (const candidate of candidates) {
        if (seq !== this._loadSeq) return;   // a newer load superseded this one
        try {
          const settled = this._setSrc(candidate);   // assigns src synchronously
          if (kick && this._intendedPlaying) this._el.play()?.catch(() => { /* expected on descent */ });
          await settled;
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

  // Settles on the FIRST of canplay / playing — real playability, same contract
  // as before (NOT loadedmetadata: a stream that stalls right after its headers
  // must fall through to the timeout → descent → 'error' recovery, not report
  // success and strand a silent track the watchdog would then trust). With the
  // play() kick pending, the pipeline isn't background-suspended, so these
  // events do arrive once data does. The bounded timeout is the backstop for a
  // pipeline that delivers nothing at all (hidden-page suspension, dead
  // network): reject → the ladder descends → the all-fail path surfaces a real
  // 'error' instead of hanging load() forever.
  _setSrc(url) {
    this._el.src = url;
    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      const onOk = () => { clearTimeout(timer); ac.abort(); resolve(); };
      const onErr = (e) => { clearTimeout(timer); ac.abort(); reject(e); };
      const timer = setTimeout(() => { ac.abort(); reject(new Error('source settle timeout')); }, SRC_SETTLE_TIMEOUT_MS);
      const opts = { once: true, signal: ac.signal };
      this._el.addEventListener('canplay', onOk, opts);
      this._el.addEventListener('playing', onOk, opts);
      this._el.addEventListener('error', onErr, opts);
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
      // No play-kick here: a quality swap must restore position BEFORE audio
      // starts, or the new source audibly restarts from 0 for a beat. Quality
      // changes come from the Settings UI (foreground), where canplay fires
      // normally and the settle timeout backstops the rest.
      await this._loadUrl(this._baseUrl, seq, { kick: false });
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
    // Tap Web Audio when EQ is in use (existing) OR loudness leveling is on. Both
    // need the graph. _levelingResolved() is false on iOS by default, so iOS keeps
    // native background playback unless the user explicitly opts into leveling.
    if (this._ctx || this._levelingResolved() || (this._eqActive() && !isIOS())) {
      this._ensureGraph();
      // Fire-and-forget: on a hidden page a resume() can pend indefinitely, and
      // awaiting it here would block _el.play() entirely — an independent way
      // for a screen-off track transition to die. _onVisible retries the resume
      // on foreground return, so a graph that couldn't resume in the background
      // becomes audible again the moment the screen wakes.
      if (this._ctx?.state === 'suspended') { this._ctx.resume().catch(() => { /* ignore */ }); }
      this._levelActive = this._levelingResolved() && !!this._ctx;
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
  isEnded()        { return this._el.ended; }

  on(evt, cb) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
    return () => this._listeners.get(evt)?.delete(cb);
  }

  destroy() {
    this._unsubQuality?.();
    this._unsubLeveling?.();
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
    this._levelGain = null; this._analyser = null; this._levelBuf = null; this._levelActive = false;
    this._listeners.clear();
  }

  _emit(evt, ...args) {
    this._listeners.get(evt)?.forEach(cb => cb(...args));
  }
}
