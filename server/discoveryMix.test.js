import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate discovery from the DB, the catalog stack (related.js pulls config env
// at import), the score engine and modes. normalizeTitle/capPerArtist are
// mirrored minimally — their real behavior is pinned in related.test.js.
vi.mock('./db.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./related.js', () => ({
  getRelatedTracks: vi.fn(),
  normalizeTitle: (s) => (s ?? '').replace(/\(from\s+[^)]*\)/giu, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
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
vi.mock('./context.js', () => ({ getLangAffinity: vi.fn() }));
vi.mock('./modes.js', () => ({ effectiveExplicitOff: vi.fn(() => false) }));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn() }));
vi.mock('./tasteScore.js', () => ({
  getScoredTracks: vi.fn(),
  HALF_LIFE_CURRENT_DAYS: 28,
  PROFILE_MODES_EXCLUDED: ['family', 'kids'],
}));

import { pool } from './db.js';
import { getLangAffinity } from './context.js';
import { getRelatedTracks } from './related.js';
import { getScoredTracks } from './tasteScore.js';
import { effectiveExplicitOff } from './modes.js';
import { buildDiscoveryMix, getDiscoveryGate, GATE, DISCOVERY_SIZE } from './discoveryMix.js';

const cand = (id, { title, artist, language = 'tamil', explicit = false } = {}) => ({
  id, title: title ?? `New ${id}`, artist: artist ?? `Artist ${id}`, album: null,
  language, durationSec: 200, streamUrl: `s-${id}`, imageUrl: null, explicit,
});
const seedRow = (id, language = 'tamil') => ({
  id, title: `Seed ${id}`, artist: `SeedArtist ${id}`, language,
  duration_sec: 200, stream_url: `s-${id}`, raw: {}, score: 9, plays: 8, completions: 6,
  last_play_ts: String(Date.now()),
});

// Scripted pool for discovery's internal reads.
let playedIds, playedTitles, likedIds, playlistIds, simEdges, simTrackRows, gateCounts;
function installPool() {
  pool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('COUNT(DISTINCT e.track_id)')) return { rows: [gateCounts] };
    if (sql.includes('SELECT DISTINCT track_id FROM listening_events')) {
      return { rows: playedIds.map(id => ({ track_id: id })) };
    }
    if (sql.includes('SELECT DISTINCT t.title')) return { rows: playedTitles.map(title => ({ title })) };
    if (sql.includes('FROM liked_tracks')) return { rows: likedIds.map(id => ({ track_id: id })) };
    if (sql.includes('FROM playlist_tracks')) return { rows: playlistIds.map(id => ({ track_id: id })) };
    if (sql.includes('SELECT active_mode')) return { rows: [{ active_mode: 'everyday', modes_state: {} }] };
    if (sql.includes('FROM track_similarity')) {
      expect(params[0]).toBeInstanceOf(Array);
      return { rows: simEdges };
    }
    if (sql.includes('FROM tracks WHERE id = ANY')) {
      return { rows: simTrackRows.filter(r => params[0].includes(r.id)) };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  playedIds = []; playedTitles = []; likedIds = []; playlistIds = [];
  simEdges = []; simTrackRows = [];
  gateCounts = { tracks: 50, artists: 10 };
  installPool();
  effectiveExplicitOff.mockReturnValue(false);
  getLangAffinity.mockResolvedValue([{ language: 'tamil', plays: 90, pct: 100 }]);
  getScoredTracks.mockResolvedValue([seedRow('seed1')]);
  getRelatedTracks.mockResolvedValue([]);
});

describe('getDiscoveryGate', () => {
  it('opens only past both thresholds', async () => {
    gateCounts = { tracks: 29, artists: 10 };
    expect((await getDiscoveryGate('u1')).ok).toBe(false);
    gateCounts = { tracks: 30, artists: 4 };
    expect((await getDiscoveryGate('u1')).ok).toBe(false);
    gateCounts = { tracks: 30, artists: 5 };
    const gate = await getDiscoveryGate('u1');
    expect(gate).toEqual({ ok: true, have: 30, need: GATE.tracks });
  });

  it('counts "heard" from profile modes only for the GATE (but never for novelty)', async () => {
    await getDiscoveryGate('u1');
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain(`COALESCE(e.mode, 'everyday')`);   // gate = taste signal
  });
});

describe('buildDiscoveryMix — the novelty guarantee', () => {
  it('excludes anything with ANY play event — including family/kids-mode plays', async () => {
    playedIds = ['known1'];
    getRelatedTracks.mockResolvedValue([cand('known1'), cand('fresh1'), cand('fresh2'),
      cand('fresh3'), cand('fresh4'), cand('fresh5')]);

    const mix = await buildDiscoveryMix('u1');
    const picked = mix.tracks.map(t => t.trackId);
    expect(picked).not.toContain('known1');
    expect(picked).toContain('fresh1');
    // The played-ids read must NOT be mode-filtered: a kids-mode play still
    // counts as "heard".
    const playedSql = pool.query.mock.calls.find(c => c[0].includes('SELECT DISTINCT track_id FROM listening_events'))[0];
    expect(playedSql).not.toContain('mode');
  });

  it('excludes covers/alt-credits of songs the user knows, by normalized title', async () => {
    playedTitles = ['Marandhu Poche (From "Some Movie")'];
    getRelatedTracks.mockResolvedValue([
      cand('cover1', { title: 'Marandhu Poche', artist: 'Cover Singer' }),
      ...[1, 2, 3, 4, 5].map(i => cand(`ok${i}`)),
    ]);

    const mix = await buildDiscoveryMix('u1');
    expect(mix.tracks.map(t => t.trackId)).not.toContain('cover1');
  });

  it('excludes liked, playlisted and explicit-when-clean-mode candidates', async () => {
    likedIds = ['liked1'];
    playlistIds = ['inpl1'];
    effectiveExplicitOff.mockReturnValue(true);
    getRelatedTracks.mockResolvedValue([
      cand('liked1'), cand('inpl1'), cand('expl1', { explicit: true }),
      ...[1, 2, 3, 4, 5].map(i => cand(`ok${i}`)),
    ]);

    const picked = (await buildDiscoveryMix('u1')).tracks.map(t => t.trackId);
    expect(picked).not.toContain('liked1');
    expect(picked).not.toContain('inpl1');
    expect(picked).not.toContain('expl1');
  });
});

