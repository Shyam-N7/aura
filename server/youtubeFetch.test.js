import { describe, it, expect } from 'vitest';
import {
  fetchPlaylistForImport,
  fetchPlaylistItems,
  fetchVideoDetails,
  parseISODuration,
  isUnavailableItem,
  YouTubeError,
  MAX_ITEMS,
} from './youtubeFetch.js';

// A fake fetch driven by a queue of responses, so every path below is exercised
// without a network or an API key. Also records the URLs, which is how the
// quota assertions stay honest — counting calls, not trusting a returned number.
function fakeFetch(responses) {
  const calls = [];
  const fn = async url => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra call: ${url}`);
    return {
      ok: next.status === undefined || next.status === 200,
      status: next.status ?? 200,
      json: async () => next.body,
    };
  };
  fn.calls = calls;
  return fn;
}

const opts = f => ({ apiKey: 'test-key', fetchImpl: f });

const plItem = (videoId, title, channel = 'Some Channel', extra = {}) => ({
  snippet: {
    resourceId: { videoId },
    title,
    videoOwnerChannelTitle: channel,
    videoOwnerChannelId: 'UC123',
    position: 0,
    ...extra,
  },
});

const video = (id, { duration = 'PT4M28S', category = '10', desc = '', live = 'none' } = {}) => ({
  id,
  snippet: { title: `t-${id}`, channelTitle: 'c', description: desc, categoryId: category, liveBroadcastContent: live },
  contentDetails: { duration },
});

describe('ISO 8601 durations', () => {
  it.each([
    ['PT4M28S', 268],
    ['PT3M', 180],
    ['PT45S', 45],
    ['PT1H2M3S', 3723],
    ['P1DT1H', 90000],
  ])('parses %s', (iso, want) => expect(parseISODuration(iso)).toBe(want));

  it.each(['', null, 'garbage', 'P0D'])('returns null for %s', v =>
    expect(parseISODuration(v)).toBeNull(),
  );
});

// The whole point of this block: these do NOT arrive as errors. The item is
// present with a stripped snippet and a placeholder title, so without an
// explicit check "Private video" would be fed to the matcher as a song title.
describe('private / deleted videos are detected, not errored', () => {
  it.each(['Private video', 'Deleted video', '[Private video]'])(
    'flags %s',
    title => {
      expect(isUnavailableItem({ title, videoOwnerChannelId: null })).toBe(true);
    },
  );

  it('treats a normal item as available', () => {
    expect(isUnavailableItem({ title: 'Kesariya', videoOwnerChannelId: 'UC1' })).toBe(false);
  });

  it('keeps unavailable items in the list so counts stay truthful', async () => {
    const f = fakeFetch([
      { body: { items: [plItem('a', 'Kesariya'), { snippet: { resourceId: { videoId: 'b' }, title: 'Private video' } }] } },
    ]);
    const r = await fetchPlaylistItems('PLx', opts(f));
    expect(r.items).toHaveLength(2);
    expect(r.items[1].unavailable).toBe(true);
  });
});

describe('pagination and quota', () => {
  it('follows nextPageToken and charges one unit per page', async () => {
    const f = fakeFetch([
      { body: { items: [plItem('a', 'one')], nextPageToken: 'p2' } },
      { body: { items: [plItem('b', 'two')], nextPageToken: 'p3' } },
      { body: { items: [plItem('c', 'three')] } },
    ]);
    const r = await fetchPlaylistItems('PLx', opts(f));
    expect(r.items).toHaveLength(3);
    expect(r.units).toBe(3);
    expect(f.calls[1]).toContain('pageToken=p2');
  });

  it('batches videos.list in 50s', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const f = fakeFetch([
      { body: { items: ids.slice(0, 50).map(i => video(i)) } },
      { body: { items: ids.slice(50, 100).map(i => video(i)) } },
      { body: { items: ids.slice(100).map(i => video(i)) } },
    ]);
    const r = await fetchVideoDetails(ids, opts(f));
    expect(r.units).toBe(3);
    expect(r.details.size).toBe(120);
  });

  // The acceptance number from the design: 1 + 2 + 2 for 100 tracks.
  it('costs 5 units for a 100-track import', async () => {
    const items = Array.from({ length: 50 }, (_, i) => plItem(`v${i}`, `t${i}`));
    const items2 = Array.from({ length: 50 }, (_, i) => plItem(`w${i}`, `t${i}`));
    const f = fakeFetch([
      { body: { items: [{ snippet: { title: 'My Mix' }, contentDetails: { itemCount: 100 } }] } },
      { body: { items, nextPageToken: 'p2' } },
      { body: { items: items2 } },
      { body: { items: Array.from({ length: 50 }, (_, i) => video(`v${i}`)) } },
      { body: { items: Array.from({ length: 50 }, (_, i) => video(`w${i}`)) } },
    ]);
    const r = await fetchPlaylistForImport('PLx', opts(f));
    expect(r.units).toBe(5);
    expect(r.videos).toHaveLength(100);
  });

  it('never calls search.list — it costs 100 units', async () => {
    const f = fakeFetch([
      { body: { items: [{ snippet: { title: 'x' }, contentDetails: { itemCount: 1 } }] } },
      { body: { items: [plItem('a', 'one')] } },
      { body: { items: [video('a')] } },
    ]);
    await fetchPlaylistForImport('PLx', opts(f));
    expect(f.calls.some(u => u.includes('/search'))).toBe(false);
  });

  it('refuses a playlist over the hard cap rather than burning quota', async () => {
    const page = Array.from({ length: 50 }, (_, i) => plItem(`v${i}`, 't'));
    const responses = Array.from({ length: MAX_ITEMS / 50 + 1 }, () => ({
      body: { items: page, nextPageToken: 'more' },
    }));
    const f = fakeFetch(responses);
    await expect(fetchPlaylistItems('PLx', opts(f))).rejects.toMatchObject({
      code: 'YT_TOO_LARGE',
    });
  });
});

describe('error taxonomy', () => {
  const failWith = (status, reason) =>
    fakeFetch([{ status, body: { error: { errors: [{ reason }] } } }]);

  it('maps a missing playlist to YT_NOT_FOUND', async () => {
    await expect(
      fetchPlaylistItems('PLx', opts(failWith(404, 'playlistNotFound'))),
    ).rejects.toMatchObject({ code: 'YT_NOT_FOUND', statusCode: 404 });
  });

  // 403 covers two very different things and conflating them would tell a user
  // to fix their playlist when the real problem is our quota.
  it('separates quota exhaustion from a private playlist', async () => {
    await expect(
      fetchPlaylistItems('PLx', opts(failWith(403, 'quotaExceeded'))),
    ).rejects.toMatchObject({ code: 'YT_QUOTA' });

    await expect(
      fetchPlaylistItems('PLx', opts(failWith(403, 'playlistItemsNotAccessible'))),
    ).rejects.toMatchObject({ code: 'YT_PRIVATE' });
  });

  it('never forwards the upstream body to the client', async () => {
    let thrown;
    try {
      await fetchPlaylistItems('PLx', opts(failWith(500, 'backendError')));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(YouTubeError);
    expect(thrown.expose).toBe(false); // clientError() collapses it
    expect(thrown.message).not.toContain('backendError');
  });
});

describe('video enrichment', () => {
  it('carries duration, description and category through', async () => {
    const f = fakeFetch([
      { body: { items: [{ snippet: { title: 'Mix' }, contentDetails: { itemCount: 1 } }] } },
      { body: { items: [plItem('a', 'Kesariya')] } },
      { body: { items: [video('a', { desc: 'Provided to YouTube by X', duration: 'PT4M28S' })] } },
    ]);
    const r = await fetchPlaylistForImport('PLx', opts(f));
    expect(r.videos[0].durationSec).toBe(268);
    expect(r.videos[0].description).toContain('Provided to YouTube by');
    expect(r.videos[0].isMusic).toBe(true);
  });

  it('flags non-music and live items without dropping them', async () => {
    const f = fakeFetch([
      { body: { items: [{ snippet: { title: 'Mix' }, contentDetails: { itemCount: 2 } }] } },
      { body: { items: [plItem('a', 'podcast'), plItem('b', 'stream')] } },
      { body: { items: [video('a', { category: '22' }), video('b', { live: 'live' })] } },
    ]);
    const r = await fetchPlaylistForImport('PLx', opts(f));
    expect(r.videos[0].isMusic).toBe(false);
    expect(r.videos[1].isLive).toBe(true);
    expect(r.videos).toHaveLength(2);
  });

  it('does not spend a videos.list slot on an unavailable item', async () => {
    const f = fakeFetch([
      { body: { items: [{ snippet: { title: 'Mix' }, contentDetails: { itemCount: 2 } }] } },
      { body: { items: [plItem('a', 'Kesariya'), { snippet: { resourceId: { videoId: 'b' }, title: 'Deleted video' } }] } },
      { body: { items: [video('a')] } },
    ]);
    const r = await fetchPlaylistForImport('PLx', opts(f));
    const videosCall = f.calls.find(u => u.includes('/videos'));
    // Assert on the id PARAMETER, not the raw URL: a substring check for 'b'
    // matches the "b" in "youtube" and passes for the wrong reason.
    const ids = new URL(videosCall).searchParams.get('id').split(',');
    expect(ids).toEqual(['a']);
    expect(r.videos[1].unavailable).toBe(true);
  });
});

// Fixture taken VERBATIM from a live playlistItems.list call on 2026-08-14 for
// playlistId=RDs9Mtq4EUBkM — the exact id from the product brief, which the
// design wrongly assumed the API refuses. Two facts here were assumptions until
// this response arrived, and both were wrong:
//   1. RD video-radio IS served (200, items, nextPageToken).
//   2. The VIDEO description arrives in playlistItems, Art Track block included.
// Locking the shape so a refactor cannot quietly reintroduce either mistake.
describe('measured RD mix response', () => {
  const realItem = {
    snippet: {
      publishedAt: '2021-07-20T02:38:21Z',
      channelId: 'UCBR8-60-B28hp2BmDPdntcQ',
      title: 'Ee Tanuvu Ninnade',
      description:
        'Provided to YouTube by Virgin Music Group\n\nEe Tanuvu Ninnade · Raghu Dixit\n\nPsycho\n\n℗ 2008 Alpha Digitech\n\nReleased on: 2008-06-15',
      channelTitle: 'YouTube',
      playlistId: 'RDs9Mtq4EUBkM',
      position: 0,
      resourceId: { kind: 'youtube#video', videoId: 's9Mtq4EUBkM' },
      videoOwnerChannelTitle: 'Raghu Dixit - Topic',
      videoOwnerChannelId: 'UCj1GW9LiAoZjPa0Jm067zdQ',
    },
  };

  it('carries the Art Track description straight from playlistItems', async () => {
    const f = fakeFetch([{ body: { items: [realItem] } }]);
    const r = await fetchPlaylistItems('RDs9Mtq4EUBkM', opts(f));
    expect(r.items[0].description).toContain('Provided to YouTube by');
    expect(r.items[0].description).toContain('Ee Tanuvu Ninnade · Raghu Dixit');
  });

  // The trap: on an auto-generated mix, snippet.channelTitle is literally
  // "YouTube" — the playlist owner, not the uploader. Falling back to it would
  // wipe out the "- Topic" signal that drives tier-1 artist confidence.
  it('takes the uploader, not the mix owner, as the channel', async () => {
    const f = fakeFetch([{ body: { items: [realItem] } }]);
    const r = await fetchPlaylistItems('RDs9Mtq4EUBkM', opts(f));
    expect(r.items[0].channelTitle).toBe('Raghu Dixit - Topic');
    expect(r.items[0].channelTitle).not.toBe('YouTube');
  });

  it('does not mistake a mix item for unavailable', async () => {
    expect(isUnavailableItem(realItem.snippet)).toBe(false);
  });
});
