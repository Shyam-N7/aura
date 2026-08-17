import { describe, it, expect, vi, beforeEach } from 'vitest';

// The streaming contract, driven through the public drainJob surface: the
// playlist is created mid-drain once EARLY_CREATE_MIN items have resolved,
// grows at wave checkpoints, and finishJob converges every path. The fake DB
// here is STATEFUL — verdict writes mutate the item fixture, so the drain's
// own progress feeds the counts the checkpoints read.

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
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn(), getTrackById: vi.fn() }));
vi.mock('./playlists.js', () => ({
  createPlaylistFromImport: vi.fn(),
  appendTracksToPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
}));
vi.mock('./context.js', () => ({ getUserLanguages: vi.fn() }));

import { pool, query } from './db.js';
import { searchSongs } from './catalog.js';
import {
  createPlaylistFromImport, appendTracksToPlaylist, deletePlaylist,
} from './playlists.js';
import { getUserLanguages } from './context.js';
import { drainJob, pruneExpired } from './importJobs.js';

// The proven auto-scoring pair from the langGate suite: this yt title against
// this candidate reaches the auto tier through the REAL matcher.
const YT_TITLE = 'O Sona 8K Video Song | Vaalee | Kiccha Sudeepa';
const KANNADA = {
  id: 'kannada', title: 'O Sona', artist: 'K. Kalyan',
  album: 'Vaalee', language: 'Kannada', durationSec: 351,
};

function makeState(n) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: i + 1, position: i, video_id: `v${i}`,
      yt_title: YT_TITLE, yt_channel: 'Label', yt_duration: 355,
      tier: null, track_id: null,
    })),
    playlistIdOnJob: null,
    persistRefusals: 0, // >0: the conditional persist loses that many races
  };
}

// Global call order of the LAST verdict write, to prove the playlist was
// created BEFORE the drain finished resolving.
let lastVerdictOrder = 0;

