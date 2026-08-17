import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache language gate, driven through the public drainJob surface.
//
// What it exists to pin: a wrong AUTO match seeds yt_match_cache at or above
// the auto threshold, and the short-circuit in resolveItem then replays it on
// every future import BEFORE search or scoring run — so the language tiebreak
// in matchVideo is unreachable for exactly the rows it was written for, and a
// wrong auto is never OFFERED for review, which is the only path that can
// outrank it. The gate is the one escape hatch, and every guard on it is a
// measured failure mode if dropped (see the resolveItem comment).

vi.mock('./db.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  query: vi.fn(),
}));
vi.mock('./config.js', () => ({
  YOUTUBE_API_KEY: 'test-key',
  YT_IMPORT_DAILY_CAP: 200,
  YT_IMPORT_USER_DAILY: 10,
}));
// importJobs now imports searchSongs statically (injected once per drain
// instead of a per-item dynamic import) — keep the real catalog out of this
// suite's module graph.
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn() }));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn(), getTrackById: vi.fn() }));
vi.mock('./playlists.js', () => ({
  createPlaylistFromImport: vi.fn(),
  appendTracksToPlaylist: vi.fn(),
}));
vi.mock('./context.js', () => ({ getUserLanguages: vi.fn() }));

import { pool, query } from './db.js';
import { createPlaylistFromImport } from './playlists.js';
import { getUserLanguages } from './context.js';
import { drainJob } from './importJobs.js';

// One pending item: the real O Sona pipe shape from the measured mix.
const ITEM = {
  id: 71,
  position: 0,
  video_id: 'v1',
  yt_title: 'O Sona 8K Video Song | Vaalee | Kiccha Sudeepa',
  yt_channel: 'Label',
  yt_duration: 355,
};

// The two rivals: the Kannada original and the Bengali near-duplicate that
// poisoned the cache in the field.
const KANNADA = {
  id: 'kannada', title: 'O Sona', artist: 'K. Kalyan',
  album: 'Vaalee', language: 'Kannada', durationSec: 351,
};
const BENGALI = {
  id: 'bengali', title: 'O Sona O Sona', artist: 'Someone',
  album: 'Other', language: 'Bengali', durationSec: 353,
};

/**
 * Run a one-item drain against a given cache row. Read-side `query` calls, in
 * drainJob's actual order: claim confirm (unused), item select, cache lookup,
 * item select (empty → finish), finish counts, finish auto rows, finish job
 * row. Write-side `pool.query` absorbs everything and is inspected after.
 */
async function drain({ cacheRow, userLangs, search }) {
  vi.clearAllMocks();
  getUserLanguages.mockResolvedValue(userLangs);
  createPlaylistFromImport.mockResolvedValue({ id: 'pl_1' });
  pool.query.mockImplementation(sql => {
    if (/UPDATE yt_import_jobs/.test(sql) && /RETURNING/.test(sql)) {
      return Promise.resolve({
        rows: [{
          id: 'yti_1', user_id: 'u1', yt_playlist_id: 'PL1', kind: 'PL',
          status: 'matching', title: 'mix', windowed: false, playlist_id: null,
        }],
        rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  query
    .mockResolvedValueOnce({ rows: [ITEM], rowCount: 1 })            // item
    .mockResolvedValueOnce({ rows: cacheRow ? [cacheRow] : [], rowCount: cacheRow ? 1 : 0 }) // cache
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                // next item: none
    .mockResolvedValueOnce({ rows: [{ tier: 'auto', n: 1 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ track_id: 'kannada' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ title: 'mix', windowed: false, fetched_count: 1 }], rowCount: 1 });
  const searchFn = search ?? vi.fn().mockResolvedValue([BENGALI, KANNADA]);
  const out = await drainJob('yti_1', { budgetMs: 30000, search: searchFn });
  const writes = pool.query.mock.calls.map(c => ({ sql: c[0], args: c[1] }));
  return { out, searchFn, writes };
}

const poisoned = over => ({
  fingerprint: 'fp-poisoned',
  track_id: 'bengali',
  score: 0.9167,
  user_confirmed: false,
  lang_checked_at: null,
  track_language: 'Bengali',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('the poisoned row, and the once-ever escape hatch', () => {
  it('falls through, stamps the row, and the tiebreak finally runs', async () => {
    const { searchFn, writes } = await drain({
      cacheRow: poisoned(),
      userLangs: ['kannada', 'tamil'],
    });
    // The search ran — the short-circuit did NOT.
    expect(searchFn).toHaveBeenCalled();
    // The row is stamped so this costs one re-check per row, ever.
    const stamp = writes.find(w => /SET lang_checked_at/.test(w.sql));
    expect(stamp).toBeTruthy();
    expect(stamp.args[0]).toBe('fp-poisoned');
    // The re-match chose the listener's language — the merged tiebreak,
    // reachable at last.
    const verdict = writes.find(w => /UPDATE yt_import_items/.test(w.sql));
    expect(verdict.args).toContain('kannada');
  });

  it('re-seeds the corrected winner under the key it actually hit', async () => {
    const { writes } = await drain({
      cacheRow: poisoned(),
      userLangs: ['kannada'],
    });
    // Reads scan neighbour buckets and both readings; the AUTO write lands on
    // the primary fingerprint. Without also correcting the hit row, the
    // poisoned entry survives and outranks the correction on score at the
    // very next lookup.
    const seeds = writes.filter(w => /INSERT INTO yt_match_cache/.test(w.sql));
    expect(seeds.some(w => w.args[0] === 'fp-poisoned' && w.args[1] === 'kannada')).toBe(true);
  });

  it('never falls through on a human-confirmed row', async () => {
    const { searchFn, writes } = await drain({
      cacheRow: poisoned({ user_confirmed: true }),
      userLangs: ['kannada'],
    });
    expect(searchFn).not.toHaveBeenCalled();
    expect(writes.some(w => /SET lang_checked_at/.test(w.sql))).toBe(false);
  });

  it('never falls through twice — the stamp is the whole cost story', async () => {
    // Without this, a correct-but-out-of-affinity playlist re-searches on
    // every refresh forever, and a fall-through that lands in REVIEW (which
    // writes nothing back) loops the same review card at the user for the
    // rest of time.
    const { searchFn } = await drain({
      cacheRow: poisoned({ lang_checked_at: 1723800000000 }),
      userLangs: ['kannada'],
    });
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('treats an unknown track language as no opinion', async () => {
    const { searchFn } = await drain({
      cacheRow: poisoned({ track_language: null }),
      userLangs: ['kannada'],
    });
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('treats a listener with no languages as no opinion', async () => {
    // A fresh account's first import is the worst possible place to start
    // second-guessing the cache.
    const { searchFn } = await drain({
      cacheRow: poisoned(),
      userLangs: [],
    });
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('leaves an in-language hit untouched', async () => {
    const { searchFn, writes } = await drain({
      cacheRow: poisoned({ track_language: 'Kannada', track_id: 'kannada' }),
      userLangs: ['kannada'],
    });
    expect(searchFn).not.toHaveBeenCalled();
    expect(writes.some(w => /SET lang_checked_at/.test(w.sql))).toBe(false);
  });
});
