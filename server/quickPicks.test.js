import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Isolate the picker: score engine's DB-touching functions mocked (edition-key
// helpers stay real — the daily seed math is the thing under test); stats mocked
// for the sparse top-up; related/catalog mocked so importing featured.js (the
// real pickDaily/hash) never loads config env.
vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn() }));
vi.mock('./related.js', () => ({
  getRelatedTracks: vi.fn(),
  normalizeTitle: (s) => (s ?? '').toLowerCase(),
  capPerArtist: (tracks, max = 2) => {
    const counts = new Map();
    const out = [];
    for (const t of tracks) {
      const a = (t.artist || '').toLowerCase().trim();
      if (a) {
        const n = counts.get(a) ?? 0;
        if (n >= max) continue;
        counts.set(a, n + 1);
      }
      out.push(t);
    }
    return out;
  },
}));
vi.mock('./tasteScore.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getScoredTracks: vi.fn(),
  getSuppressedTrackIds: vi.fn(),
}));
vi.mock('./stats.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getRecentlyPlayed: vi.fn(),
}));
vi.mock('./impressions.js', () => ({
  getImpressionSignals: vi.fn().mockResolvedValue(new Map()),
  applyPenalty: (score, days) => score * Math.pow(0.85, days || 0),
}));

import { pool } from './db.js';
import { getScoredTracks, getSuppressedTrackIds, localDateKey } from './tasteScore.js';
import { getRecentlyPlayed } from './stats.js';
import { getImpressionSignals } from './impressions.js';
import { getQuickPicks, ANCHOR_COUNT, daypartOf } from './quickPicks.js';

const scored = (id, { artist, plays = 3, completions = 0, liked = false, explicit = false } = {}) => ({
  id, title: `Song ${id}`, artist: artist ?? `Artist ${id}`, album: null, language: 'tamil',
  duration_sec: 200, stream_url: `s-${id}`, raw: { imageUrl: `img-${id}`, explicit },
  score: 5, plays, completions, liked, last_play_ts: String(1700000000000),
});
const manyScored = (n) => Array.from({ length: n }, (_, i) => scored(`t${i}`));
const ids = (r) => r.tracks.map(t => t.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-08T10:00:00Z'));
  getSuppressedTrackIds.mockResolvedValue(new Set());
  getRecentlyPlayed.mockResolvedValue([]);
  getImpressionSignals.mockResolvedValue(new Map());
  pool.query.mockResolvedValue({ rows: [] });   // exploration graph empty by default
});
afterEach(() => vi.useRealTimers());

describe('getQuickPicks', () => {
  it('is deterministic within a day and carries the daily edition key', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    const a = await getQuickPicks('u1', { tzOffset: -330 });
    const b = await getQuickPicks('u1', { tzOffset: -330 });
    expect(ids(a)).toEqual(ids(b));
    expect(a.editionKey).toBe(localDateKey(-330));
    expect(a.cadence).toBe('rotates daily');
    expect(a.tracks).toHaveLength(12);
  });

  it('rolls the rotating slots at the day boundary but keeps the anchors', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    const day1 = await getQuickPicks('u1', { tzOffset: 0 });
    vi.setSystemTime(new Date('2026-07-09T10:00:00Z'));
    const day2 = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(day1).slice(0, ANCHOR_COUNT)).toEqual(ids(day2).slice(0, ANCHOR_COUNT));
    expect(ids(day1)).not.toEqual(ids(day2));
    expect(day1.tracks.slice(0, ANCHOR_COUNT).every(t => t.anchor)).toBe(true);
    expect(day1.tracks.slice(ANCHOR_COUNT).every(t => !t.anchor)).toBe(true);
  });

  it('a salt rerolls the rotating slots only', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    const plain = await getQuickPicks('u1', { tzOffset: 0 });
    const salted = await getQuickPicks('u1', { tzOffset: 0, salt: 'reroll-1' });
    expect(ids(salted).slice(0, ANCHOR_COUNT)).toEqual(ids(plain).slice(0, ANCHOR_COUNT));
    expect(ids(salted)).not.toEqual(ids(plain));
  });

  it('different users get different rotations from the same pool', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    const u1 = await getQuickPicks('u1', { tzOffset: 0 });
    const u2 = await getQuickPicks('u2', { tzOffset: 0 });
    expect(ids(u1)).not.toEqual(ids(u2));
  });

  it('never serves suppressed tracks and caps two per artist', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['t1']));
    getScoredTracks.mockResolvedValue([
      scored('t0', { artist: 'A' }), scored('t1', { artist: 'B' }),
      scored('t2', { artist: 'A' }), scored('t3', { artist: 'A' }),
      scored('t4', { artist: 'C' }),
    ]);
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(r)).not.toContain('t1');   // hidden/skip-shelved
    expect(ids(r)).not.toContain('t3');   // third track by artist A
    expect(ids(r)).toEqual(expect.arrayContaining(['t0', 't2', 't4']));
  });

  it('tops up a sparse history from recently-played, without dupes or suppressed', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['r-bad']));
    getScoredTracks.mockResolvedValue([scored('t0'), scored('t1')]);
    getRecentlyPlayed.mockResolvedValue([
      { id: 't0', title: 'Song t0', artist: 'Artist t0' },   // dupe of a scored pick
      { id: 'r-bad', title: 'Hidden', artist: 'X' },
      { id: 'r1', title: 'Recent 1', artist: 'Y' },
    ]);
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(r)).toEqual(['t0', 't1', 'r1']);
    const r1 = r.tracks.find(t => t.id === 'r1');
    expect(r1.reason).toBe('you played this recently');
    expect(r1.anchor).toBe(false);
  });

  it('writes honest reasons from the signals that ranked each pick', async () => {
    getScoredTracks.mockResolvedValue([
      scored('fin', { completions: 3 }),
      scored('lk',  { liked: true, plays: 5 }),
      scored('one', { completions: 1 }),
      scored('pl',  { plays: 4 }),
      scored('rc',  { plays: 1 }),
    ]);
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    const reason = (id) => r.tracks.find(t => t.id === id).reason;
    expect(reason('fin')).toBe('you finished this 3× lately');
    expect(reason('lk')).toBe('you liked this');
    expect(reason('one')).toBe('you finished this lately');
    expect(reason('pl')).toBe('4 plays this month');
    expect(reason('rc')).toBe('you played this recently');
  });

  it('rides the explicit flag out so the client family filter can see it', async () => {
    getScoredTracks.mockResolvedValue([scored('e1', { explicit: true }), scored('e2')]);
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(r.tracks.find(t => t.id === 'e1').explicit).toBe(true);
    expect(r.tracks.find(t => t.id === 'e2').explicit).toBe(false);
  });

  it('returns short instead of padding when the data is thin', async () => {
    getScoredTracks.mockResolvedValue([scored('t0')]);
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(r.tracks).toHaveLength(1);
  });
});

