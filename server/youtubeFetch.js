// YouTube Data API v3 client for playlist import.
//
// Three calls, and the third is not optional:
//   playlists.list      1 unit  — title + itemCount, and the cheap change-check
//   playlistItems.list  1 unit per 50 — video ids, titles, channels
//   videos.list         1 unit per 50 — DURATION and DESCRIPTION
//
// videos.list is mandatory for DURATION, which carries up to 0.28 of the match
// score. Skip it and the matcher silently degrades while still appearing to work.
//
// It is NOT needed for the description, contrary to an earlier note here.
// MEASURED 2026-08-14: playlistItems.list part=snippet returns the full VIDEO
// description, including the "Provided to YouTube by …" Art Track block that
// tier-1 matching reads. We take it from there and treat videos.list as the
// fallback, which also means an item videos.list drops still has its Art Track
// metadata.
//
// Quota: a 100-track import is 1 + 2 + 2 = 5 units against 10,000/day.
// NEVER use search.list here. It costs 100 units — one 100-track playlist would
// consume the entire daily quota. Catalog matching searches JioSaavn, not
// YouTube, and it must stay that way.

import { KIND } from './youtubeUrl.js';

const API = 'https://www.googleapis.com/youtube/v3';
const PAGE = 50;

/** Hard ceiling for a FINITE playlist. Above this we refuse rather than burn
 *  quota on a mistake. */
export const MAX_ITEMS = 1000;
/** Above this we still import, but the caller should warn. */
export const LARGE_ITEMS = 500;

/**
 * How many items to take from RADIO.
 *
 * MEASURED 2026-08-14: an RD mix is effectively INFINITE. A dry run against
 * RDTkRv5-ELOyw paginated past 1000 items and tripped MAX_ITEMS — the cap doing
 * its job, and revealing that "import the mix" is not a well-defined operation
 * the way "import a playlist" is. YouTube keeps generating; the `totalResults`
 * in the response is the page size, never a length.
 *
 * So radio gets a WINDOW, not a ceiling. Reaching it is the expected shape of
 * the source, not an error — stop paginating and return what we have. This also
 * takes an RD import from ~21 quota units (walking to 1000) down to 3.
 *
 * Why 30 and not 50 (the first guess):
 *  - JioSaavn load is the binding constraint, not YouTube quota. 50 tracks is
 *    ~65 catalog searches per import, 30 is ~40. Quota is identical either way
 *    (both fit one page), so the saving is entirely on the constrained side.
 *  - Review burden scales linearly. At the measured ~60% auto rate, 50 tracks
 *    leaves ~20 confirmations; 30 leaves ~12 — a quick check rather than a job.
 *  - Relevance decays with depth. Radio starts at the seed and wanders: the
 *    measured mixes ran Kannada film music at the top and Peppa Pig, Turkish
 *    pop and Sinhala hymns further down. A tighter window is a better playlist,
 *    not merely a cheaper one.
 * 30 over 25 because ~60% auto minus the catalog misses still leaves ~18 usable
 * tracks, which reads as a playlist; 25 can fall under 15, which does not.
 */
export const RADIO_WINDOW = 30;

/**
 * How many items to take, given what kind of thing this is.
 *
 * Radio is infinite and gets a window; a real playlist is finite and gets the
 * ceiling. Callers should not hardcode either — the whole point is that the
 * decision follows from classification, which happens before any API call.
 */
export function windowForKind(kind) {
  return kind === KIND.VIDEO_RADIO || kind === KIND.PERSONAL_MIX
    ? RADIO_WINDOW
    : null;
}

