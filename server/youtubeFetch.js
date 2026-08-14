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

const API = 'https://www.googleapis.com/youtube/v3';
const PAGE = 50;

/** Hard ceiling. Above this we refuse rather than burn quota on a mistake. */
export const MAX_ITEMS = 1000;
/** Above this we still import, but the caller should warn. */
export const LARGE_ITEMS = 500;

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

    if (items.length > MAX_ITEMS) {
      throw new YouTubeError(
        'YT_TOO_LARGE',
        `that playlist has over ${MAX_ITEMS} songs — import a smaller one for now`,
        { statusCode: 422 },
      );
    }
  } while (pageToken);

  return { items, units, large: items.length > LARGE_ITEMS };
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
  const { items, units: itemUnits, large } = await fetchPlaylistItems(playlistId, opts);

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
    units: meta.units + itemUnits + videoUnits,
  };
}
