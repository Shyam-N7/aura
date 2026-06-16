import { describe, it, expect } from 'vitest';
import { summarizeClock, CLOCK_PARTS } from './musicClock';

// Build a ts from a LOCAL hour. Construction and readback both use the runner's
// local tz, so the bucketing assertions hold regardless of where tests run.
const at = (hour) => new Date(2026, 0, 1, hour, 0, 0).getTime();
const play = (trackId, hour, title = trackId) => ({ trackId, title, artist: 'a', imageUrl: null, ts: at(hour) });

const partPlays = (res, key) => res.parts.find(p => p.key === key).plays;

describe('summarizeClock', () => {
  it('buckets plays into the right part of day (local time)', () => {
    const res = summarizeClock([play('m', 9), play('a', 14), play('e', 19), play('n', 23)]);
    expect(partPlays(res, 'morning')).toBe(1);
    expect(partPlays(res, 'afternoon')).toBe(1);
    expect(partPlays(res, 'evening')).toBe(1);
    expect(partPlays(res, 'night')).toBe(1);
    expect(res.totalPlays).toBe(4);
    expect(res.parts.map(p => p.key)).toEqual(CLOCK_PARTS.map(p => p.key));
  });

  it('ranks top tracks within a part by play count', () => {
    const res = summarizeClock([play('x', 9), play('x', 9), play('y', 10)]);
    const morning = res.parts.find(p => p.key === 'morning');
    expect(morning.plays).toBe(3);
    expect(morning.topTracks[0].trackId).toBe('x');
    expect(morning.topTracks[0].count).toBe(2);
  });

  it('surfaces the most-played track after midnight (hours 0–4)', () => {
    const res = summarizeClock([play('late', 2), play('late', 3), play('late', 1), play('day', 14)]);
    expect(res.afterMidnight.trackId).toBe('late');
    expect(res.afterMidnight.count).toBe(3);
    // pre-dawn plays also fall in the "night" part
    expect(partPlays(res, 'night')).toBe(3);
  });

  it('does not flag late-evening plays as after-midnight', () => {
    const res = summarizeClock([play('eve', 22), play('eve', 23)]);
    expect(res.afterMidnight).toBeNull();
    expect(partPlays(res, 'night')).toBe(2);
  });

  it('reports the busiest part, and stays empty-safe', () => {
    expect(summarizeClock([]).busiest).toBeNull();
    expect(summarizeClock([]).totalPlays).toBe(0);
    const res = summarizeClock([play('a', 14), play('b', 14), play('c', 9)]);
    expect(res.busiest.key).toBe('afternoon');
  });
});
