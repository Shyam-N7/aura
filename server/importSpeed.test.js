import { describe, it, expect, vi, beforeEach } from 'vitest';

// The two supporting pieces of the import-speed round that live outside the
// drain itself: the poll's rate-limit exemption, and the batched track cache.

vi.mock('./config.js', () => ({
  YOUTUBE_API_KEY: 'test-key',
  YT_IMPORT_DAILY_CAP: 200,
  YT_IMPORT_USER_DAILY: 10,
}));
vi.mock('./db.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, query: vi.fn() }));
vi.mock('./middleware/auth.js', () => ({ requireAuth: (req, _res, next) => next() }));
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn(), getSongDetails: vi.fn() }));

import { pool } from './db.js';
import { isImportPoll } from './importRoutes.js';
import { cacheTracks } from './tracks.js';

describe('the status poll is exempt from the cost limiter', () => {
  // The poll is the server's own worker: the drain runs inside the GET. At the
  // fast cadence a single import could exhaust 60/5min in ~2 minutes, after
  // which every poll 429s, the drain never runs, and the job only advances via
  // the daily cron — an import that LOOKS hung because it was rate-limited by
  // its own progress bar. app.js consults this predicate before costLimiter.
  const req = (method, path) => ({ method, path });

  it('matches exactly the poll, as seen from the /api/import mount', () => {
    expect(isImportPoll(req('GET', '/youtube/yti_abc123'))).toBe(true);
    expect(isImportPoll(req('GET', `/youtube/yti_${'a'.repeat(40)}`))).toBe(true);
  });

  it('keeps every cost-bearing route limited', () => {
    expect(isImportPoll(req('POST', '/youtube'))).toBe(false);            // start
    expect(isImportPoll(req('POST', '/youtube/refresh'))).toBe(false);    // refresh
    expect(isImportPoll(req('POST', '/youtube/preview'))).toBe(false);    // preview
    expect(isImportPoll(req('POST', '/youtube/yti_abc123/items/42'))).toBe(false); // resolve
    expect(isImportPoll(req('DELETE', '/youtube/yti_abc123'))).toBe(false); // cancel
    expect(isImportPoll(req('GET', '/youtube/links'))).toBe(false);       // links read
    expect(isImportPoll(req('GET', '/youtube/yti_UPPER'))).toBe(false);   // junk id
  });
});

describe('cacheTracks batches its upserts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });
  const track = id => ({ id, title: `T${id}`, artist: 'A', album: 'L', language: 'ta', durationSec: 200, streamUrl: 'u', imageUrl: 'i' });

  it('writes N tracks in ONE round trip', async () => {
    await cacheTracks([track('a'), track('b'), track('c'), track('d')]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tracks/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(params).toHaveLength(4 * 9);
  });

  it('dedupes ids within one call — a multi-row upsert may not touch a row twice', async () => {
    await cacheTracks([track('a'), track('a'), track('b')]);
    const [, params] = pool.query.mock.calls[0];
    expect(params).toHaveLength(2 * 9);
  });

  it('skips the round trip entirely for nothing to write', async () => {
    await cacheTracks([]);
    await cacheTracks([{ title: 'no id' }]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('a failed batch logs and does not throw — cache writes are best-effort', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(cacheTracks([track('a')])).resolves.toBeUndefined();
  });
});
