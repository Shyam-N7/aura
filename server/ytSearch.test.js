import { describe, it, expect, vi } from 'vitest';
import { searchQueries, findCandidates, MAX_SEARCHES_PER_ITEM } from './ytSearch.js';

// No mocking needed: findCandidates takes its search function by injection,
// which is the whole reason it does. The catalog is never reached from here.

const reading = (title, artists = [], durationSec = 200) => ({
  title, artists, durationSec, source: 'art_track', versions: [], movie: null,
});

describe('searchQueries', () => {
  it('asks title+artist first, then bare title', () => {
    expect(searchQueries(reading('Tum Hi Ho', ['Arijit Singh'])))
      .toEqual(['Tum Hi Ho Arijit Singh', 'Tum Hi Ho']);
  });

  it('collapses to one query when there is no artist', () => {
    // Both forms would be the same string; paying twice for it is the cheapest
    // waste in the pipeline to avoid.
    expect(searchQueries(reading('Kesariya'))).toEqual(['Kesariya']);
  });

  it('drops a generic label from the artist slot', () => {
    // parseVideoVariants emits a swapped reading of "A - B", so a decoration
    // word can land in the artist slot. isGenericTitle is the shared list of
    // phrases that are never a name; carrying one into the query drags the
    // search away from the song. ("Topic" is deliberately NOT on that list —
    // topicChannelArtist strips that suffix before it can reach here.)
    expect(searchQueries(reading('Chaleya', ['Official Video']))).toEqual(['Chaleya']);
    expect(searchQueries(reading('Chaleya', ['']))).toEqual(['Chaleya']);
  });

  it('skips past a generic artist to a real one', () => {
    expect(searchQueries(reading('Chaleya', ['Video', 'Arijit Singh'])))
      .toEqual(['Chaleya Arijit Singh', 'Chaleya']);
  });

  it('returns nothing for an empty title', () => {
    expect(searchQueries(reading(''))).toEqual([]);
    expect(searchQueries(null)).toEqual([]);
  });
});

describe('findCandidates', () => {
  it('stops after the first query that returns anything', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'a', title: 'Tum Hi Ho' }]);
    const { candidates, searches } = await findCandidates(reading('Tum Hi Ho', ['Arijit Singh']), { search });
    expect(searches).toBe(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveLength(1);
  });

  it('falls back to the bare title when the artist query is empty', async () => {
    // A channel name mistaken for a performer actively suppresses the right
    // result, so the second query is not redundancy — it is the recovery.
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'b', title: 'Chaleya' }]);
    const { candidates, searches } = await findCandidates(reading('Chaleya', ['Some Uploader']), { search });
    expect(searches).toBe(2);
    expect(candidates.map(c => c.id)).toEqual(['b']);
  });

  it('never exceeds the per-item search cap across both readings', async () => {
    // "A - B" yields two readings. Left uncapped this is 2 readings x 2 queries
    // = 4 searches per video, which is what would break catalog load.
    const search = vi.fn().mockResolvedValue([]);
    const readings = [reading('Kesariya', ['Arijit Singh']), reading('Arijit Singh', ['Kesariya'])];
    const { searches } = await findCandidates(readings, { search });
    expect(searches).toBeLessThanOrEqual(MAX_SEARCHES_PER_ITEM);
    expect(search).toHaveBeenCalledTimes(MAX_SEARCHES_PER_ITEM);
  });

  it('de-dupes candidates across queries and keeps first-seen order', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'x' }, { id: 'y' }, { id: 'x' }]);
    const { candidates } = await findCandidates(reading('Song', ['Artist']), { search });
    expect(candidates.map(c => c.id)).toEqual(['x', 'y']);
  });

  it('survives a search that throws, and says so', async () => {
    // One failed search degrades the item to review/unmatched — it must never
    // fail the whole import. But it must not be silent either: a systematic
    // upstream break otherwise looks exactly like "we don't have these songs".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi.fn().mockRejectedValue(new Error('catalog 502'));
    const { candidates, searches } = await findCandidates(reading('Song', ['Artist']), { search });
    expect(candidates).toEqual([]);
    expect(searches).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores results with no id', async () => {
    const search = vi.fn().mockResolvedValue([{ title: 'no id' }, { id: 'ok' }]);
    const { candidates } = await findCandidates(reading('Song'), { search });
    expect(candidates.map(c => c.id)).toEqual(['ok']);
  });
});
