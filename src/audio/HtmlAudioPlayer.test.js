import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HtmlAudioPlayer } from './HtmlAudioPlayer';
import { dbToGain } from './eqConfig';

// jsdom can't actually load media (no canplay/error from real network), so these
// cover the parts of the contract that DON'T need a real stream: the probe-error
// suppression that fixes the "music breaking" bug, and the load-sequence token.

beforeEach(() => localStorage.clear());

describe('HtmlAudioPlayer — quality-ladder probe error suppression', () => {
  it('swallows element errors while a probe is in flight, surfaces them otherwise', () => {
    const p = new HtmlAudioPlayer();
    const onErr = vi.fn();
    p.on('error', onErr);

    // A failed bitrate probe mid-ladder (e.g. a track with no 320 variant) must
    // NOT reach the app — otherwise it trips the expired-URL reload that breaks
    // playback.
    p._probing = true;
    p._el.dispatchEvent(new Event('error'));
    expect(onErr).not.toHaveBeenCalled();

    // A genuine mid-playback error (probe finished) must still surface so the
    // app's expired-stream recovery can run.
    p._probing = false;
    p._el.dispatchEvent(new Event('error'));
    expect(onErr).toHaveBeenCalledTimes(1);

    p.destroy();
  });

  it('bumps the load sequence on each load() so a superseded load can bail', async () => {
    const p = new HtmlAudioPlayer();
    const before = p._loadSeq;
    // A silent load (no streamUrl) returns immediately without touching media.
    await p.load({ id: 'x', streamUrl: null });
    expect(p._loadSeq).toBe(before + 1);
    p.destroy();
  });
});

// The makeup gain is the EQ's anti-clip headroom, but it now leans on the 0 dBFS
// limiter: modest boosts (≤ threshold) stay at UNITY so presets keep full loudness,
// and only the EXCESS of an extreme boost is pre-trimmed. jsdom has no Web Audio, so
// the graph never builds — but _makeupGain() is pure math worth pinning.
describe('HtmlAudioPlayer — EQ makeup gain (clipping headroom)', () => {
  it('is unity (1.0) when flat — nothing boosted, nothing to clip', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [0, 0, 0, 0, 0, 0, 0, 0];
    expect(p._makeupGain()).toBe(1);
    p.destroy();
  });

  it('stays unity for cuts-only — attenuation can never overflow', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [-2, -1, 0, -3, 0, -1, -2, -4];
    expect(p._makeupGain()).toBe(1);
    p.destroy();
  });

  it('stays UNITY for modest boosts (≤ threshold) so presets keep full loudness', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [4, 2, 0, -0.5, 1, 2.5, 3.5, 4];   // +4 peak (Upbeat) — limiter handles it
    expect(p._makeupGain()).toBe(1);
    p._eqGains = [0, 0, 0, 0, 6, 0, 0, 0];           // exactly at the 6 dB threshold
    expect(p._makeupGain()).toBe(1);
    p.destroy();
  });

  it('trims only the EXCESS above the threshold for extreme boosts', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [-6, -6, 12, -6, -6, -6, -6, -6];           // +12 peak → -(12 - 6)
    expect(p._makeupGain()).toBeCloseTo(dbToGain(-6), 10);
    expect(p._makeupGain()).toBeLessThan(1);
    p._eqGains = [0, 0, 0, 0, 7, 0, 0, 0];                   // just over → -(7 - 6)
    expect(p._makeupGain()).toBeCloseTo(dbToGain(-1), 10);
    p.destroy();
  });
});

// The tap policy is the screen-off fix: phones must never auto-tap Web Audio
// from a saved preset (a tapped element's sound exits only through the
// AudioContext, which Android halts with the screen off and iOS drops from the
// lock screen); desktop may. An already-tapped session keeps using its graph.
describe('HtmlAudioPlayer — Web Audio tap policy (screen-off safety)', () => {
  const stubNav = (nav) => vi.stubGlobal('navigator', nav);
  afterEach(() => vi.unstubAllGlobals());

  const DESKTOP = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 };
  const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome', platform: 'Linux armv8l', maxTouchPoints: 5 };
  const IPHONE  = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5 };

  const makePlayer = () => {
    const p = new HtmlAudioPlayer();
    p._silent = false;                       // pretend a real track is loaded
    p._el.play = () => Promise.resolve();    // jsdom can't actually play media
    p._ensureGraph = vi.fn();
    return p;
  };

  it('auto-taps on desktop when a saved non-flat preset is active', async () => {
    stubNav(DESKTOP);
    const p = makePlayer();
    p._eqGains = [4, 0, 0, 0, 0, 0, 0, 0];
    await p.play();
    expect(p._ensureGraph).toHaveBeenCalled();
    p.destroy();
  });

  it('never auto-taps on Android or iOS, even with a saved preset', async () => {
    for (const nav of [ANDROID, IPHONE]) {
      stubNav(nav);
      const p = makePlayer();
      p._eqGains = [4, 0, 0, 0, 0, 0, 0, 0];
      await p.play();
      expect(p._ensureGraph).not.toHaveBeenCalled();
      p.destroy();
    }
  });

  it('keeps an already-tapped session on its graph, on any platform', async () => {
    stubNav(ANDROID);
    const p = makePlayer();
    p._ctx = {};                             // an explicit EQ gesture tapped earlier
    await p.play();
    expect(p._ensureGraph).toHaveBeenCalled();
    p.destroy();
  });
});
