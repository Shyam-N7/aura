import { describe, it, expect, vi, beforeEach } from 'vitest';

// The engine's DB is mocked here; its behaviour against a REAL Postgres was
// verified separately (see the commit notes — the lease, the concurrent claim,
// and the retention prune were all found or confirmed that way). What these
// tests pin is the logic that sits above SQL: which links are refused before a
// single unit is spent, how the caps read, and that the feature is genuinely
// inert with no key.

// pool.query and query are DISTINCT spies, as they are distinct functions in
// db.js. Aliasing them makes call counts meaningless — the read path uses
// query(), the write path uses pool.query(), and a test that cannot tell them
// apart cannot assert "this refusal cost us nothing".
vi.mock('./db.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  query: vi.fn(),
}));
vi.mock('./config.js', () => ({
  YOUTUBE_API_KEY: 'test-key',
  YT_IMPORT_DAILY_CAP: 200,
  YT_IMPORT_USER_DAILY: 10,
}));
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn() }));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn() }));
vi.mock('./playlists.js', () => ({
  createPlaylistFromImport: vi.fn(),
  appendTracksToPlaylist: vi.fn(),
}));
vi.mock('./youtubeFetch.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPlaylistForImport: vi.fn(),
}));

import { pool, query } from './db.js';
import { enqueueImport, youtubeImportEnabled, pruneExpired, processImportQueue, drainJob } from './importJobs.js';

// enqueueImport makes exactly two reads, in order: the cap check, then the
// "is one already running" lookup. The happy default is "under the caps, none
// running"; individual tests override with mockResolvedValueOnce.
function happyReads() {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [{ mine: 0, total: 0 }], rowCount: 1 })
    .mockResolvedValue({ rows: [], rowCount: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  pool.query.mockResolvedValue({ rows: [{ id: 'yti_x', status: 'queued' }], rowCount: 1 });
  happyReads();
});

