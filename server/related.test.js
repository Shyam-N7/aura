import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate getRelatedTracks from config-load, the DB, and the catalog network:
// mock config to plain constants, stub the track store, and replace the catalog
// helpers (search + the field mappers) so only related.js's own station / dedupe /
// cap logic is under test. global.fetch is scripted per test to drive the two-step
// station flow (createEntityStation → getSong).
vi.mock('./config.js', () => ({
  CATALOG_API_BASE: 'https://catalog.test/api',
  CATALOG_USER_AGENT: 'test-agent',
  CATALOG_API_VERSION: '4',
  CATALOG_M_STATION_CREATE: 'webradio.createEntityStation',
  CATALOG_M_STATION_SONGS: 'webradio.getSong',
  CATALOG_CTX_STATION: 'android',
}));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn(), getTrackById: vi.fn() }));
// related.js now persists similarity edges via the pool; stub it so the test
// stays isolated from the DB (db.js throws at import without DATABASE_URL).
vi.mock('./db.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
// The suppressed set (hidden + skip-shelved) comes from the score engine.
vi.mock('./tasteScore.js', () => ({ getSuppressedTrackIds: vi.fn() }));
vi.mock('./catalog.js', () => ({
  searchSongs: vi.fn(),
  decodeEntities: (s) => s,
  decryptMediaUrl: (u) => (u ? `stream:${u}` : null),
  pickImageUrl: (u) => u,
}));

import { searchSongs } from './catalog.js';
import { getTrackById } from './tracks.js';
import { pool } from './db.js';
import { getSuppressedTrackIds } from './tasteScore.js';
import { getRelatedTracks, demoteSkipped } from './related.js';

// A catalog song object in the shape webradio.getSong returns (matches what
// mapRecoSong reads). Distinct ids/titles per call so dedupe/cap are observable.
const makeSong = (id, title, artist, language = 'hindi') => ({
  id,
  title,
  language,
  image: `img-${id}`,
  more_info: {
    album: 'Some Album',
    duration: '210',
    encrypted_media_url: `enc-${id}`,
    artistMap: { primary_artists: [{ id: `ar-${id}`, name: artist }] },
  },
});

// getSong's payload: numeric-keyed { song } slots plus a sibling stationid key.
const stationBody = (songs) => {
  const o = { stationid: 'st-1' };
  songs.forEach((s, i) => { o[String(i)] = { song: s }; });
  return o;
};

// Script fetch: createEntityStation → createBody, getSong → getBody.
const installFetch = (getBody, createBody = { stationid: 'st-1' }) => {
  global.fetch = vi.fn(async (url) => {
    const call = new URL(url).searchParams.get('__call');
    const body = call === 'webradio.createEntityStation' ? createBody : getBody;
    return { ok: true, json: async () => body };
  });
};

describe('getRelatedTracks — song station + dedupe/cap + fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchSongs.mockResolvedValue([]);
  });

  it('parses the getSong payload into ordered, normalised tracks and ignores the stationid key', async () => {
    getTrackById.mockResolvedValue({ id: 'p1', title: 'Seed Song', artist: 'Seed Artist', language: 'hindi' });
    installFetch(stationBody([makeSong('a', 'Alpha', 'Art One'), makeSong('b', 'Beta', 'Art Two')]));

    const out = await getRelatedTracks('p1', { limit: 8 });

    expect(out.map(t => t.id)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({ id: 'a', title: 'Alpha', artist: 'Art One', streamUrl: 'stream:enc-a' });
    expect(searchSongs).not.toHaveBeenCalled();

    // Locks the endpoint contract that was the whole fix: android ctx + a
    // pid-seeded queue station, then getSong against the returned stationid.
    const urls = global.fetch.mock.calls.map(c => new URL(c[0]));
    expect(urls[0].searchParams.get('__call')).toBe('webradio.createEntityStation');
    expect(urls[0].searchParams.get('ctx')).toBe('android');
    expect(urls[0].searchParams.get('entity_type')).toBe('queue');
    expect(JSON.parse(urls[0].searchParams.get('entity_id'))).toEqual(['p1']);
    expect(urls[1].searchParams.get('__call')).toBe('webradio.getSong');
    expect(urls[1].searchParams.get('stationid')).toBe('st-1');
  });

  it('drops the seed song from the station results by title', async () => {
    getTrackById.mockResolvedValue({ id: 'p2', title: 'Alpha', artist: 'X', language: 'hindi' });
    installFetch(stationBody([makeSong('a', 'Alpha', 'Art One'), makeSong('b', 'Beta', 'Art Two')]));

    const out = await getRelatedTracks('p2', { limit: 8 });

    expect(out.map(t => t.id)).toEqual(['b']);
  });

  it('caps the station results at two tracks per artist', async () => {
    getTrackById.mockResolvedValue({ id: 'p3', title: 'Seed', artist: 'X', language: 'hindi' });
    installFetch(stationBody([
      makeSong('a', 'One', 'Solo'), makeSong('b', 'Two', 'Solo'),
      makeSong('c', 'Three', 'Solo'), makeSong('d', 'Four', 'Other'),
    ]));

    const out = await getRelatedTracks('p3', { limit: 8 });

    expect(out.filter(t => t.artist === 'Solo')).toHaveLength(2);
    expect(out.map(t => t.id)).toEqual(['a', 'b', 'd']);
  });

  it('falls back to an artist-seeded same-language search when the station is empty', async () => {
    getTrackById.mockResolvedValue({ id: 'p4', title: 'Seed', artist: 'Pritam', language: 'hindi' });
    installFetch({ stationid: 'st-1' });   // no numeric slots → empty station
    searchSongs.mockResolvedValue([makeSong('f1', 'Fallback One', 'Pritam'), makeSong('f2', 'Fallback Two', 'Other')]);

    const out = await getRelatedTracks('p4', { limit: 8 });

    expect(searchSongs).toHaveBeenCalledWith('Pritam', expect.objectContaining({ lang: 'hindi' }));
    expect(out.map(t => t.id)).toEqual(['f1', 'f2']);
  });

  it('uses a language-radio floor only when an empty-station seed has no artist', async () => {
    getTrackById.mockResolvedValue({ id: 'p5', title: 'Seed', artist: '', language: 'tamil' });
    installFetch({ stationid: 'st-1' });
    searchSongs.mockResolvedValue([makeSong('g1', 'Anything', 'Someone', 'tamil')]);

    const out = await getRelatedTracks('p5', { limit: 8 });

    expect(searchSongs).toHaveBeenCalledWith('tamil songs', expect.objectContaining({ lang: 'tamil' }));
    expect(out.map(t => t.id)).toEqual(['g1']);
  });
});

