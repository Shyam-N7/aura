import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the providers + catalog + romanizer so getLyricsForTrack's fallback
// ordering can be tested without any network or config load. needsRomanization
// returns false so enrichWithEnglish is a no-op (has_english: false).
vi.mock('./lyricsProviders/index.js', () => ({ getSyncedLyrics: vi.fn() }));
vi.mock('./catalog.js', () => ({ getPlainLyrics: vi.fn() }));
vi.mock('./prompts/romanize.js', () => ({ needsRomanization: () => false, romanizeLines: vi.fn() }));

import { getSyncedLyrics } from './lyricsProviders/index.js';
import { getPlainLyrics } from './catalog.js';
import { getLyricsForTrack } from './lyrics.js';

const TRACK = { trackId: 'abc', title: 'T', artist: 'A', durationSec: 200, language: 'kannada' };

describe('getLyricsForTrack — synced → plain → generation ordering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns synced lyrics when a provider has them, without touching plain', async () => {
    getSyncedLyrics.mockResolvedValue({ lines: [{ t: 0, line: 'a' }], source: 'lrc' });
    const r = await getLyricsForTrack(TRACK);
    expect(r).toMatchObject({ available: true, synced: true, source: 'lrc' });
    expect(getPlainLyrics).not.toHaveBeenCalled();
  });

  it('falls back to catalog plain lyrics when no synced match exists', async () => {
    getSyncedLyrics.mockResolvedValue(null);
    getPlainLyrics.mockResolvedValue({ lines: [{ line: 'hello' }], source: 'jiosaavn' });
    const r = await getLyricsForTrack(TRACK);
    expect(r).toMatchObject({ available: true, synced: false, source: 'jiosaavn' });
    expect(r.lines).toEqual([{ line: 'hello' }]);
    expect(getPlainLyrics).toHaveBeenCalledWith('abc');
  });

  it('reports needs_generation when neither synced nor plain lyrics exist', async () => {
    getSyncedLyrics.mockResolvedValue(null);
    getPlainLyrics.mockResolvedValue(null);
    const r = await getLyricsForTrack(TRACK);
    expect(r).toMatchObject({ available: false, synced: false, needs_generation: true });
  });

  it('treats a plain-lyrics fetch error as a miss (needs_generation)', async () => {
    getSyncedLyrics.mockResolvedValue(null);
    getPlainLyrics.mockRejectedValue(new Error('catalog down'));
    const r = await getLyricsForTrack(TRACK);
    expect(r).toMatchObject({ available: false, synced: false, needs_generation: true });
  });
});
