import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.js and config.js are mocked for the same reason importJobs.test.js mocks
// them: importing the module must not require a live Postgres or a real key.
vi.mock('./db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('./config.js', () => ({
  YOUTUBE_API_KEY: 'test-key', YT_IMPORT_DAILY_CAP: 200, YT_IMPORT_USER_DAILY: 5,
}));

// Naming an imported playlist.
//
// YouTube names a mix after the video you started it from, so its title arrives
// as "Mix - <that video's full title>" — and a label's video title is a credit
// block, not a name. The first live import produced a 103-character name that
// was mostly cast list. These pin the shape of the fix.

// Mocked outright rather than partially: the real tracks.js imports catalog.js,
// which reads a dozen CATALOG_* env vars at module scope.
// importJobs now imports searchSongs statically (injected once per drain
// instead of a per-item dynamic import) — keep the real catalog out of this
// suite's module graph.
vi.mock('./catalog.js', () => ({ searchSongs: vi.fn() }));
vi.mock('./tracks.js', () => ({ getTrackById: vi.fn(), cacheTracks: vi.fn() }));

import { getTrackById } from './tracks.js';
import { playlistNameFor } from './importJobs.js';

beforeEach(() => vi.clearAllMocks());

const REAL = 'Mix - Master - Andha Kanna Paathaakaa Lyric | Thalapathy Vijay | Anirudh Ravichander | Lokesh Kanagaraj';

describe('a windowed mix', () => {
  it('is named from the catalogue title of the first matched song', async () => {
    // The catalogue's title is canonical, short, and already verified to exist
    // — strictly better than anything parsed out of the YouTube string.
    getTrackById.mockResolvedValue({ id: 'cPaxWwvA', title: 'Andha Kanna Paathaakaa' });
    expect(await playlistNameFor({ title: REAL, windowed: true, seedTrackId: 'cPaxWwvA' }))
      .toBe('Mix - Andha Kanna Paathaakaa');
  });

  it('replaces the real 103-character name from the first live import', async () => {
    getTrackById.mockResolvedValue({ id: 't', title: 'Andha Kanna Paathaakaa' });
    const name = await playlistNameFor({ title: REAL, windowed: true, seedTrackId: 't' });
    expect(REAL.length).toBeGreaterThan(100);
    expect(name.length).toBeLessThan(35);
    expect(name).not.toMatch(/Thalapathy|Lokesh|Lyric/);
  });

  it('falls back to parsing when the first video did not auto-match', async () => {
    // No seed track: nothing matched well enough. Parsing still strips the
    // cast list and the decoration, which is most of the problem.
    expect(await playlistNameFor({ title: REAL, windowed: true, seedTrackId: null }))
      .toBe('Mix - Andha Kanna Paathaakaa');
  });

  it('falls back to parsing when the track lookup fails', async () => {
    getTrackById.mockRejectedValue(new Error('db down'));
    const name = await playlistNameFor({ title: REAL, windowed: true, seedTrackId: 't' });
    expect(name).toBe('Mix - Andha Kanna Paathaakaa');
  });

  it('never exceeds a readable length', async () => {
    getTrackById.mockResolvedValue({ id: 't', title: 'x'.repeat(300) });
    expect((await playlistNameFor({ title: REAL, windowed: true, seedTrackId: 't' })).length)
      .toBeLessThanOrEqual(60);
  });

  it('survives a job with no title at all', async () => {
    expect(await playlistNameFor({ title: null, windowed: true, seedTrackId: null }))
      .toBe('Imported from YouTube');
  });
});

describe('a finite playlist', () => {
  it('keeps the name a human gave it, untouched', async () => {
    // Not ours to improve. Someone named this one.
    const name = 'road trip 2024 🚗';
    expect(await playlistNameFor({ title: name, windowed: false, seedTrackId: 't' })).toBe(name);
    expect(getTrackById).not.toHaveBeenCalled();
  });

  it('does not strip a legitimate "Mix" in a human name', async () => {
    expect(await playlistNameFor({ title: 'Wedding Mix - Final', windowed: false }))
      .toBe('Wedding Mix - Final');
  });
});
