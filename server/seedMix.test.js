import { describe, it, expect, vi, beforeEach } from 'vitest';

// The seed-mix builder, driven through getSeedMix with everything around it
// mocked EXCEPT capPerArtist (the real diversity cap is part of the contract).

vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));
vi.mock('./config.js', () => ({
  CATALOG_API_BASE: 'x', CATALOG_USER_AGENT: 'x', CATALOG_API_VERSION: '4',
  CATALOG_M_STATION_CREATE: '', CATALOG_M_STATION_SONGS: '', CATALOG_CTX_STATION: '',
}));
vi.mock('./catalog.js', () => ({
  searchSongs: vi.fn(), decodeEntities: x => x, decryptMediaUrl: x => x,
  pickImageUrl: () => null, UPSTREAM_TIMEOUT_MS: 1000,
}));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn(), getTrackById: vi.fn() }));
vi.mock('./tasteScore.js', () => ({
  getSuppressedTrackIds: vi.fn(),
  localDateKey: () => '2026-08-17',
  clampTzOffset: n => n,
}));
vi.mock('./stats.js', () => ({ mapTrackRow: r => r }));
vi.mock('./related.js', async importOriginal => ({
  ...(await importOriginal()),
  getRelatedTracks: vi.fn(),
}));
vi.mock('./autoPlaylists.js', () => ({
  loadEdition: vi.fn(),
  storeEdition: vi.fn(),
  // A functional stand-in: suppression-filter + row-shape, like the real one.
  hydrate: vi.fn(async (payloadTracks, suppressed) =>
    payloadTracks
      .filter(t => !suppressed.has(t.trackId))
      .map(t => ({ id: t.trackId, title: `T ${t.trackId}`, reason: t.reason }))),
  descriptor: (mixKey, name, description, tracks) =>
    ({ id: `auto:${mixKey}`, kind: 'auto', mixKey, name, description, tracks, trackCount: tracks.length }),
}));

import { pool } from './db.js';
import { getTrackById } from './tracks.js';
import { getRelatedTracks } from './related.js';
import { getSuppressedTrackIds } from './tasteScore.js';
import { loadEdition, storeEdition } from './autoPlaylists.js';
import { getSeedMix } from './seedMix.js';

const t = (id, artist = `art-${id}`) => ({ id, title: `Song ${id}`, artist, language: 'ta' });

beforeEach(() => {
  vi.clearAllMocks();
  getSuppressedTrackIds.mockResolvedValue(new Set());
  loadEdition.mockResolvedValue(null);
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  getTrackById.mockResolvedValue(t('seed', 'seed-artist'));
});

describe('getSeedMix', () => {
  it('builds seed-first, hop-1 then interleaved hop-2, with honest reasons', async () => {
    getRelatedTracks
      .mockResolvedValueOnce([t('a'), t('b'), t('c'), t('d')])       // seed station
      .mockResolvedValueOnce([t('a1'), t('a2')])                     // hop2 via a
      .mockResolvedValueOnce([t('b1')])                              // hop2 via b
      .mockResolvedValueOnce([t('c1')]);                             // hop2 via c
    const mix = await getSeedMix('u1', 'seed');

    expect(mix.name).toBe('radio from Song seed');
    const ids = mix.tracks.map(x => x.id);
    expect(ids[0]).toBe('seed');
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'a1', 'b1', 'c1', 'a2']));
    const stored = storeEdition.mock.calls[0];
    expect(stored[1]).toBe('seed:seed');
    expect(stored[2]).toBe('2026-08-17');
    const reasons = new Map(stored[3].tracks.map(x => [x.trackId, x.reason]));
    expect(reasons.get('a')).toBe('close to Song seed');
    expect(reasons.get('b1')).toBe('via Song b');
  });

  it('bounds the fan-out: one seed station plus at most three second-hop stations', async () => {
    getRelatedTracks.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => t(`x${i}`)),
    );
    await getSeedMix('u1', 'seed');
    expect(getRelatedTracks).toHaveBeenCalledTimes(1 + 3);
  });

  it('never serves a suppressed track and caps any artist at two slots', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['hidden1']));
    getRelatedTracks
      .mockResolvedValueOnce([
        t('hidden1'), t('k1', 'same'), t('k2', 'same'), t('k3', 'same'), t('ok'),
      ])
      .mockResolvedValue([]);
    const mix = await getSeedMix('u1', 'seed');
    const ids = mix.tracks.map(x => x.id);
    expect(ids).not.toContain('hidden1');
    expect(ids.filter(id => id.startsWith('k'))).toHaveLength(2);
  });

  it('serves the same-day edition without rebuilding', async () => {
    loadEdition.mockResolvedValue({
      payload: { tracks: Array.from({ length: 10 }, (_, i) => ({ trackId: `e${i}`, reason: 'r' })) },
    });
    const mix = await getSeedMix('u1', 'seed');
    expect(getRelatedTracks).not.toHaveBeenCalled();
    expect(storeEdition).not.toHaveBeenCalled();
    expect(mix.tracks).toHaveLength(10);
  });

  it('rebuilds when suppression starves a cached edition below radio size', async () => {
    const sup = new Set(Array.from({ length: 9 }, (_, i) => `e${i}`));
    getSuppressedTrackIds.mockResolvedValue(sup);
    loadEdition.mockResolvedValue({
      payload: { tracks: Array.from({ length: 10 }, (_, i) => ({ trackId: `e${i}`, reason: 'r' })) },
    });
    getRelatedTracks.mockResolvedValue([t('fresh1'), t('fresh2')]);
    const mix = await getSeedMix('u1', 'seed');
    expect(getRelatedTracks).toHaveBeenCalled();
    expect(mix.tracks.map(x => x.id)).toContain('fresh1');
  });

  it('lets an unknown seed 404 through untouched', async () => {
    const err = Object.assign(new Error('track not found: nope'), { statusCode: 404 });
    getTrackById.mockRejectedValue(err);
    await expect(getSeedMix('u1', 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('folds the similarity graph\'s memory in behind the live stations', async () => {
    getRelatedTracks.mockResolvedValueOnce([t('a')]).mockResolvedValue([]);
    pool.query.mockImplementation(sql => {
      if (/FROM track_similarity/.test(sql)) {
        return Promise.resolve({ rows: [{ related_track_id: 'mem1' }], rowCount: 1 });
      }
      if (/FROM tracks WHERE id = ANY/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'mem1', title: 'Song mem1', artist: 'm' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const mix = await getSeedMix('u1', 'seed');
    const stored = storeEdition.mock.calls[0][3];
    const mem = stored.tracks.find(x => x.trackId === 'mem1');
    expect(mem?.reason).toBe('from earlier radio');
    expect(mix.tracks.map(x => x.id)).toContain('mem1');
  });
});
