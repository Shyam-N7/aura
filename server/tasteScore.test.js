import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool } from './db.js';
import {
  WEIGHTS, HALF_LIFE_CURRENT_DAYS, SHELF_WINDOW_DAYS, SHELF_MIN_SKIPS,
  getScoredTracks, getSuppressedTrackIds,
  clampTzOffset, localDateKey, lastWeekdayKey, lastFridayKey, lastMondayKey,
} from './tasteScore.js';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

// A fixed instant for date math: Sunday 2026-07-05 18:30 UTC — which is already
// Monday 00:00 IST (IST = UTC+5:30, tzOffset -330).
const SUN_1830_UTC = Date.UTC(2026, 6, 5, 18, 30);

describe('event weights (the documented contract)', () => {
  it('composes to completed +1.3 / bare start +0.3 / skipped -0.5 per listen', () => {
    expect(WEIGHTS.play + WEIGHTS.end).toBeCloseTo(1.3, 6);
    expect(WEIGHTS.play).toBeCloseTo(0.3, 6);
    expect(WEIGHTS.play + WEIGHTS.skip).toBeCloseTo(-0.5, 6);
  });
});

describe('getScoredTracks SQL', () => {
  it('embeds weights, half-life, profile-mode exclusion and minPlays as params', async () => {
    await getScoredTracks('u1', { halfLifeDays: HALF_LIFE_CURRENT_DAYS, minPlays: 2, limit: 30 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain(`WHEN 'end' THEN $2`);
    expect(sql).toContain(`EXP(-LN(2)`);
    expect(sql).toContain(`COALESCE(e.mode, 'everyday')`);
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe(WEIGHTS.end);
    expect(params[2]).toBe(WEIGHTS.play);
    expect(params[3]).toBe(WEIGHTS.skip);
    expect(params[5]).toBe(HALF_LIFE_CURRENT_DAYS * 86400000);
    expect(params[6]).toEqual(['family', 'kids']);
    expect(params).toContain(2);   // minPlays
    expect(params[params.length - 1]).toBe(30);   // limit
  });

  it('exposes the liked flag alongside the like-boosted score (quick-picks reasons)', async () => {
    await getScoredTracks('u1', { halfLifeDays: 28 });
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('(lt.track_id IS NOT NULL) AS liked');
  });

  it('adds dormancy + language as outer filters when asked (bring it back / seeds)', async () => {
    await getScoredTracks('u1', { halfLifeDays: 180, dormantDays: 60, language: 'tamil' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('ev.last_play_ts <');
    expect(sql).toContain('LOWER(t.language) = LOWER(');
    expect(params).toContain('tamil');
  });

  it('restricts to the local daypart, night wrapping midnight', async () => {
    await getScoredTracks('u1', { halfLifeDays: 28, daypart: 'night', tzOffsetMin: -330 });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/>= 20 OR .+ <= 3/);
    expect(params).toContain(-330 * 60000);   // tz shift in ms
    pool.query.mockClear();
    await getScoredTracks('u1', { halfLifeDays: 28, daypart: 'morning', tzOffsetMin: 0 });
    expect(pool.query.mock.calls[0][0]).toContain('BETWEEN 5 AND 10');
  });
});

describe('getSuppressedTrackIds (hidden ∪ skip-shelved)', () => {
  it('unions hidden_tracks with the shelving rule and honours the liked rescue', async () => {
    pool.query.mockResolvedValue({ rows: [{ track_id: 'a' }, { track_id: 'b' }] });
    const set = await getSuppressedTrackIds('u1');
    expect(set).toEqual(new Set(['a', 'b']));
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('FROM hidden_tracks');
    expect(sql).toContain('UNION');
    expect(sql).toContain(`FILTER (WHERE e.kind = 'skip') >= $3`);
    expect(sql).toContain(`FILTER (WHERE e.kind = 'end') = 0`);
    expect(sql).toContain('NOT EXISTS');   // liked tracks are always rescued
    expect(params[2]).toBe(SHELF_MIN_SKIPS);
    // 90-day window (allow test-run clock drift)
    expect(params[1]).toBeGreaterThan(Date.now() - SHELF_WINDOW_DAYS * 86400000 - 5000);
  });
});

describe('edition keys', () => {
  it('clamps garbage and out-of-range offsets', () => {
    expect(clampTzOffset('nope')).toBe(0);
    expect(clampTzOffset(undefined)).toBe(0);
    expect(clampTzOffset(-100000)).toBe(-840);
    expect(clampTzOffset(9999)).toBe(840);
    expect(clampTzOffset(-330)).toBe(-330);
  });

  it('localDateKey crosses midnight with the user, not with UTC', () => {
    expect(localDateKey(0, SUN_1830_UTC)).toBe('2026-07-05');      // still Sunday in UTC
    expect(localDateKey(-330, SUN_1830_UTC)).toBe('2026-07-06');   // already Monday in IST
  });

  it('lastWeekdayKey anchors to the most recent weekday, inclusive of today', () => {
    // 2026-07-03 was a Friday. From IST-Monday 06 Jul: last Friday = 03 Jul.
    expect(lastFridayKey(-330, SUN_1830_UTC)).toBe('2026-07-03');
    // On a Friday itself the key is that same day.
    const FRI_NOON_UTC = Date.UTC(2026, 6, 3, 12, 0);
    expect(lastFridayKey(0, FRI_NOON_UTC)).toBe('2026-07-03');
    // Monday anchor from IST Monday = the same Monday.
    expect(lastMondayKey(-330, SUN_1830_UTC)).toBe('2026-07-06');
    // Generic helper agrees with the day constant.
    expect(lastWeekdayKey(0, 5, FRI_NOON_UTC)).toBe('2026-07-03');
  });
});
