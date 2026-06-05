// Real audio via HTMLAudioElement. Plays track.streamUrl (catalog CDN mp4).
// Tracks without a streamUrl (e.g. the mock demo catalog) become no-ops:
// load/play/pause silently succeed so the UI doesn't crash.
export class HtmlAudioPlayer {
  constructor() {
    this._el = new Audio();
    this._silent = true;
    this._listeners = new Map();
    this._raf = 0;
    this._lastEmit = 0;
    // HTMLAudio's native `timeupdate` fires only every ~250 ms — too coarse
    // for syncing lyrics. We drive a rAF loop while playing and throttle the
    // emit to ~30 Hz so the progress signal is smooth without rerendering the
    // whole desktop tree at 120 Hz (which made scrolling feel laggy).
    // Bind handlers once and store them so destroy() can remove them.
    this._onTimeUpdate = () => this._emitProgress();
    this._onEnded     = () => { this._stopTick(); this._emit('ended'); };
    this._onPlay      = () => { this._startTick(); this._emit('play'); };
    this._onPause     = () => { this._stopTick(); this._emit('pause'); };
    this._onError     = (e) => { this._stopTick(); this._emit('error', e); };
    // Native `seeked` fires after the audio element finishes seeking. Emitting
    // here covers the case where a seek happens during a rAF-throttled window
    // (e.g., tab backgrounded) so the UI bar snaps to the new position.
    this._onSeeked    = () => { this._lastEmit = 0; this._emitProgress(); };
    // When the tab returns to foreground, rAF resumes — but the throttle
    // window may still suppress the first emit. Reset it and snap progress.
    this._onVisible   = () => {
      if (document.hidden) return;
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
    } catch { /* localStorage disabled — leave defaults */ }
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
    if (now - this._lastEmit < 33) return;  // ~30 Hz cap — see ctor comment
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
    this._silent = !url;
    this._el.pause();
    if (!url) {
      this._el.removeAttribute('src');
      this._emit('progress', 0);
      return;
    }
    this._el.src = url;
    await new Promise((resolve, reject) => {
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

  async play() {
    if (this._silent) return;
    return this._el.play();
  }
  pause() { if (!this._silent) this._el.pause(); }

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
    this._listeners.clear();
  }

  _emit(evt, ...args) {
    this._listeners.get(evt)?.forEach(cb => cb(...args));
  }
}
