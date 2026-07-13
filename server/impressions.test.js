import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn(), pool: { query: vi.fn() } }));

import { query, pool } from './db.js';
import {
  recordImpressions, getImpressionSignals, applyPenalty, pruneOldImpressions,
  COOLDOWN_MIN_DAYS, COOLDOWN_WINDOW_MS,
} from './impressions.js';
import { localDateKey } from './tasteScore.js';

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  pool.query.mockResolvedValue({ rows: [] });
});

describe('recordImpressions', () => {
  it('upserts every id in one batched query, keyed to the user-local day', async () => {
    await recordImpressions('u1', { surface: 'quick-picks', tzOffset: -330, trackIds: ['a', 'b', 'c'] });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params, opts] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO impressions');
    expect(sql).toContain('ON CONFLICT (user_id, track_id, surface, day)');
    expect(sql).toContain('count = impressions.count + 1');
    // three VALUES rows, one per id
    expect(sql.match(/\(\$1,/g)).toHaveLength(3);
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('quick-picks');
    expect(params[2]).toBe(localDateKey(-330));
    expect(params.slice(4)).toEqual(['a', 'b', 'c']);
    expect(opts).toEqual({ retries: 0 });   // never double-count on a socket replay
  });

  it('no-ops on an empty batch', async () => {
    await recordImpressions('u1', { surface: 'quick-picks', tzOffset: 0, trackIds: [] });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('getImpressionSignals', () => {
  const now = Date.now();

  it('penalises an unplayed pick by its shown-day count, no cooldown under the floor', async () => {
    pool.query.mockResolvedValue({ rows: [
      { track_id: 't1', shown_days: 2, last_ts: now - 1000, played_since: false },
    ] });
    const m = await getImpressionSignals('u1', 'quick-picks', ['t1']);
    expect(m.get('t1')).toEqual({ unplayedShownDays: 2, cooledDown: false });   // 2 < 3
  });

  it('cools down a pick shown enough days and still fresh', async () => {
    pool.query.mockResolvedValue({ rows: [
      { track_id: 't1', shown_days: COOLDOWN_MIN_DAYS, last_ts: now - 1000, played_since: false },
    ] });
    const m = await getImpressionSignals('u1', 'quick-picks', ['t1']);
    expect(m.get('t1')).toEqual({ unplayedShownDays: 3, cooledDown: true });
  });

  it('lets the cooldown lapse once the last impression ages past the window', async () => {
    pool.query.mockResolvedValue({ rows: [
      { track_id: 't1', shown_days: 5, last_ts: now - COOLDOWN_WINDOW_MS - 1000, played_since: false },
    ] });
    const m = await getImpressionSignals('u1', 'quick-picks', ['t1']);
    expect(m.get('t1').cooledDown).toBe(false);   // stale → eligible again
  });

  it('clears the penalty entirely once the pick was played after being shown', async () => {
    pool.query.mockResolvedValue({ rows: [
      { track_id: 't1', shown_days: 9, last_ts: now, played_since: true },
    ] });
    const m = await getImpressionSignals('u1', 'quick-picks', ['t1']);
    expect(m.get('t1')).toEqual({ unplayedShownDays: 0, cooledDown: false });
  });

  it('returns an empty map (no demotion) on an empty id list or a read failure', async () => {
    expect((await getImpressionSignals('u1', 'quick-picks', [])).size).toBe(0);
    pool.query.mockRejectedValue(new Error('table missing'));
    expect((await getImpressionSignals('u1', 'quick-picks', ['t1'])).size).toBe(0);
  });
});

describe('applyPenalty', () => {
  it('multiplies the score down by 0.85 per unplayed shown-day', () => {
    expect(applyPenalty(10, 0)).toBe(10);
    expect(applyPenalty(10, 1)).toBeCloseTo(8.5, 6);
    expect(applyPenalty(10, 2)).toBeCloseTo(7.225, 6);
    expect(applyPenalty(10, undefined)).toBe(10);
  });
});

describe('pruneOldImpressions', () => {
  it('deletes rows past the retention window', async () => {
    await pruneOldImpressions();
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('DELETE FROM impressions WHERE last_ts <');
  });
});
