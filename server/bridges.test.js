import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchSongs, dedupeSongs } from './catalog.js';
import { generateBridgePlan } from './prompts/bridge.js';
import { buildTalkContext, getLangAffinity } from './context.js';
import { inferIfStale } from './mood.js';
import { cacheTracks } from './tracks.js';
import { pool } from './db.js';
import { suggestJourney, getBridgeTracks } from './bridges.js';

vi.mock('./catalog.js', () => ({ searchSongs: vi.fn(), dedupeSongs: vi.fn() }));
vi.mock('./context.js', () => ({ buildTalkContext: vi.fn(), getLangAffinity: vi.fn() }));
vi.mock('./mood.js', () => ({ inferIfStale: vi.fn() }));
vi.mock('./tracks.js', () => ({ cacheTracks: vi.fn() }));
vi.mock('./db.js', () => ({ pool: { query: vi.fn() } }));
// Keep sanitizePlan + STAGE_LABELS real — only the LLM call is stubbed.
vi.mock('./prompts/bridge.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateBridgePlan: vi.fn(),
}));

const realDedupe = (tracks) => {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t) continue;
    const key = `${(t.title ?? '').toLowerCase()}|${(t.artist ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
};

const track = (id) => ({
  id, title: `title-${id}`, artist: `artist-${id}`, streamUrl: `https://cdn/${id}.mp4`,
});

const fivePlan = {
  narrative: 'a slow walk from where you are to somewhere brighter, five songs long.',
  steps: [
    { query: 'q1', language: 'tamil', label: 'settling' },
    { query: 'q2', language: 'tamil', label: 'softening' },
    { query: 'q3', language: 'tamil', label: 'turning' },
    { query: 'q4', language: 'tamil', label: 'lifting' },
    { query: 'q5', language: 'tamil', label: 'landing' },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  buildTalkContext.mockResolvedValue({ recentListens: [], likedSample: [], langAffinity: [] });
  getLangAffinity.mockResolvedValue([]);
  inferIfStale.mockResolvedValue(null);
  cacheTracks.mockResolvedValue(undefined);
  pool.query.mockResolvedValue({ rows: [] });
  dedupeSongs.mockImplementation(realDedupe);
});

// Real slot boundaries from prompts/greeting.js timeOfDayFromHour:
// <5 late-night, <11 morning, <15 afternoon, <18 late-afternoon,
// <22 evening, ≥22 late-evening. Evening-ish = evening/late-evening;
// late = late-evening/late-night.
describe('suggestJourney', () => {
  it('maps restless/steady at 20h (evening) to restless → focused', () => {
    expect(suggestJourney({ mood: 'restless', confidence: 0.8, drift: 'steady', hour: 20 }))
      .toEqual({ from: 'restless', to: 'focused' });
  });

  it('cooling drift steps one notch down the ladder: restless lands on calm', () => {
    expect(suggestJourney({ mood: 'restless', confidence: 0.8, drift: 'cooling', hour: 20 }))
      .toEqual({ from: 'restless', to: 'calm' });
  });

  it('upbeat/steady at 19h (evening slot) points at social', () => {
    expect(suggestJourney({ mood: 'upbeat', confidence: 0.8, drift: 'steady', hour: 19 }))
      .toEqual({ from: 'tired', to: 'social' });
  });

  it('upbeat/steady at 9h (morning) stays energized', () => {
    expect(suggestJourney({ mood: 'upbeat', confidence: 0.8, drift: 'steady', hour: 9 }))
      .toEqual({ from: 'tired', to: 'energized' });
  });

  it('warm maps to lonely → happy', () => {
    expect(suggestJourney({ mood: 'warm', confidence: 0.8, drift: 'steady', hour: 20 }))
      .toEqual({ from: 'lonely', to: 'happy' });
  });

  it('social/warming at 23h (late-evening) clamps to focused', () => {
    expect(suggestJourney({ mood: 'social', confidence: 0.9, drift: 'warming', hour: 23 }))
      .toEqual({ from: 'restless', to: 'focused' });
  });

  it('returns null on low confidence or an unknown/missing mood', () => {
    expect(suggestJourney({ mood: 'restless', confidence: 0.3, drift: 'steady', hour: 20 })).toBeNull();
    expect(suggestJourney({ mood: 'gleeful', confidence: 0.9 })).toBeNull();
    expect(suggestJourney({ confidence: 0.9 })).toBeNull();
  });
});

