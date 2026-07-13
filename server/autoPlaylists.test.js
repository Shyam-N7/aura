import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the orchestrator: DB mocked; the score engine's DB-touching functions
// mocked (its pure edition-key helpers stay real — their math is under test in
// tasteScore.test.js and used for expectations here); discovery fully mocked
// (it has its own suite); capPerArtist mirrored so related.js (→ config env
// load) never imports.
vi.mock('./db.js', () => ({ pool: { query: vi.fn() } }));
// featured.js (real pickDaily, used by the daily reorder) imports catalog.js,
// which loads config env — stub it so the import stays offline.
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn() }));
vi.mock('./related.js', () => ({
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
vi.mock('./discoveryMix.js', () => ({
  buildDiscoveryMix: vi.fn(),
  getDiscoveryGate: vi.fn(),
  GATE: { tracks: 30, artists: 5, windowDays: 90 },
  DISCOVERY_SIZE: 30,
}));
vi.mock('./tasteScore.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getScoredTracks: vi.fn(),
  getSuppressedTrackIds: vi.fn(),
}));

import { pool } from './db.js';
import { buildDiscoveryMix, getDiscoveryGate } from './discoveryMix.js';
import { getScoredTracks, getSuppressedTrackIds, localDateKey, lastFridayKey, lastMondayKey } from './tasteScore.js';
import { getAutoPlaylists, refreshDueMixes, RULE_LINE } from './autoPlaylists.js';

const trackRow = (id) => ({
  id, title: `Song ${id}`, artist: `Artist ${id}`, album: null, language: 'tamil',
  duration_sec: 200, stream_url: `s-${id}`, raw: { imageUrl: `img-${id}` },
});
const scored = (id, { plays = 4, completions = 2, lastPlayDaysAgo = 90, artist } = {}) => ({
  ...trackRow(id),
  artist: artist ?? `Artist ${id}`,
  score: 5, plays, completions,
  last_play_ts: String(Date.now() - lastPlayDaysAgo * 86400000),   // BIGINT → string, like pg
});
const ids = (n, prefix = 't') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// Scripted pool: editions by (mixKey, editionKey); hydration serves trackRow for
// every requested id unless told to drop some; INSERTs are captured. Editions may
// carry a `generatedAt` (defaults to now — a fresh hit that won't trip re-key).
// `playsSinceCount` feeds the re-key COUNT; `playedTrackIds` feeds carryover.
let editions, stored, missingTrackIds, playsSinceCount, playedTrackIds;
function installPool() {
  pool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM mix_editions') && sql.includes('edition_key = $3')) {
      const hit = editions.find(e => e.mixKey === params[1] && e.editionKey === params[2]);
      return { rows: hit ? [{ payload: hit.payload, edition_key: hit.editionKey, generated_at: hit.generatedAt ?? Date.now() }] : [] };
    }
    if (sql.includes('FROM mix_editions') && sql.includes('ORDER BY generated_at DESC') && sql.includes('mix_key')) {
      const hit = editions.filter(e => e.mixKey === params[1]).at(-1);
      return { rows: hit ? [{ payload: hit.payload, edition_key: hit.editionKey, generated_at: hit.generatedAt ?? Date.now() }] : [] };
    }
    if (sql.includes(`payload->'meta'->>'tz'`)) {
      return { rows: editions.length ? [{ tz: String(editions.at(-1).payload?.meta?.tz ?? 0) }] : [] };
    }
    if (sql.includes('INSERT INTO mix_editions')) {
      stored.push({ mixKey: params[1], editionKey: params[2], payload: JSON.parse(params[3]) });
      return { rows: [] };
    }
    if (sql.includes('FROM tracks WHERE id = ANY')) {
      return { rows: params[0].filter(id => !missingTrackIds.has(id)).map(trackRow) };
    }
    if (sql.includes('COUNT(*)::int AS n FROM listening_events')) {
      return { rows: [{ n: playsSinceCount }] };   // eligiblePlaysSince (re-key trigger)
    }
    if (sql.includes('SELECT DISTINCT track_id FROM listening_events')) {
      return { rows: [...playedTrackIds].map(id => ({ track_id: id })) };   // carryover: heard ids
    }
    if (sql.includes('SELECT DISTINCT user_id FROM listening_events')) {
      return { rows: [{ user_id: 'u1' }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  editions = [];
  stored = [];
  missingTrackIds = new Set();
  playsSinceCount = 0;
  playedTrackIds = new Set();
  installPool();
  getSuppressedTrackIds.mockResolvedValue(new Set());
  getScoredTracks.mockResolvedValue([]);
  getDiscoveryGate.mockResolvedValue({ ok: false, have: 14, need: 30 });
  buildDiscoveryMix.mockResolvedValue(null);
});

describe('getAutoPlaylists — edition cache', () => {
  it('serves cached editions without generating, with edition + rule metadata', async () => {
    const payload = { tracks: ids(6).map(id => ({ trackId: id, reason: 'r' })), meta: { tz: 0 } };
    // morning/night now key daily (localDateKey), like on-repeat; only bring-it-
    // back and new-to-you stay weekly.
    const keys = {
      'on-repeat': localDateKey(0), 'new-to-you': lastFridayKey(0),
      'bring-it-back': lastMondayKey(0), morning: localDateKey(0), night: localDateKey(0),
    };
    editions = Object.entries(keys).map(([mixKey, editionKey]) => ({ mixKey, editionKey, payload }));

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });

    expect(sets).toHaveLength(5);
    expect(getScoredTracks).not.toHaveBeenCalled();
    expect(buildDiscoveryMix).not.toHaveBeenCalled();
    expect(getDiscoveryGate).not.toHaveBeenCalled();
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');
    expect(onRepeat.kind).toBe('auto');
    expect(onRepeat.editionKey).toBe(keys['on-repeat']);
    expect(onRepeat.editionLabel).toMatch(/^edition · [a-z]{3} \d{1,2} [a-z]{3}$/);
    expect(onRepeat.cadence).toBe('updates daily');
    expect(onRepeat.ruleLine).toBe(RULE_LINE);
    // on-repeat isn't a daily-reorder mix, so its order is the edition's.
    expect(onRepeat.tracks[0]).toMatchObject({ id: 't0', title: 'Song t0', reason: 'r' });
  });

  it('omits a cached mix whose hydrated set fell under the minimum', async () => {
    const payload = { tracks: ids(6).map(id => ({ trackId: id, reason: 'r' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'on-repeat', editionKey: localDateKey(0), payload }];
    missingTrackIds = new Set(['t0', 't1']);   // 4 hydrate < MIN_SET 5

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    expect(sets.find(s => s.id === 'auto:on-repeat')).toBeUndefined();
  });

  it('drops a freshly hidden track at serve time, before the next edition', async () => {
    const payload = { tracks: ids(7).map(id => ({ trackId: id, reason: 'r' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'on-repeat', editionKey: localDateKey(0), payload }];
    getSuppressedTrackIds.mockResolvedValue(new Set(['t3']));

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');
    expect(onRepeat.tracks.map(t => t.id)).not.toContain('t3');
    expect(onRepeat.tracks).toHaveLength(6);
  });
});

describe('getAutoPlaylists — familiar generation', () => {
  it('generates on repeat inline on a miss: stores the edition, receipts pick by data', async () => {
    getScoredTracks.mockImplementation(async (u, opts) => {
      if (opts.daypart || opts.dormantDays) return [];
      return [
        scored('a', { completions: 3 }),
        scored('b', { completions: 1 }),
        scored('c', { completions: 0, plays: 9 }),
        scored('d'), scored('e'), scored('f'),
      ];
    });

    const sets = await getAutoPlaylists('u1', { tzOffset: -330 });
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');

    expect(onRepeat).toBeDefined();
    const store = stored.find(s => s.mixKey === 'on-repeat');
    expect(store.editionKey).toBe(localDateKey(-330));
    const reasons = Object.fromEntries(store.payload.tracks.map(t => [t.trackId, t.reason]));
    expect(reasons.a).toBe('you finished this 3× lately');
    expect(reasons.b).toBe('you finished this lately');
    expect(reasons.c).toBe('9 plays this month');
    // The two familiar windows stay disjoint by construction: recent-window
    // vs ≥60d dormancy on the score query options.
    const optsList = getScoredTracks.mock.calls.map(c => c[1]);
    expect(optsList.some(o => o.windowDays === 60 && !o.dormantDays && !o.daypart)).toBe(true);
    expect(optsList.some(o => o.dormantDays === 60)).toBe(true);
  });

  it('excludes suppressed tracks from generation and enforces the artist cap', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['shelved']));
    getScoredTracks.mockImplementation(async (u, opts) => {
      if (opts.daypart || opts.dormantDays) return [];
      return [
        scored('shelved'),
        scored('x1', { artist: 'Same' }), scored('x2', { artist: 'Same' }), scored('x3', { artist: 'Same' }),
        scored('y1'), scored('y2'), scored('y3'), scored('y4'),
      ];
    });

    await getAutoPlaylists('u1', { tzOffset: 0 });
    const store = stored.find(s => s.mixKey === 'on-repeat');
    const kept = store.payload.tracks.map(t => t.trackId);
    expect(kept).not.toContain('shelved');
    expect(kept.filter(id => id.startsWith('x'))).toHaveLength(2);   // ≤2 per artist
  });

  it('gives bring it back era receipts and a dominant-month description', async () => {
    const march = (Date.UTC(2026, 2, 15) - Date.now()) / 86400000 * -1;   // days ago to land in march
    getScoredTracks.mockImplementation(async (u, opts) => {
      if (!opts.dormantDays) return [];
      return [
        scored('m1', { lastPlayDaysAgo: march }), scored('m2', { lastPlayDaysAgo: march }),
        scored('m3', { lastPlayDaysAgo: march }), scored('m4', { lastPlayDaysAgo: march }),
        scored('n1', { lastPlayDaysAgo: 200 }),
      ];
    });

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const bib = sets.find(s => s.id === 'auto:bring-it-back');
    expect(bib.description).toBe('your march songs, mostly');
    expect(bib.tracks.find(t => t.id === 'm1').reason).toMatch(/^big for you in march — 4 plays, none since$/);
  });

  it('omits a daypart mix when its play volume is under the gate', async () => {
    getScoredTracks.mockImplementation(async (u, opts) => {
      if (opts.daypart !== 'morning') return [];
      return [scored('d1', { plays: 5 }), scored('d2', { plays: 5 }), scored('d3', { plays: 5 }),
        scored('d4', { plays: 5 }), scored('d5', { plays: 5 })];   // 25 plays < 40
    });
    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    expect(sets.find(s => s.id === 'auto:morning')).toBeUndefined();
  });

  it('ships a daypart mix when the data supports it', async () => {
    getScoredTracks.mockImplementation(async (u, opts) => {
      if (opts.daypart !== 'night') return [];
      return ids(6, 'n').map(id => scored(id, { plays: 10 }));   // 60 night plays
    });
    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const night = sets.find(s => s.id === 'auto:night');
    expect(night).toBeDefined();
    expect(night.tracks[0].reason).toBe('a night regular — 10 night plays');
  });
});

describe('getAutoPlaylists — discovery serving', () => {
  it('shows the honest gate card under the minimum-data threshold', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: false, have: 14, need: 30 });
    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const gate = sets.find(s => s.id === 'auto:new-to-you');
    expect(gate.kind).toBe('auto-gate');
    expect(gate.gate.line).toBe("unlocks after ~30 songs — you're at 14");
    expect(gate.tracks).toEqual([]);
    expect(buildDiscoveryMix).not.toHaveBeenCalled();
  });

  it('builds the fresh edition inline on a miss, carrying unplayed picks forward', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: true, have: 80, need: 30 });
    const prev = { tracks: ids(6, 'p').map(id => ({ trackId: id, reason: 'because' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'new-to-you', editionKey: '2026-06-26', payload: prev, generatedAt: Date.now() - 7 * 86400000 }];
    playedTrackIds = new Set(['p0', 'p1']);   // two prior picks have since been heard
    buildDiscoveryMix.mockResolvedValue({
      tracks: ids(20, 'f').map(id => ({ trackId: id, reason: 'fresh' })), meta: { tz: 0 },
    });

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const mix = sets.find(s => s.id === 'auto:new-to-you');
    expect(mix.refreshing).toBe(false);
    expect(mix.editionKey).toBe(lastFridayKey(0));

    const store = stored.find(s => s.mixKey === 'new-to-you');
    // p2..p5 (still unplayed) ride forward, pinned at the front; p0/p1 dropped.
    expect(store.payload.tracks.slice(0, 4).map(t => t.trackId)).toEqual(['p2', 'p3', 'p4', 'p5']);
    expect(store.payload.meta.carriedOver).toBe(4);
    // The fresh build is told to exclude the carryover and asked for the remainder.
    expect(buildDiscoveryMix).toHaveBeenCalledWith('u1',
      expect.objectContaining({ size: 26, excludeIds: ['p2', 'p3', 'p4', 'p5'] }));
  });

  it('falls back to the previous edition when the inline build yields too little', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: true, have: 80, need: 30 });
    const prev = { tracks: ids(6, 'p').map(id => ({ trackId: id, reason: 'because' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'new-to-you', editionKey: '2026-06-26', payload: prev, generatedAt: Date.now() - 7 * 86400000 }];
    playedTrackIds = new Set(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);   // all heard → no carryover
    buildDiscoveryMix.mockResolvedValue(null);                        // pool ran thin

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const mix = sets.find(s => s.id === 'auto:new-to-you');
    expect(mix.refreshing).toBe(true);
    expect(mix.editionKey).toBe('2026-06-26');
    expect(stored.find(s => s.mixKey === 'new-to-you')).toBeUndefined();
  });

  it('never carries over from an edition past the carryover window', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: true, have: 80, need: 30 });
    const prev = { tracks: ids(6, 'p').map(id => ({ trackId: id, reason: 'because' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'new-to-you', editionKey: '2026-06-01', payload: prev, generatedAt: Date.now() - 30 * 86400000 }];
    playedTrackIds = new Set();   // unplayed, but the edition is 30 days old
    buildDiscoveryMix.mockResolvedValue({
      tracks: ids(10, 'f').map(id => ({ trackId: id, reason: 'fresh' })), meta: { tz: 0 },
    });

    await getAutoPlaylists('u1', { tzOffset: 0 });
    const store = stored.find(s => s.mixKey === 'new-to-you');
    expect(store.payload.meta.carriedOver).toBe(0);
    expect(buildDiscoveryMix).toHaveBeenCalledWith('u1',
      expect.objectContaining({ size: 30, excludeIds: [] }));
  });

  it('generates inline for a first-ever edition, and stores it', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: true, have: 80, need: 30 });
    buildDiscoveryMix.mockResolvedValue({
      tracks: ids(6, 'd').map(id => ({ trackId: id, reason: 'because you kept playing X' })),
      meta: { tz: 0 },
    });

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const mix = sets.find(s => s.id === 'auto:new-to-you');
    expect(mix.refreshing).toBe(false);
    expect(buildDiscoveryMix).toHaveBeenCalledTimes(1);
    expect(stored.find(s => s.mixKey === 'new-to-you')?.editionKey).toBe(lastFridayKey(0));
  });
});