// The smart-queue pass applied per-user after the shared cache: hidden/shelved
// tracks drop (or sink when the batch would go too thin), frequent skips sink.
describe('demoteSkipped — suppression + skip demotion', () => {
  const list = (idsArr) => idsArr.map(id => ({ id, title: id, artist: `a-${id}` }));
  const skipRows = (map) => Object.entries(map).map(([track_id, n]) => ({ track_id, n }));

  beforeEach(() => {
    vi.clearAllMocks();
    getSuppressedTrackIds.mockResolvedValue(new Set());
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('sinks frequently-skipped tracks, stable within tiers', async () => {
    pool.query.mockResolvedValue({ rows: skipRows({ b: 3, d: 1 }) });
    const out = await demoteSkipped('u1', list(['a', 'b', 'c', 'd', 'e']));
    expect(out.map(t => t.id)).toEqual(['a', 'c', 'e', 'd', 'b']);
  });

  it('drops suppressed tracks outright when enough of the batch survives', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['b']));
    const out = await demoteSkipped('u1', list(['a', 'b', 'c', 'd', 'e', 'f']));
    expect(out.map(t => t.id)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });

  it('sinks suppressed tracks to the back instead of bricking a thin batch', async () => {
    getSuppressedTrackIds.mockResolvedValue(new Set(['a', 'b']));
    const out = await demoteSkipped('u1', list(['a', 'b', 'c', 'd', 'e']));
    expect(out.map(t => t.id)).toEqual(['c', 'd', 'e', 'a', 'b']);
  });

  it('returns the list unchanged on a query error (best-effort contract)', async () => {
    getSuppressedTrackIds.mockRejectedValue(new Error('db down'));
    const tracks = list(['a', 'b', 'c']);
    expect(await demoteSkipped('u1', tracks)).toBe(tracks);
  });
});