export class YouTubeError extends Error {
  constructor(code, message, { statusCode = 502, expose = true } = {}) {
    super(message);
    this.name = 'YouTubeError';
    this.code = code;
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

/**
 * Private, deleted and region-blocked videos do NOT come back as errors — the
 * item is present with its snippet stripped and a placeholder title. Detecting
 * them by title is unpleasant but it is the only signal the API gives, and the
 * alternative is feeding "Private video" into the matcher as if it were a song.
 */
const UNAVAILABLE_TITLES = new Set([
  'private video',
  'deleted video',
  '[private video]',
  '[deleted video]',
]);

export function isUnavailableItem(snippet) {
  if (!snippet) return true;
  const title = (snippet.title ?? '').trim().toLowerCase();
  if (UNAVAILABLE_TITLES.has(title)) return true;
  // A live item that has lost its owner channel is the other shape this takes.
  return !snippet.videoOwnerChannelId && !snippet.channelId;
}

/** `PT4M28S` → 268. Returns null for anything unparseable. */
export function parseISODuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, d, h, min, s] = m.map(v => (v ? Number(v) : 0));
  const total = d * 86400 + h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * One API call, with the error taxonomy mapped to our own codes.
 *
 * Google's error body is never forwarded to the client — the repo's convention
 * (issue #27, see catalog.js) is that upstream provider bodies stay server-side.
 * We translate to a code and drop the rest.
 */
async function call(path, params, { apiKey, fetchImpl, timeoutMs = 10_000 }) {
  const f = fetchImpl ?? fetch;
  const url = `${API}/${path}?${qs({ ...params, key: apiKey })}`;
  let res;
  try {
    res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new YouTubeError(
      err?.name === 'TimeoutError' ? 'YT_TIMEOUT' : 'YT_UNREACHABLE',
      "we couldn't reach YouTube — try again in a moment",
    );
  }

  if (res.ok) return res.json();

  const body = await res.json().catch(() => ({}));
  const reason = body?.error?.errors?.[0]?.reason ?? '';

  if (res.status === 404 || reason === 'playlistNotFound') {
    throw new YouTubeError(
      'YT_NOT_FOUND',
      "we couldn't find that playlist — it may have been deleted",
      { statusCode: 404 },
    );
  }
  if (reason === 'playlistItemsNotAccessible' || res.status === 403) {
    // 403 covers two very different things, and telling them apart matters:
    // quota exhaustion is ours to fix, a private playlist is the user's.
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new YouTubeError(
        'YT_QUOTA',
        "we've hit YouTube's daily limit — try again tomorrow",
        { statusCode: 503 },
      );
    }
    throw new YouTubeError(
      'YT_PRIVATE',
      'that playlist is private — make it unlisted or public in YouTube, then try again',
      { statusCode: 403 },
    );
  }
  throw new YouTubeError('YT_UPSTREAM', 'YouTube returned an error', {
    statusCode: 502,
    expose: false,
  });
}

/** playlists.list — 1 unit. Title, and itemCount for the cheap change-check. */
export async function fetchPlaylistMeta(playlistId, opts) {
  const data = await call(
    'playlists',
    { part: 'snippet,contentDetails', id: playlistId, maxResults: 1 },
    opts,
  );
  const item = data?.items?.[0];
  if (!item) {
    throw new YouTubeError(
      'YT_NOT_FOUND',
      "we couldn't find that playlist — it may be private or deleted",
      { statusCode: 404 },
    );
  }
  return {
    playlistId,
    title: item.snippet?.title ?? null,
    channelTitle: item.snippet?.channelTitle ?? null,
    itemCount: item.contentDetails?.itemCount ?? null,
    units: 1,
  };
}

/**
 * playlistItems.list — 1 unit per page of 50.
 *
 * Returns every item including unavailable ones, flagged rather than dropped:
 * the caller needs the true total to report "23 of 25", and a silently shorter
 * list would look like a matching failure instead of a source problem.
 */
export async function fetchPlaylistItems(playlistId, opts) {
  const items = [];
  let pageToken;
  let units = 0;
  // A window means "this source has no end, take the first N". A ceiling means
  // "this source is finite but implausibly large, refuse it". Radio needs the
  // first; a real playlist needs the second. Conflating them is what made a
  // dry run burn 20 pages and then fail.
  const window = opts?.maxItems ?? null;

  do {
    const data = await call(
      'playlistItems',
      { part: 'snippet', playlistId, maxResults: PAGE, pageToken },
      opts,
    );
    units++;
    for (const it of data?.items ?? []) {
      const sn = it.snippet ?? {};
      const videoId = sn.resourceId?.videoId ?? null;
      if (!videoId) continue;
      items.push({
        videoId,
        position: sn.position ?? items.length,
        title: sn.title ?? '',
        // videoOwnerChannelTitle is the UPLOADER ("Raghu Dixit - Topic");
        // channelTitle on an auto-generated mix is just "YouTube", which would
        // destroy the Topic-channel artist signal if used as a fallback first.
        channelTitle: sn.videoOwnerChannelTitle ?? null,
        // The full video description arrives here — see the note at the top.
        description: sn.description ?? '',
        unavailable: isUnavailableItem(sn),
      });
    }
    pageToken = data?.nextPageToken;

    // Windowed source: we have enough. Not an error — stop and return.
    if (window !== null && items.length >= window) {
      items.length = window;
      return { items, units, large: false, windowed: true };
    }

    if (items.length > MAX_ITEMS) {
      throw new YouTubeError(
        'YT_TOO_LARGE',
        `that playlist has over ${MAX_ITEMS} songs — import a smaller one for now`,
        { statusCode: 422 },
      );
    }
  } while (pageToken);

  return { items, units, large: items.length > LARGE_ITEMS, windowed: false };
}

/**
 * videos.list — 1 unit per 50 ids. Duration, description, category.
 *
 * Only called for AVAILABLE items: an unavailable one has no duration or
 * description to fetch, and including it would waste a slot in the 50-id batch.
 */
export async function fetchVideoDetails(videoIds, opts) {
  const out = new Map();
  let units = 0;

  for (let i = 0; i < videoIds.length; i += PAGE) {
    const chunk = videoIds.slice(i, i + PAGE);
    const data = await call(
      'videos',
      { part: 'snippet,contentDetails', id: chunk.join(','), maxResults: PAGE },
      opts,
    );
    units++;
    for (const v of data?.items ?? []) {
      const durationSec = parseISODuration(v.contentDetails?.duration);
      out.set(v.id, {
        videoId: v.id,
        title: v.snippet?.title ?? '',
        channelTitle: v.snippet?.channelTitle ?? null,
        description: v.snippet?.description ?? '',
        // categoryId 10 is Music. Anything else is very likely not a song, but
        // it is offered to the user rather than dropped — podcasts and live
        // sets are miscategorised often enough that a hard filter loses real
        // music.
        isMusic: String(v.snippet?.categoryId ?? '') === '10',
        // A live broadcast has no meaningful duration to match on.
        isLive: (v.snippet?.liveBroadcastContent ?? 'none') !== 'none',
        durationSec,
      });
    }
  }

  return { details: out, units };
}

/**
 * The whole read side of an import, with quota accounted.
 * Deliberately does no matching — that is ytMatch's job, and keeping them apart
 * is what lets the matcher be tested without a network.
 */
export async function fetchPlaylistForImport(playlistId, opts) {
  const meta = await fetchPlaylistMeta(playlistId, opts);
  const { items, units: itemUnits, large, windowed } = await fetchPlaylistItems(
    playlistId,
    opts,
  );

  const availableIds = items.filter(i => !i.unavailable).map(i => i.videoId);
  const { details, units: videoUnits } = await fetchVideoDetails(availableIds, opts);

  const videos = items.map(i => {
    const d = details.get(i.videoId);
    return {
      videoId: i.videoId,
      position: i.position,
      title: d?.title ?? i.title,
      // Prefer the playlist item's uploader over videos.list's channelTitle:
      // both are the uploader, but the playlistItem one survives when
      // videos.list drops the video.
      channelTitle: i.channelTitle ?? d?.channelTitle ?? null,
      description: i.description || d?.description || '',
      durationSec: d?.durationSec ?? null,
      unavailable: i.unavailable || !d,
      isMusic: d?.isMusic ?? false,
      isLive: d?.isLive ?? false,
    };
  });

  return {
    meta,
    videos,
    large,
    // The UI must say "we took the first N from this mix" rather than implying
    // it imported the whole thing — there is no whole thing.
    windowed,
    units: meta.units + itemUnits + videoUnits,
  };
}
