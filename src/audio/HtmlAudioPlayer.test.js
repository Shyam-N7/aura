import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// The makeup gain is the EQ's anti-clip headroom: boosts get pre-attenuated so a
// hot master can't overflow ctx.destination (the crackle bug). jsdom has no Web
// Audio, so the graph never builds — but _makeupGain() is pure math over the
// stored gains, which is exactly the contract worth pinning.
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

  it('attenuates by the loudest positive band + 3 dB margin (Upbeat preset)', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [3, 2, 0, -1, 0, 2, 3, 3];                  // peak boost = +3 dB
    expect(p._makeupGain()).toBeCloseTo(dbToGain(-6), 10);   // -(3 + 3)
    expect(p._makeupGain()).toBeLessThan(1);
    p.destroy();
  });

  it('keys off the single loudest band regardless of cuts elsewhere', () => {
    const p = new HtmlAudioPlayer();
    p._eqGains = [-6, -6, 12, -6, -6, -6, -6, -6];           // one +12 spike
    expect(p._makeupGain()).toBeCloseTo(dbToGain(-15), 10);  // -(12 + 3)
    p.destroy();
  });
});
