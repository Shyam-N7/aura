import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LEVEL_TARGET_DB, levelGainForDb, dbFromChannels, measurementUrls,
  getTrackDb, storeTrackDb, measureTrack,
} from './loudness';

const KEY = 'aura.loudness.v1';

beforeEach(() => localStorage.clear());

describe('levelGainForDb (attenuate-only leveling gain)', () => {
  it('is unity for an unmeasured track', () => {
    expect(levelGainForDb(null)).toBe(1);
    expect(levelGainForDb(undefined)).toBe(1);
  });

  it('never boosts a quiet or at-target track', () => {
    expect(levelGainForDb(-30)).toBe(1);
    expect(levelGainForDb(LEVEL_TARGET_DB)).toBe(1);
  });

  it('attenuates a hot track down toward the target', () => {
    // A -8 dB program vs the -16 target → exactly -8 dB of gain.
    expect(levelGainForDb(-8)).toBeCloseTo(Math.pow(10, (LEVEL_TARGET_DB + 8) / 20), 6);
    expect(levelGainForDb(-8)).toBeLessThan(1);
  });
});

describe('dbFromChannels', () => {
  it('measures a full-scale sine at ≈ -3.01 dB (RMS of a sine = 1/√2)', () => {
    const n = 4096;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = Math.sin((2 * Math.PI * i * 8) / n);
    expect(dbFromChannels([ch])).toBeCloseTo(-3.01, 1);
  });

  it('returns null for silence and empty input (never stores junk)', () => {
    expect(dbFromChannels([new Float32Array(1024)])).toBeNull();
    expect(dbFromChannels([])).toBeNull();
  });
});

describe('measurementUrls', () => {
  it("rewrites a token'd catalog url to the cheapest variants first", () => {
    expect(measurementUrls('https://cdn.x/aud/abc_320.mp4')).toEqual([
      'https://cdn.x/aud/abc_48.mp4',
      'https://cdn.x/aud/abc_96.mp4',
    ]);
  });

  it('yields no candidates for tokenless or missing urls', () => {
    expect(measurementUrls('https://cdn.x/aud/abc.mp4')).toEqual([]);
    expect(measurementUrls(null)).toEqual([]);
  });
});

describe('loudness cache', () => {
  it('roundtrips a measurement', () => {
    expect(getTrackDb('t1')).toBeNull();
    storeTrackDb('t1', -12.5);
    expect(getTrackDb('t1')).toBe(-12.5);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getTrackDb('tc')).toBeNull();
    storeTrackDb('tc', -10);            // overwrites the corrupt blob
    expect(getTrackDb('tc')).toBe(-10);
  });

  it('keeps a measurement for the session when localStorage writes fail', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    storeTrackDb('mem1', -9);
    spy.mockRestore();
    expect(localStorage.getItem(KEY)).toBeNull();  // nothing persisted…
    expect(getTrackDb('mem1')).toBe(-9);           // …but the session cache serves it
  });

  it('evicts the oldest-written entries past the cap', () => {
    const map = {};
    for (let i = 0; i < 1500; i++) map[`t${i}`] = { db: -10, at: i };
    localStorage.setItem(KEY, JSON.stringify(map));
    storeTrackDb('fresh', -9);
    const after = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(after).length).toBe(1500);
    expect(after.fresh.db).toBe(-9);
    expect(after.t0).toBeUndefined();    // oldest written went
    expect(after.t1499).toBeDefined();   // recent ones stayed
  });
});

// The duration gate must fail CLOSED: the catalog serves null durations for
// tracks whose provider record lacks one, and decoding unknown-length content
// (radio programs, hours-long mixes) can OOM a phone tab.
describe('measureTrack duration guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips unknown, zero, and over-cap durations without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const url = 'https://cdn.x/aud/abc_320.mp4';
    await expect(measureTrack({ id: 'dur-null', streamUrl: url })).resolves.toBeNull();
    await expect(measureTrack({ id: 'dur-nil', streamUrl: url, durationSec: null })).resolves.toBeNull();
    await expect(measureTrack({ id: 'dur-zero', streamUrl: url, durationSec: 0 })).resolves.toBeNull();
    await expect(measureTrack({ id: 'dur-long', streamUrl: url, durationSec: 13 * 60 })).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets a sane duration through to the fetch stage', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('OfflineAudioContext', class {});   // jsdom has none — let doMeasure reach the fetch
    await expect(measureTrack({ id: 'dur-ok', streamUrl: 'https://cdn.x/aud/abc_320.mp4', durationSec: 240 }))
      .resolves.toBeNull();                           // both candidates fail — resolves null, never throws
    expect(fetchSpy).toHaveBeenCalled();
  });
});