describe('getQuickPicks — impression demotion', () => {
  it('queries the signal for the non-anchor candidates only', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    await getQuickPicks('u1', { tzOffset: 0 });
    const [uid, surface, checkedIds] = getImpressionSignals.mock.calls[0];
    expect(uid).toBe('u1');
    expect(surface).toBe('quick-picks');
    expect(checkedIds).not.toContain('t0');   // anchors are exempt — never checked
    expect(checkedIds).not.toContain('t1');
    expect(checkedIds).not.toContain('t2');
    expect(checkedIds).toContain('t3');
  });

  it('sinks a repeatedly-shown, never-played pick out of the rotation window', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));   // all equal score
    getImpressionSignals.mockResolvedValue(new Map([['t5', { unplayedShownDays: 6, cooledDown: false }]]));
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(r)).not.toContain('t5');   // penalised below rank ~24
  });

  it('holds a cooled-down pick out of rotation entirely', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    getImpressionSignals.mockResolvedValue(new Map([['t4', { unplayedShownDays: 3, cooledDown: true }]]));
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(r)).not.toContain('t4');
  });

  it('never demotes an anchor, even if flagged', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    getImpressionSignals.mockResolvedValue(new Map([['t0', { unplayedShownDays: 10, cooledDown: true }]]));
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(ids(r).slice(0, ANCHOR_COUNT)).toContain('t0');
  });
});

describe('daypartOf', () => {
  it('buckets the local hour into four dayparts', () => {
    const at = (h) => daypartOf(0, Date.UTC(2026, 6, 8, h, 0, 0));
    expect(at(6)).toBe('morning');
    expect(at(13)).toBe('afternoon');
    expect(at(18)).toBe('evening');
    expect(at(23)).toBe('night');
    expect(at(2)).toBe('night');
  });
});

describe('getQuickPicks — daypart rotation + exploration', () => {
  it('re-seeds the rotation per daypart while the anchors hold', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    vi.setSystemTime(new Date('2026-07-08T08:00:00Z'));   // morning at tz 0
    const morning = await getQuickPicks('u1', { tzOffset: 0 });
    vi.setSystemTime(new Date('2026-07-08T18:00:00Z'));   // evening, same day
    const evening = await getQuickPicks('u1', { tzOffset: 0 });
    expect(morning.daypart).toBe('morning');
    expect(evening.daypart).toBe('evening');
    expect(ids(morning).slice(0, ANCHOR_COUNT)).toEqual(ids(evening).slice(0, ANCHOR_COUNT));
    expect(ids(morning)).not.toEqual(ids(evening));   // rotating slots re-themed
  });

  it('places a "something new" exploration pick as the 8th shown slot', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    pool.query.mockResolvedValue({ rows: [
      { id: 'x1', title: 'New 1', artist: 'ZZ', duration_sec: 200, raw: {}, shown: 0 },
      { id: 'x2', title: 'New 2', artist: 'YY', duration_sec: 200, raw: {}, shown: 0 },
    ] });
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    const shown = r.tracks.slice(0, 8);
    expect(shown[7].exploration).toBe(true);
    expect(shown[7].reason).toBe('something new');
    expect(shown.slice(0, ANCHOR_COUNT).every(t => t.anchor)).toBe(true);   // anchors intact
    expect(ids(r)).not.toContain(undefined);
  });

  it('skips the exploration slot (and never errors) when the graph is thin', async () => {
    getScoredTracks.mockResolvedValue(manyScored(30));
    pool.query.mockResolvedValue({ rows: [] });
    const r = await getQuickPicks('u1', { tzOffset: 0 });
    expect(r.tracks.some(t => t.exploration)).toBe(false);
    expect(r.tracks).toHaveLength(12);
  });
});
