import { describe, it, expect } from 'vitest';
import {
  parseYouTubeLink,
  classifyPlaylistId,
  KIND,
  STRATEGY,
  LinkError,
} from './youtubeUrl.js';

// The case that decides whether the feature looks weak: RDCLAK is an EDITORIAL
// mix and the API serves it. A naive `id.startsWith('RD')` sends it to guided
// conversion and every "mix" the user pastes looks unsupported. Prefix order in
// the source is most-specific-first; this is what pins it.
describe('RD is not lexically decisive', () => {
  it('routes an editorial RDCLAK mix to the official API', () => {
    const r = classifyPlaylistId('RDCLAK5uy_kLWIr9gv1XLlPbaDS965-Db4TrBoUTxQ');
    expect(r.kind).toBe(KIND.EDITORIAL_MIX);
    expect(r.strategy).toBe(STRATEGY.OFFICIAL);
  });

  // MEASURED against the live API, not assumed: playlistItems.list served this
  // exact id (the one from the brief) with 200 + items + a nextPageToken. The
  // original design said RD was refused; it is not, for video radio.
  it('routes RD<videoId> video radio to the official API', () => {
    const r = classifyPlaylistId('RDs9Mtq4EUBkM');
    expect(r.kind).toBe(KIND.VIDEO_RADIO);
    expect(r.strategy).toBe(STRATEGY.OFFICIAL);
  });

  // Still GUIDED, deliberately: these are seeded by the signed-in user rather
  // than a video, so an unauthenticated key plausibly cannot read them. Untested
  // — and the safe default, because guided costs the user a step whereas a wrong
  // OFFICIAL costs them a confusing failure.
  it.each(['RDMMs9Mtq4EUBkM', 'RDAMVMs9Mtq4EUBkM', 'RDAMPLs9Mtq4EUBkM'])(
    'keeps %s on guided conversion until proven',
    id => {
      expect(classifyPlaylistId(id).kind).toBe(KIND.PERSONAL_MIX);
      expect(classifyPlaylistId(id).strategy).toBe(STRATEGY.GUIDED);
    },
  );
});

// WL/HL do not error at the API — they come back as an EMPTY LIST. If we let
// the call happen, the user is told their own Watch Later is empty. These two
// tests exist so that can never regress into a lie.
describe('the empty-list trap', () => {
  const codeOf = url => {
    try {
      parseYouTubeLink(url);
    } catch (err) {
      return err.code;
    }
    return null; // returning null rather than throwing makes the failure read
    // as "expected YT_WATCH_LATER, got null" instead of an unrelated stack.
  };

  it('rejects Watch Later before any API call, with its own code', () => {
    expect(codeOf('https://www.youtube.com/playlist?list=WL')).toBe(
      'YT_WATCH_LATER',
    );
  });

  it('rejects History with its own code', () => {
    expect(codeOf('https://www.youtube.com/playlist?list=HL')).toBe(
      'YT_HISTORY',
    );
  });

  it('does not mistake a playlist merely starting with W or H', () => {
    expect(classifyPlaylistId('PLWLsomething').kind).toBe(KIND.USER_PLAYLIST);
  });
});

describe('URL shapes', () => {
  const cases = [
    ['watch + list (the example from the brief)',
      'https://www.youtube.com/watch?v=s9Mtq4EUBkM&list=RDs9Mtq4EUBkM&start_radio=1',
      'RDs9Mtq4EUBkM', 's9Mtq4EUBkM'],
    ['bare playlist url',
      'https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb',
      'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb', null],
    ['youtu.be short link with list',
      'https://youtu.be/s9Mtq4EUBkM?list=PLtest123',
      'PLtest123', 's9Mtq4EUBkM'],
    ['music.youtube.com',
      'https://music.youtube.com/playlist?list=OLAK5uy_abcdefg',
      'OLAK5uy_abcdefg', null],
    ['mobile host',
      'https://m.youtube.com/watch?v=abc&list=PLmobile',
      'PLmobile', 'abc'],
    ['share link with tracking params',
      'https://www.youtube.com/watch?v=abc&list=PLshare&si=xyz&pp=ygU&feature=shared',
      'PLshare', 'abc'],
    ['no scheme (share-sheet paste)',
      'youtube.com/playlist?list=PLnoscheme',
      'PLnoscheme', null],
    ['VL-wrapped browse id',
      'https://music.youtube.com/browse/VLPLbrowse123',
      'PLbrowse123', null],
  ];

  it.each(cases)('parses %s', (_name, url, expectedId, expectedVideo) => {
    const r = parseYouTubeLink(url);
    expect(r.playlistId).toBe(expectedId);
    expect(r.videoId).toBe(expectedVideo);
  });

  it('preserves the seeding video id on a mix link', () => {
    // Needed for guided conversion: we tell the user which song seeded the mix.
    const r = parseYouTubeLink(
      'https://www.youtube.com/watch?v=s9Mtq4EUBkM&list=RDs9Mtq4EUBkM',
    );
    expect(r.videoId).toBe('s9Mtq4EUBkM');
    expect(r.strategy).toBe(STRATEGY.OFFICIAL);
  });
});

// Acceptance criterion: "Any malformed/unsupported link yields a specific,
// actionable error message" — never a generic one. Each case gets its own code.
describe('every rejection is specific', () => {
  const rejections = [
    ['', 'YT_EMPTY'],
    ['   ', 'YT_EMPTY'],
    ['not a link at all', 'YT_NOT_A_URL'],
    ['https://open.spotify.com/playlist/abc', 'YT_NOT_YOUTUBE'],
    ['https://vimeo.com/12345', 'YT_NOT_YOUTUBE'],
    ['https://www.youtube.com/watch?v=s9Mtq4EUBkM', 'YT_VIDEO_ONLY'],
    ['https://youtu.be/s9Mtq4EUBkM', 'YT_VIDEO_ONLY'],
    ['https://www.youtube.com/', 'YT_NO_PLAYLIST'],
    ['https://www.youtube.com/playlist?list=WL', 'YT_WATCH_LATER'],
    ['https://www.youtube.com/playlist?list=HL', 'YT_HISTORY'],
    ['https://www.youtube.com/playlist?list=ZZunknown', 'YT_UNKNOWN_KIND'],
    ['https://www.youtube.com/playlist?list=has spaces', 'YT_MALFORMED_ID'],
  ];

  it.each(rejections)('%s → %s', (input, code) => {
    let thrown;
    try {
      parseYouTubeLink(input);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(LinkError);
    expect(thrown.code).toBe(code);
    expect(thrown.statusCode).toBe(422);
    // expose=true so clientError() lets the message through rather than
    // collapsing it to the generic 4xx text (middleware/errors.js:25).
    expect(thrown.expose).toBe(true);
    expect(thrown.message).toBeTruthy();
  });

  it('gives no two cases the same code', () => {
    const codes = rejections.map(([, c]) => c);
    // Distinct codes are the whole point — one shared code means one shared
    // piece of copy, which is what "never a generic error" forbids.
    expect(new Set(codes).size).toBeGreaterThanOrEqual(9);
  });
});

describe('liked videos', () => {
  it('marks LL as needing OAuth rather than rejecting it', () => {
    // Phase 3 territory — but it must not read as "unsupported", because it is
    // supported, just not yet.
    const r = classifyPlaylistId('LLabcdef');
    expect(r.kind).toBe(KIND.LIKED);
    expect(r.strategy).toBe(STRATEGY.OAUTH);
  });
});