describe('getBridgeTracks', () => {
  it('rejects unknown moods with a 400', async () => {
    await expect(getBridgeTracks({ userId: 'u-400', from: 'sad', to: 'gleeful' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'unknown mood' });
  });

  it('assembles the planned steps in order, attaching labels and deduping by id', async () => {
    generateBridgePlan.mockResolvedValue(fivePlan);
    // Constrained rungs get the language word prepended to bias the catalog's
    // text search (the lang option is only a post-filter on its results).
    searchSongs.mockImplementation(async (q) => ({
      'tamil q1': [track('A')],
      'tamil q2': [track('A'), track('B')], // A already used by step 1 → must pick B
      'tamil q3': [track('C')],
      'tamil q4': [track('D')],
      'tamil q5': [track('E')],
    }[q] ?? []));

    const out = await getBridgeTracks({ userId: 'u-happy', from: 'sad', to: 'happy', steps: 5, langs: ['tamil'] });

    expect(out.narrative).toBe(fivePlan.narrative);
    expect(out.tracks.map(t => t.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(out.tracks.map(t => t.stepLabel))
      .toEqual(['settling', 'softening', 'turning', 'lifting', 'landing']);
    expect(searchSongs).toHaveBeenCalledWith('tamil q1', { limit: 24, lang: 'tamil' });
    expect(cacheTracks).toHaveBeenCalledWith(out.tracks);
  });

  it('keeps explicit language picks as a hard guarantee even when the plan strays', async () => {
    // The model disobeys on two rungs (english/hindi while only tamil is
    // allowed) — sanitize nulls those languages, and the assembler must pin
    // them back onto the pick rather than searching unfiltered. This is the
    // exact leak the first live smoke test caught.
    generateBridgePlan.mockResolvedValue({
      narrative: 'A bridge that strays.',   // capitalized on purpose → lcFirst
      steps: [
        { query: 'q1', language: 'tamil',   label: 'settling' },
        { query: 'q2', language: 'english', label: 'softening' },
        { query: 'q3', language: 'hindi',   label: 'turning' },
        { query: 'q4', language: 'tamil',   label: 'lifting' },
        { query: 'q5', language: 'tamil',   label: 'landing' },
      ],
    });
    const langsSeen = [];
    searchSongs.mockImplementation(async (q, { lang } = {}) => {
      langsSeen.push(lang);
      return [{ ...track(q), language: lang }];
    });

    const out = await getBridgeTracks({ userId: 'u-guarantee', from: 'sad', to: 'happy', steps: 5, langs: ['tamil'] });

    expect(langsSeen.every(l => l === 'tamil')).toBe(true);
    expect(out.tracks).toHaveLength(5);
    expect(out.tracks.every(t => t.language === 'tamil')).toBe(true);
    expect(out.narrative).toBe('a bridge that strays.');
  });

  it('falls back to the half/half algorithm with a static narrative when the plan fails', async () => {
    generateBridgePlan.mockRejectedValue(new Error('llm down'));
    searchSongs.mockImplementation(async (q) => ({
      'english sad songs':   [track('F1'), track('F2'), track('F3'), track('F4')],
      'english happy songs': [track('H1'), track('H2'), track('H3')],
    }[q] ?? []));

    const out = await getBridgeTracks({ userId: 'u-l2', from: 'sad', to: 'happy', steps: 5, langs: ['english'] });

    expect(out.narrative).toBe('from sad to happy, one step at a time.');
    expect(out.tracks.map(t => t.id)).toEqual(['F1', 'F2', 'F3', 'H1', 'H2']);
    expect(out.tracks.map(t => t.stepLabel))
      .toEqual(['settling', 'softening', 'turning', 'lifting', 'landing']);
    // Language-scoped side queries use the SIMPLE form + bigger page — the
    // catalog's strict text search returns zero rows for the wordy ones.
    expect(searchSongs).toHaveBeenCalledWith('english sad songs', { limit: 24, lang: 'english' });
  });

  it('surfaces a 502 when every catalog search fails', async () => {
    generateBridgePlan.mockRejectedValue(new Error('llm down'));
    searchSongs.mockRejectedValue(new Error('catalog down'));

    await expect(getBridgeTracks({ userId: 'u-502', from: 'sad', to: 'happy', steps: 5, langs: ['tamil'] }))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it('serves the second identical call from the day cache without replanning', async () => {
    generateBridgePlan.mockResolvedValue(fivePlan);
    searchSongs.mockImplementation(async (q) => [track(q)]);

    const args = { userId: 'u-cache', from: 'tired', to: 'calm', steps: 5, langs: ['tamil'] };
    const first  = await getBridgeTracks(args);
    const second = await getBridgeTracks(args);

    expect(generateBridgePlan).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('dedupes concurrent identical calls onto one in-flight plan', async () => {
    generateBridgePlan.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(fivePlan), 20)),
    );
    searchSongs.mockImplementation(async (q) => [track(q)]);

    const args = { userId: 'u-flight', from: 'lonely', to: 'happy', steps: 5, langs: ['tamil'] };
    const [a, b] = await Promise.all([getBridgeTracks(args), getBridgeTracks(args)]);

    expect(generateBridgePlan).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });
});