describe('enqueueImport — refusals that cost nothing', () => {
  // Every case below is settled from the link alone, before any API call. That
  // is the point of classifying first: several of these would otherwise SUCCEED
  // at importing nothing.

  it('refuses Watch Later with its own code', async () => {
    // WL returns an EMPTY LIST rather than an error from the Data API, so
    // without this the user watches a spinner finish and gets an empty
    // playlist, with nothing anywhere saying why.
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=WL'))
      .rejects.toMatchObject({ code: 'YT_WATCH_LATER', statusCode: 422 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('refuses History', async () => {
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=HL'))
      .rejects.toMatchObject({ code: 'YT_HISTORY' });
  });

  it('tells a bare video link apart from a junk link', async () => {
    // The single most common mistake deserves its own message: the user pasted
    // something real, just not a playlist.
    await expect(enqueueImport('u1', 'https://www.youtube.com/watch?v=abc12345678'))
      .rejects.toMatchObject({ code: 'YT_VIDEO_ONLY' });
    await expect(enqueueImport('u1', 'https://open.spotify.com/playlist/x'))
      .rejects.toMatchObject({ code: 'YT_NOT_YOUTUBE' });
    await expect(enqueueImport('u1', ''))
      .rejects.toMatchObject({ code: 'YT_EMPTY' });
  });

  it('sends a Liked-videos link down the OAuth path, not a generic error', async () => {
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=LL'))
      .rejects.toMatchObject({ code: 'YT_OAUTH_REQUIRED' });
  });

  it('asks the user to save a personal mix rather than guessing', async () => {
    // RDMM/RDAMVM are seeded by the signed-in user and it is UNTESTED whether a
    // server key can read them. GUIDED degrades to one extra step; wrongly
    // routing them OFFICIAL degrades to a confusing failure.
    await expect(enqueueImport('u1', 'https://www.youtube.com/watch?v=x&list=RDMMabcdef'))
      .rejects.toMatchObject({ code: 'YT_NEEDS_SAVE' });
  });

  it('accepts a video radio mix — measured as API-served', async () => {
    const job = await enqueueImport('u1', 'https://www.youtube.com/watch?v=s9Mtq4EUBkM&list=RDs9Mtq4EUBkM');
    expect(job.status).toBe('queued');
    expect(pool.query).toHaveBeenCalled();
  });

  it('accepts an ordinary playlist and an album', async () => {
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc123')).resolves.toBeTruthy();
    happyReads();
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=OLAK5uyxyz')).resolves.toBeTruthy();
  });
});

describe('schema drift', () => {
  it('names a missing-column failure instead of calling it internal', async () => {
    // Field incident: v34 shipped in code while prod sat at schema 33, and
    // every import died as YT_INTERNAL — whose copy says "try again", for a
    // failure no retry can fix, with each retry burning the daily cap.
    // Postgres 42703 (undefined column) IS the migration-drift signature.
    query.mockReset();
    const drift = Object.assign(new Error('column c.lang_checked_at does not exist'), { code: '42703' });
    // claimJob's UPDATE returns a claimed job; the next read throws the drift.
    pool.query.mockResolvedValue({
      rows: [{ id: 'yti_d', user_id: 'u1', yt_playlist_id: 'PL1', kind: 'playlist', status: 'matching' }],
      rowCount: 1,
    });
    query.mockRejectedValue(drift);
    const out = await drainJob('yti_d');
    expect(out.code).toBe('YT_MIGRATION');
    // failJob recorded the named code, not YT_INTERNAL.
    const fail = pool.query.mock.calls.find(c => String(c[0]).includes("status='failed'"));
    expect(fail[1][1]).toMatch(/^YT_MIGRATION:/);
  });

  it('does not count migration-drift failures toward the caps', async () => {
    // Every hopeful retry during an outage created a job; charging those to
    // the 10/day cap would lock users out for a day after the fix. The
    // exclusion lives in the cap query itself — pin it there.
    happyReads();
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    await enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc123');
    const capSql = String(query.mock.calls[0][0]);
    expect(capSql).toContain("error LIKE 'YT_MIGRATION%'");
  });
});

describe('enqueueImport — caps and duplicates', () => {
  it('stops a user at their daily cap before spending anything', async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ mine: 10, total: 12 }], rowCount: 1 });
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc123'))
      .rejects.toMatchObject({ code: 'YT_USER_CAP', statusCode: 429 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('stops everyone at the global cap', async () => {
    query.mockReset();
    query.mockResolvedValue({ rows: [{ mine: 1, total: 200 }], rowCount: 1 });
    await expect(enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc123'))
      .rejects.toMatchObject({ code: 'YT_GLOBAL_CAP', statusCode: 503 });
  });

  it('returns the running job instead of starting a second one', async () => {
    // Double-tapping "import" is not a request for two playlists.
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ mine: 0, total: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'yti_running', status: 'matching' }], rowCount: 1 });
    const job = await enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc123');
    expect(job).toMatchObject({ id: 'yti_running', reused: true });
    // No INSERT: the second tap must not create a row.
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('retention', () => {
  it('deletes YouTube-derived items but never the match cache', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 7 });
    expect(await pruneExpired()).toBe(7);
    const sql = pool.query.mock.calls.map(c => c[0]).join('\n');
    expect(sql).toMatch(/DELETE FROM yt_import_items/);
    // yt_match_cache is keyed on a fingerprint of our own derived parse, never
    // a YouTube identifier, so it is outside the 30-day rule. Expiring it would
    // throw away the one asset that improves with use.
    expect(sql).not.toMatch(/DELETE FROM yt_match_cache/);
  });

  it('uses a 30-day cutoff', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const before = Date.now();
    await pruneExpired();
    const cutoff = pool.query.mock.calls[0][1][0];
    const days = (before - cutoff) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

describe('with no API key', () => {
  beforeEach(() => vi.resetModules());

  it('is off, refuses to enqueue, and still prunes', async () => {
    vi.doMock('./config.js', () => ({
      YOUTUBE_API_KEY: '', YT_IMPORT_DAILY_CAP: 200, YT_IMPORT_USER_DAILY: 10,
    }));
    const mod = await import('./importJobs.js');
    expect(mod.youtubeImportEnabled()).toBe(false);
    await expect(mod.enqueueImport('u1', 'https://www.youtube.com/playlist?list=PLabc'))
      .rejects.toMatchObject({ code: 'YT_DISABLED', statusCode: 503 });
    // The prune must run regardless: turning the key off must not strand
    // YouTube-derived rows past their retention window.
    const result = await mod.processImportQueue({});
    expect(result).toMatchObject({ enabled: false, drained: 0 });
  });
});

describe('with the key set', () => {
  it('reports enabled', () => {
    expect(youtubeImportEnabled()).toBe(true);
  });

  it('the cron claims only unleased, non-terminal jobs', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await processImportQueue({ batch: 3 });
    const sql = query.mock.calls.map(c => c[0]).join('\n');
    // The lease — not updated_at — is what serializes drains. Conflating the
    // two made a budget-exhausted job unresumable for the full stuck timeout.
    expect(sql).toMatch(/leased_until < \$1/);
    expect(sql).toMatch(/status IN \('queued','fetching','matching'\)/);
  });
});
