// Parse and classify a pasted YouTube link.
//
// This runs BEFORE any YouTube API call, and that ordering is load-bearing
// rather than an optimisation. Watch Later (WL) and History (HL) are not served
// to third parties, and they do not fail loudly — playlistItems.list returns an
// EMPTY LIST for them. Classify after the call and the user is told "that
// playlist has no songs in it", which is a confusing lie about their own
// library. Classify from the id alone and we can say the true thing.
//
// The other reason to classify first: `RD` is NOT lexically decisive. The split
// is seeded-vs-seedless, not the first two characters. `RDCLAK5uy…` is a
// YouTube Music EDITORIAL mix and the Data API serves it; `RD<videoId>`,
// `RDMM…` and `RDAMVM…` are personal radio and it does not. Testing `RD` before
// `RDCLAK` would misroute every editorial mix into the guided-conversion flow
// and make the feature look far weaker than it is — so prefix order below is
// most-specific-first, and the tests pin it.

/** Playlist kinds we can tell apart. */
export const KIND = {
  USER_PLAYLIST: 'PL', // PL… — ordinary playlist, API-served
  ALBUM: 'OLAK', // OLAK5uy… — auto-generated album, API-served
  EDITORIAL_MIX: 'RDCLAK', // RDCLAK5uy… — YT Music editorial, API-served
  PERSONAL_MIX: 'RD_MIX', // RD…/RDMM…/RDAMVM… — personal radio, NOT served
  CHANNEL_UPLOADS: 'UU', // UU… — a channel's uploads, API-served
  LIKED: 'LL', // LL… — liked videos, OAuth only
  WATCH_LATER: 'WL', // WL — permanently unavailable
  HISTORY: 'HL', // HL — permanently unavailable
};

/** How the fetcher should handle each kind. */
export const STRATEGY = {
  OFFICIAL: 'official_api',
  GUIDED: 'guided_conversion',
  OAUTH: 'oauth_required',
  UNSUPPORTED: 'unsupported',
};

// Most specific prefix first — see the note above about RDCLAK vs RD.
const PREFIXES = [
  ['RDCLAK', KIND.EDITORIAL_MIX, STRATEGY.OFFICIAL],
  ['OLAK5uy', KIND.ALBUM, STRATEGY.OFFICIAL],
  ['RDAMVM', KIND.PERSONAL_MIX, STRATEGY.GUIDED],
  ['RDAMPL', KIND.PERSONAL_MIX, STRATEGY.GUIDED],
  ['RDMM', KIND.PERSONAL_MIX, STRATEGY.GUIDED],
  ['RDAT', KIND.PERSONAL_MIX, STRATEGY.GUIDED],
  ['RD', KIND.PERSONAL_MIX, STRATEGY.GUIDED],
  ['UU', KIND.CHANNEL_UPLOADS, STRATEGY.OFFICIAL],
  ['PL', KIND.USER_PLAYLIST, STRATEGY.OFFICIAL],
  ['LL', KIND.LIKED, STRATEGY.OAUTH],
];

// Exact-match ids, not prefixes: these are singleton system lists.
const EXACT = {
  WL: [KIND.WATCH_LATER, STRATEGY.UNSUPPORTED],
  HL: [KIND.HISTORY, STRATEGY.UNSUPPORTED],
  LM: [KIND.LIKED, STRATEGY.OAUTH], // YT Music "liked music"
};

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

// Ids are URL-safe base64-ish. Deliberately permissive on length: YouTube has
// changed id lengths before, and rejecting a valid link is a worse failure than
// letting the API reject an invalid one.
const ID_SHAPE = /^[A-Za-z0-9_-]{2,128}$/;

/**
 * A rejection carrying a machine-readable code. The code — never the message —
 * is what the client maps to copy, so wording can change without a client
 * release and every case gets its own specific text.
 */
export class LinkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LinkError';
    this.code = code;
    this.statusCode = 422;
    this.expose = true;
  }
}

function normaliseHost(raw) {
  const h = raw.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * Pull the playlist id out of any common YouTube URL shape.
 * Returns null when the link is a YouTube link with no playlist in it.
 */
function extractListId(url) {
  const list = url.searchParams.get('list');
  if (list) return list;

  // music.youtube.com/playlist?list=… is covered above. The /playlist/<id> and
  // /browse/VL<id> shapes appear in some share sheets and Music deep links;
  // VL is a "view list" wrapper around a real playlist id.
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  if (segments[0] === 'playlist' && segments.length === 2) return last;
  if (last.startsWith('VL') && last.length > 2) return last.slice(2);
  return null;
}

/**
 * Classify a playlist id on its own. Exported because refresh and re-import
 * work from a stored id and must not re-parse a URL they no longer have.
 */
export function classifyPlaylistId(id) {
  if (typeof id !== 'string' || !ID_SHAPE.test(id)) {
    throw new LinkError('YT_MALFORMED_ID', 'that playlist id is not valid');
  }
  const exact = EXACT[id];
  if (exact) return { playlistId: id, kind: exact[0], strategy: exact[1] };

  for (const [prefix, kind, strategy] of PREFIXES) {
    if (id.startsWith(prefix)) return { playlistId: id, kind, strategy };
  }
  return {
    playlistId: id,
    kind: null,
    strategy: STRATEGY.UNSUPPORTED,
  };
}

/**
 * Parse a pasted link into { playlistId, kind, strategy, videoId }.
 * Throws LinkError with a specific code for anything unusable — never a
 * generic "invalid link".
 */
export function parseYouTubeLink(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new LinkError('YT_EMPTY', 'paste a YouTube link to get started');
  }

  const raw = input.trim();
  let url;
  try {
    // Tolerate a pasted link with no scheme — a very common share-sheet shape.
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new LinkError('YT_NOT_A_URL', "that doesn't look like a link");
  }

  if (!HOSTS.has(normaliseHost(url.hostname))) {
    throw new LinkError('YT_NOT_YOUTUBE', 'that link is not from YouTube');
  }

  const isShort = normaliseHost(url.hostname) === 'youtu.be';
  const videoId = isShort
    ? url.pathname.split('/').filter(Boolean)[0] ?? null
    : url.searchParams.get('v');

  const listId = extractListId(url);
  if (!listId) {
    // A bare video link is the single most common mistake, and it deserves its
    // own message: the user pasted something real, just not a playlist.
    throw new LinkError(
      videoId ? 'YT_VIDEO_ONLY' : 'YT_NO_PLAYLIST',
      videoId
        ? "that's a single video, not a playlist or mix"
        : "that YouTube link doesn't contain a playlist",
    );
  }

  const classified = classifyPlaylistId(listId);

  if (classified.kind === KIND.WATCH_LATER) {
    throw new LinkError(
      'YT_WATCH_LATER',
      "YouTube doesn't let any app read Watch Later — not even YouTube's own",
    );
  }
  if (classified.kind === KIND.HISTORY) {
    throw new LinkError(
      'YT_HISTORY',
      'YouTube keeps watch history private to YouTube',
    );
  }
  if (classified.kind === null) {
    throw new LinkError(
      'YT_UNKNOWN_KIND',
      "we don't recognise that kind of YouTube playlist",
    );
  }

  return { ...classified, videoId: videoId ?? null };
}