function wireDb(state) {
  vi.clearAllMocks();
  lastVerdictOrder = 0;
  getUserLanguages.mockResolvedValue([]);
  searchSongs.mockResolvedValue([KANNADA]);
  createPlaylistFromImport.mockResolvedValue({ id: 'pl_new' });
  appendTracksToPlaylist.mockResolvedValue({ added: 0 });
  deletePlaylist.mockResolvedValue();

  query.mockImplementation(sql => {
    if (/FROM yt_import_items/.test(sql) && /LIMIT/.test(sql)) {
      return Promise.resolve({
        rows: state.items.filter(i => i.tier === null).slice(0, 4)
          .map(({ id, position, video_id, yt_title, yt_channel, yt_duration }) =>
            ({ id, position, video_id, yt_title, yt_channel, yt_duration })),
        rowCount: 0,
      });
    }
    if (/COUNT\(\*\) FILTER \(WHERE tier IS NOT NULL\)/.test(sql)) {
      return Promise.resolve({
        rows: [{ resolved: state.items.filter(i => i.tier !== null).length }],
        rowCount: 1,
      });
    }
    if (/SELECT title, windowed, playlist_id FROM yt_import_jobs/.test(sql)) {
      return Promise.resolve({
        rows: [{ title: 'Road Trip', windowed: false, playlist_id: state.playlistIdOnJob }],
        rowCount: 1,
      });
    }
    if (/tier='auto' AND track_id IS NOT NULL/.test(sql)) {
      return Promise.resolve({
        rows: state.items.filter(i => i.tier === 'auto')
          .sort((a, b) => a.position - b.position)
          .map(i => ({ track_id: i.track_id })),
        rowCount: 0,
      });
    }
    if (/GROUP BY tier/.test(sql)) {
      const by = {};
      for (const i of state.items) { if (i.tier) by[i.tier] = (by[i.tier] ?? 0) + 1; }
      return Promise.resolve({
        rows: Object.entries(by).map(([tier, n]) => ({ tier, n })), rowCount: 0,
      });
    }
    if (/SELECT title, windowed, fetched_count/.test(sql)) {
      return Promise.resolve({
        rows: [{ title: 'Road Trip', windowed: false, fetched_count: state.items.length }],
        rowCount: 1,
      });
    }
    if (/COUNT\(\*\)::int AS n FROM yt_import_items/.test(sql)) {
      return Promise.resolve({
        rows: [{ n: state.items.filter(i => i.tier === null).length }], rowCount: 1,
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  pool.query.mockImplementation((sql, params) => {
    if (/RETURNING id, user_id/.test(sql)) {
      return Promise.resolve({
        rows: [{
          id: 'yti_1', user_id: 'u1', yt_playlist_id: 'PL1', kind: 'PL',
          status: 'matching', title: 'Road Trip', windowed: false,
          playlist_id: state.playlistIdOnJob,
        }],
        rowCount: 1,
      });
    }
    if (/SET fingerprint/.test(sql)) {
      const item = state.items.find(i => i.id === params[0]);
      if (item) { item.tier = params[2]; item.track_id = params[3]; }
      lastVerdictOrder = Math.max(
        lastVerdictOrder,
        pool.query.mock.invocationCallOrder[pool.query.mock.calls.length - 1],
      );
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (/SET playlist_id=\$2/.test(sql) && /playlist_id IS NULL/.test(sql)) {
      if (state.persistRefusals > 0) {
        state.persistRefusals -= 1;
        state.playlistIdOnJob = 'pl_winner';
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      state.playlistIdOnJob = params[1];
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

beforeEach(() => vi.clearAllMocks());

describe('streaming: the playlist opens before the import ends', () => {
  it('creates mid-drain at the threshold, in position order, and converges at finish', async () => {
    const state = makeState(20);
    wireDb(state);
    const out = await drainJob('yti_1', { budgetMs: 30_000 });

    // Created exactly once, with the 16 autos resolved at that moment.
    expect(createPlaylistFromImport).toHaveBeenCalledTimes(1);
    const [, arg] = createPlaylistFromImport.mock.calls[0];
    expect(arg.trackIds).toHaveLength(16);
    expect(arg.name).toBe('Road Trip');

    // The proof of STREAMING: creation happened before the last verdict —
    // the playlist existed while songs were still landing.
    expect(createPlaylistFromImport.mock.invocationCallOrder[0])
      .toBeLessThan(lastVerdictOrder);

    // finishJob converged: the full auto set appended (idempotent server-side).
    const appendCalls = appendTracksToPlaylist.mock.calls;
    expect(appendCalls.length).toBeGreaterThanOrEqual(1);
    expect(appendCalls[appendCalls.length - 1][2]).toHaveLength(20);
    expect(out.status).toBe('complete');
  });

  it('below the threshold nothing streams — today\'s behaviour, frozen', async () => {
    const state = makeState(8);
    wireDb(state);
    const out = await drainJob('yti_1', { budgetMs: 30_000 });

    expect(createPlaylistFromImport).toHaveBeenCalledTimes(1);
    // Creation happened AFTER every verdict: finish-time, not streamed.
    expect(createPlaylistFromImport.mock.invocationCallOrder[0])
      .toBeGreaterThan(lastVerdictOrder);
    // Create carried the full set, so no append was needed at all.
    expect(appendTracksToPlaylist).not.toHaveBeenCalled();
    expect(out.status).toBe('complete');
  });

  it('a lost persist race deletes the orphan and adopts the winner', async () => {
    const state = makeState(20);
    wireDb(state);
    state.persistRefusals = 1;
    const out = await drainJob('yti_1', { budgetMs: 30_000 });

    // Our fresh playlist lost; it was deleted and the winner adopted —
    // every subsequent append targets the winner, never the orphan.
    expect(deletePlaylist).toHaveBeenCalledWith('u1', 'pl_new');
    for (const call of appendTracksToPlaylist.mock.calls) {
      expect(call[1]).toBe('pl_winner');
    }
    expect(out.status).toBe('complete');
  });

  it('a failed checkpoint append never fails the job', async () => {
    const state = makeState(24);
    wireDb(state);
    // First append (the wave-6 checkpoint) dies; the finish append succeeds.
    appendTracksToPlaylist
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ added: 0 });
    const out = await drainJob('yti_1', { budgetMs: 30_000 });

    expect(out.status).toBe('complete');
    const calls = appendTracksToPlaylist.mock.calls;
    // The finish append still delivered the complete set.
    expect(calls[calls.length - 1][2]).toHaveLength(24);
  });
});

describe('pruneExpired terminal-izes stuck jobs', () => {
  it('fails never-finished jobs with YT_EXPIRED before deleting their items', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await pruneExpired();
    const failCall = pool.query.mock.calls.find(([sql]) => /SET status='failed'/.test(sql));
    expect(failCall).toBeTruthy();
    expect(failCall[0]).toMatch(/status IN \('queued','fetching','matching'\)/);
    expect(failCall[1]).toContain('YT_EXPIRED');
  });
});
