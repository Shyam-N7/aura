import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));
vi.mock('./tasteScore.js', async () => {
  const actual = await vi.importActual('./tasteScore.js');
  return {
    ...actual,
    getScoredTracks: vi.fn(),
    getSuppressedTrackIds: vi.fn(async () => new Set()),
  };
});
vi.mock('./stats.js', async () => {
  const actual = await vi.importActual('./stats.js');
  return { ...actual, getTopArtists: vi.fn(), getMostPlayed: vi.fn() };
});
vi.mock('./featured.js', () => ({
  // Deterministic "daily" pick: just take the first, so the test is stable.
  pickDaily: (rows, n) => rows.slice(0, n),
}));
// Pure cap so the real related.js (which loads catalog/config at import) stays out.
vi.mock('./related.js', () => ({
  capPerArtist: (tracks, max) => {
    const seen = Object.create(null);
    return tracks.filter(t => {
      seen[t.artist] = (seen[t.artist] ?? 0) + 1;
      return seen[t.artist] <= max;
    });
  },
}));

import { pool } from './db.js';
import { getScoredTracks, getSuppressedTrackIds } from './tasteScore.js';
import { getTopArtists, getMostPlayed } from './stats.js';
import { getPersonalHero, getStations, getNewForYou } from './homeReco.js';

const track = (id, over = {}) => ({
  id,
  title: `T${id}`,
  artist: `A${id}`,
  album: null,
  language: 'tamil',
  duration_sec: 200,
  stream_url: `s${id}`,
  raw: { imageUrl: `img${id}` },
  plays: 3,
  completions: 1,
  liked: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSuppressedTrackIds.mockResolvedValue(new Set());
});

describe('getPersonalHero', () => {
  it('returns null below the history floor (client keeps the featured fallback)', async () => {
    getScoredTracks.mockResolvedValue([track('a'), track('b')]); // < 3
    expect(await getPersonalHero('u1', {})).toBeNull();
  });

  it('picks from the top tracks and ships a receipt', async () => {
    getScoredTracks.mockResolvedValue([
      track('a', { completions: 3 }),
      track('b'),
      track('c'),
    ]);
    const hero = await getPersonalHero('u1', {});
    expect(hero.track.id).toBe('a');
    expect(hero.track.imageUrl).toBe('imga'); // mapped to client shape
    expect(hero.reason).toBe('you finished this 3× lately');
  });

  it('drops suppressed (skip-shelved/hidden) tracks from the hero pool', async () => {
    getScoredTracks.mockResolvedValue([track('a'), track('b'), track('c'), track('d')]);
    getSuppressedTrackIds.mockResolvedValue(new Set(['a', 'b']));
    // Only c, d survive → still >= floor? floor is 3, so 2 left → null.
    expect(await getPersonalHero('u1', {})).toBeNull();
  });
});

describe('getStations', () => {
  it('seeds one station per distinct top artist with a receipt', async () => {
    getTopArtists.mockResolvedValue([
      { artist: 'Anirudh', sampleTrack: { id: 't1', title: 'X', language: 'tamil', imageUrl: 'i1' } },
      { artist: 'Rahman', sampleTrack: { id: 't2', title: 'Y', language: 'tamil', imageUrl: 'i2' } },
    ]);
    const out = await getStations('u1');
    expect(out.stations).toHaveLength(2);
    expect(out.stations[0]).toMatchObject({ seedId: 't1', artist: 'Anirudh', reason: 'radio from Anirudh' });
  });

  it('returns null when there is nothing to seed from', async () => {
    getTopArtists.mockResolvedValue([]);
    getMostPlayed.mockResolvedValue([]);
    expect(await getStations('u1')).toBeNull();
  });
});

describe('getNewForYou', () => {
  it('returns null when the user has no seed tracks', async () => {
    getScoredTracks.mockResolvedValue([]);
    expect(await getNewForYou('u1', {})).toBeNull();
  });

  it('hydrates unheard graph neighbours, capped per artist', async () => {
    getScoredTracks.mockResolvedValue([track('seed1'), track('seed2')]);
    pool.query.mockResolvedValue({
      rows: [track('n1', { artist: 'Z' }), track('n2', { artist: 'Z' }), track('n3', { artist: 'W' })],
    });
    const out = await getNewForYou('u1', { limit: 8 });
    // capPerArtist(_, 1) keeps one per artist → Z once, W once.
    expect(out.tracks.map(t => t.id)).toEqual(['n1', 'n3']);
    expect(out.tracks[0].imageUrl).toBe('imgn1');
  });
});
