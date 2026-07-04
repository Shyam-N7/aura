import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEVEL_TARGET_DB, levelGainForDb, dbFromChannels, measurementUrls,
  getTrackDb, storeTrackDb,
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
    expect(getTrackDb('t1')).toBeNull();
    storeTrackDb('t1', -10);            // overwrites the corrupt blob
    expect(getTrackDb('t1')).toBe(-10);
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