describe('buildDiscoveryMix — composition', () => {
  it('fills language quotas proportional to listening shares', async () => {
    getLangAffinity.mockResolvedValue([
      { language: 'tamil', plays: 70, pct: 70 },
      { language: 'hindi', plays: 20, pct: 20 },
      { language: 'english', plays: 10, pct: 10 },
    ]);
    getScoredTracks.mockImplementation(async (u, opts) => [seedRow(`seed-${opts.language}`, opts.language)]);
    getRelatedTracks.mockImplementation(async (seedId) => {
      const lang = seedId.replace('seed-', '');
      return Array.from({ length: 25 }, (_, i) => cand(`${lang}-${i}`, { language: lang }));
    });

    const mix = await buildDiscoveryMix('u1');
    const byLang = (l) => mix.tracks.filter(t => t.trackId.startsWith(`${l}-`)).length;
    expect(mix.tracks).toHaveLength(DISCOVERY_SIZE);
    expect(byLang('tamil')).toBe(21);
    expect(byLang('hindi')).toBe(6);
    expect(byLang('english')).toBe(3);   // min-quota floor
    expect(mix.meta.langShares).toEqual({ tamil: 21, hindi: 6, english: 3 });
  });

  it('drops sub-10% languages from the quota', async () => {
    getLangAffinity.mockResolvedValue([
      { language: 'tamil', plays: 92, pct: 92 },
      { language: 'hindi', plays: 8, pct: 8 },
    ]);
    getScoredTracks.mockImplementation(async (u, opts) => [seedRow(`seed-${opts.language}`, opts.language)]);
    getRelatedTracks.mockResolvedValue(Array.from({ length: 10 }, (_, i) => cand(`t-${i}`)));

    await buildDiscoveryMix('u1');
    const langsAsked = getScoredTracks.mock.calls.map(c => c[1].language);
    expect(langsAsked).toEqual(['tamil']);
  });

  it('holds one-per-artist, relaxing to two only when the pool runs thin', async () => {
    getRelatedTracks.mockResolvedValue([
      cand('a1', { artist: 'Same' }), cand('a2', { artist: 'Same' }), cand('a3', { artist: 'Same' }),
      cand('b1', { artist: 'Other' }),
    ]);
    const mix = await buildDiscoveryMix('u1');
    const sameCount = mix.tracks.filter(t => ['a1', 'a2', 'a3'].includes(t.trackId)).length;
    expect(sameCount).toBe(2);   // relaxed cap, never three
  });

  it('survives a failing seed and builds from the rest', async () => {
    getScoredTracks.mockResolvedValue([seedRow('seedA'), seedRow('seedB')]);
    getRelatedTracks.mockImplementation(async (seedId) => {
      if (seedId === 'seedA') throw new Error('station down');
      return [1, 2, 3, 4, 5, 6].map(i => cand(`ok${i}`));
    });
    const mix = await buildDiscoveryMix('u1');
    expect(mix.tracks.length).toBeGreaterThanOrEqual(6);
  });

  it('builds from the similarity graph alone when stations are off, with graph receipts', async () => {
    getRelatedTracks.mockResolvedValue([]);   // env-gated station absent
    simEdges = [1, 2, 3, 4, 5, 6].map(i => ({ source_track_id: 'seed1', related_track_id: `g${i}` }));
    simTrackRows = [1, 2, 3, 4, 5, 6].map(i => ({
      id: `g${i}`, title: `Graph ${i}`, artist: `GA ${i}`, album: null, language: 'tamil',
      duration_sec: 200, stream_url: `s-g${i}`, raw: {},
    }));

    const mix = await buildDiscoveryMix('u1');
    expect(mix.tracks).toHaveLength(6);
    expect(mix.tracks[0].reason).toBe('near Seed seed1 in your listening graph');
  });

  it('returns null (honest omission) when there are no seeds at all', async () => {
    getLangAffinity.mockResolvedValue([]);
    getScoredTracks.mockResolvedValue([]);
    expect(await buildDiscoveryMix('u1')).toBeNull();
  });

  it('names the seed in station receipts, with the "(From …)" credit stripped', async () => {
    getScoredTracks.mockResolvedValue([{ ...seedRow('seed1'), title: 'Kanave Kanave (From "David")' }]);
    getRelatedTracks.mockResolvedValue([1, 2, 3, 4, 5].map(i => cand(`ok${i}`)));
    const mix = await buildDiscoveryMix('u1');
    expect(mix.tracks[0].reason).toBe('because you kept playing Kanave Kanave');
  });
});