describe('getAutoPlaylists — on-repeat mid-day re-key', () => {
  const cachedOnRepeat = (ageMs) => {
    const payload = { tracks: ids(6).map(id => ({ trackId: id, reason: 'old' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'on-repeat', editionKey: localDateKey(0), payload, generatedAt: Date.now() - ageMs }];
  };

  it('rebuilds when the edition is old enough and enough new plays have landed', async () => {
    cachedOnRepeat(3 * 60 * 60 * 1000);   // 3h old
    playsSinceCount = 15;
    getScoredTracks.mockImplementation(async (u, opts) =>
      (opts.daypart || opts.dormantDays) ? [] : ids(6, 'new').map(id => scored(id)));

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');
    expect(onRepeat.tracks.map(t => t.id)).toEqual(ids(6, 'new'));   // the rebuilt set
    expect(stored.some(s => s.mixKey === 'on-repeat')).toBe(true);
  });

  it('holds the cached edition below the play threshold', async () => {
    cachedOnRepeat(3 * 60 * 60 * 1000);
    playsSinceCount = 14;
    getScoredTracks.mockImplementation(async (u, opts) =>
      (opts.daypart || opts.dormantDays) ? [] : ids(6, 'new').map(id => scored(id)));

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');
    expect(onRepeat.tracks.map(t => t.id)).toEqual(ids(6));   // still the cached edition
    expect(stored.find(s => s.mixKey === 'on-repeat')).toBeUndefined();
  });

  it('holds the cached edition within the age floor even with plays to spare', async () => {
    cachedOnRepeat(30 * 60 * 1000);   // 30 min old — under the 2h floor
    playsSinceCount = 100;
    getScoredTracks.mockImplementation(async (u, opts) =>
      (opts.daypart || opts.dormantDays) ? [] : ids(6, 'new').map(id => scored(id)));

    const sets = await getAutoPlaylists('u1', { tzOffset: 0 });
    const onRepeat = sets.find(s => s.id === 'auto:on-repeat');
    expect(onRepeat.tracks.map(t => t.id)).toEqual(ids(6));
    expect(stored.find(s => s.mixKey === 'on-repeat')).toBeUndefined();
  });
});

describe('getAutoPlaylists — cadence contracts', () => {
  it('keys the daypart mixes daily, not weekly', async () => {
    getScoredTracks.mockImplementation(async (u, opts) =>
      opts.daypart ? ids(6, opts.daypart).map(id => scored(id, { plays: 10 })) : []);   // 60 daypart plays

    await getAutoPlaylists('u1', { tzOffset: 0 });
    expect(stored.find(s => s.mixKey === 'morning')?.editionKey).toBe(localDateKey(0));
    expect(stored.find(s => s.mixKey === 'night')?.editionKey).toBe(localDateKey(0));
  });

  it('re-orders a weekly mix deterministically per day while freezing its set', async () => {
    getDiscoveryGate.mockResolvedValue({ ok: true, have: 80, need: 30 });
    const payload = { tracks: ids(12, 'p').map(id => ({ trackId: id, reason: 'r' })), meta: { tz: 0 } };
    editions = [{ mixKey: 'new-to-you', editionKey: lastFridayKey(0), payload }];

    const a = await getAutoPlaylists('u1', { tzOffset: 0 });
    const b = await getAutoPlaylists('u1', { tzOffset: 0 });
    const orderA = a.find(s => s.id === 'auto:new-to-you').tracks.map(t => t.id);
    const orderB = b.find(s => s.id === 'auto:new-to-you').tracks.map(t => t.id);

    expect(orderA).toEqual(orderB);                                   // deterministic per day
    expect(new Set(orderA)).toEqual(new Set(ids(12, 'p')));           // set frozen
    expect(orderA).not.toEqual(ids(12, 'p'));                         // order actually changed
  });
});

describe('refreshDueMixes (cron pre-warm)', () => {
  it('generates missing editions for recently active users and reports counts', async () => {
    getScoredTracks.mockImplementation(async (u, opts) =>
      (opts.daypart || opts.dormantDays) ? [] : ids(6).map(id => scored(id)));
    getDiscoveryGate.mockResolvedValue({ ok: false, have: 0, need: 30 });

    const out = await refreshDueMixes({ budgetMs: 5000 });
    expect(out.users).toBe(1);
    expect(stored.some(s => s.mixKey === 'on-repeat')).toBe(true);
    expect(out.generated).toBeGreaterThanOrEqual(1);
  });

  it('skips editions that already exist', async () => {
    editions = [{ mixKey: 'on-repeat', editionKey: localDateKey(0), payload: { tracks: [], meta: { tz: 0 } } }];
    await refreshDueMixes({ budgetMs: 5000 });
    expect(stored.find(s => s.mixKey === 'on-repeat')).toBeUndefined();
  });
});
