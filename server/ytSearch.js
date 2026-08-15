// Turning a parsed YouTube video into catalog candidates.
//
// This module exists to be SHARED. The auto-match rate that shaped this whole
// feature (4% -> 58% over ten measured runs) was produced by a local dry-run
// harness, and the single most dangerous failure mode in that arrangement is the
// harness measuring a code path the server does not take. It has already
// happened once here: a test exercised parseVideo where the real path uses
// parseVideoVariants + matchVideo, so it validated nothing.
//
// So query construction lives here rather than inline in the job engine, and
// both the harness and importJobs.js call findCandidates(). A rate measured
// offline then means something online.

import { tokens, isGenericTitle } from './ytTrackParse.js';
import { titleSimilarity } from './ytMatch.js';

/** Never ask the catalog for more than this per video. Two searches maximum. */
export const MAX_SEARCHES_PER_ITEM = 2;

// How much a returned title must resemble the query before we accept that the
// query was answered and stop. Below this we keep the results but try the next
// reading — see the note at the break.
export const STOP_SIMILARITY = 0.8;

/** How many results to score. Beyond ~20 the tail is noise, and it costs latency. */
export const SEARCH_LIMIT = 20;

/**
 * The search strings to try, in order, for one parsed reading.
 *
 * Deliberately short. The catalog's search is a fuzzy title matcher, not a
 * query language: extra words make it WORSE, not more precise — a query
 * carrying "(Official Video)" or a film name matches nothing and returns the
 * empty set, which is indistinguishable from "we don't have this song" and was
 * a real source of zero-candidate rows early on.
 *
 * Order matters. Title-plus-artist first because it disambiguates the very
 * common same-title case; bare title second because a wrong artist (a channel
 * name mistaken for a performer) actively suppresses the right result.
 */
export function searchQueries(parsed) {
  const title = String(parsed?.title ?? '').trim();
  if (!title) return [];

  // A generic artist ("Topic", "Official", a film name) is worse than none —
  // it drags the query away from the song. isGenericTitle already encodes the
  // list that measurement produced.
  const artist = (parsed?.artists ?? [])
    .map(a => String(a ?? '').trim())
    .find(a => a && !isGenericTitle(a));

  const queries = [];
  if (artist) queries.push(`${title} ${artist}`);
  queries.push(title);

  // De-dupe by normalised tokens: with no usable artist the two forms collapse
  // to the same string, and paying two identical searches per video is the
  // cheapest waste to avoid in the whole pipeline.
  const seen = new Set();
  return queries.filter(q => {
    const key = tokens(q).join(' ');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Candidates for a video, given its parsed reading(s).
 *
 * `parsed` may be a single reading or the ambiguous pair from
 * parseVideoVariants — the queries from every reading are tried, because "A - B"
 * being song-artist or artist-song is exactly the thing we cannot resolve
 * before seeing what the catalog returns.
 *
 * `search` is injected (defaults to catalog.searchSongs) so this is testable
 * without a network and so the dry-run harness can count calls.
 */
export async function findCandidates(parsed, { search, limit = SEARCH_LIMIT } = {}) {
  const searchFn = search ?? (await import('./catalog.js')).searchSongs;
  const readings = Array.isArray(parsed) ? parsed : [parsed];

  // Collect queries across readings, in reading order, de-duped — then cap.
  // The cap is what keeps catalog load linear in tracks rather than in
  // (tracks x readings), which is the binding constraint on this feature.
  const seen = new Set();
  const queries = [];
  for (const reading of readings) {
    for (const q of searchQueries(reading)) {
      const key = tokens(q).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      // The reading's TITLE travels with the query. The stop check compares
      // against the song we are looking for, not the query string — those
      // differ whenever an artist is appended, and comparing a candidate title
      // to "Tum Hi Ho Arijit Singh" scores badly for an exact match. Caught by
      // the existing "stops after the first query" test.
      queries.push({ q, title: reading?.title ?? q });
    }
  }

  const byId = new Map();
  let searches = 0;
  for (const { q, title } of queries.slice(0, MAX_SEARCHES_PER_ITEM)) {
    let results;
    try {
      results = await searchFn(q, { limit });
    } catch (err) {
      // One failed search must not fail the import. The item simply gets fewer
      // candidates and lands in review or unmatched — a degraded result the
      // user can fix, rather than a dead job they cannot.
      //
      // But it must not be SILENT. A systematic upstream change (a response
      // shape we no longer parse, an outage) makes every search throw, and the
      // import then completes with everything 'unmatched' and no signal
      // anywhere that the catalog was the problem rather than the catalog's
      // contents. That is exactly what happened while testing this, and the
      // symptom was indistinguishable from "we don't have these songs".
      console.warn('[yt-import] catalog search failed:', err?.message ?? err);
      continue;
    }
    searches++;
    for (const r of results ?? []) {
      // First sighting wins: results arrive in the catalog's own relevance
      // order, and that order is a real signal (see the ambiguity note in
      // ytMatch.matchVideo) worth preserving across the merge.
      if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
    }
    // Stop early when the first query already answered — but "answered" has to
    // mean a candidate that LOOKS LIKE what we searched for, not merely a
    // candidate.
    //
    // MEASURED, and this was the largest remaining error class: a YouTube title
    // of the shape "Milana | Ninnindale | …" is MOVIE | SONG, the reverse of
    // what the parser assumes, so the first query searches the film name.
    // "Milana" returns a real song called "Milana Milana" — wrong, but present.
    // `byId.size > 0` then broke the loop, and the query for the ACTUAL song
    // never ran. That row reached auto at 0.917 against a song the catalog was
    // never asked about.
    //
    // Anything is better than nothing when nothing is the alternative, so a weak
    // result is still kept and returned; it just no longer PREVENTS the next
    // query — the rival reading — from running. See answersQuery for how a
    // film-name query is told apart from a song one, which similarity alone
    // cannot do.
    if (answersQuery(title, byId)) break;
  }

  return { candidates: [...byId.values()], searches };
}

// Does anything returned actually resemble what we asked for?
//
// titleSimilarity is imported from ytMatch rather than re-implemented here. A
// second similarity function would drift from the one that decides matches, and
// then this gate would be stopping on a different notion of "good" than the
// scorer uses — the same class of mistake as a harness measuring a path the
// server does not take.
function answersQuery(wantedTitle, byId) {
  if (byId.size === 0) return false;
  for (const c of byId.values()) {
    if (titleSimilarity(wantedTitle, c.title) < STOP_SIMILARITY) continue;
    // The tell that we searched a FILM name rather than a song.
    //
    // Similarity alone cannot see this — "Milana" against "Milana Milana"
    // scores a perfect 1.000. But look at the ALBUM: when the query is a film
    // name, the catalog hands back that film's namesake song, whose album is
    // ALSO the query. When the query is a real song, the album is the film and
    // does not match. MEASURED on the O Sona mix:
    //
    //   Milana  -> title 1.00  album 1.00   (film — the rival must be tried)
    //   O Sona  -> title 1.00  album 0.00   (song — stop here, one search)
    //
    // A self-titled single (Era Istrefi's "Bad", album "Bad") trips this and
    // pays one extra search. Wasted work, never a wrong answer — the right
    // direction to fail in.
    if (c.album && titleSimilarity(wantedTitle, c.album) >= STOP_SIMILARITY) continue;
    return true;
  }
  return false;
}
