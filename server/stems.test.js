import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pool } from './db.js';
import {
  claimStems,
  isSafePublicUrl,
  mvsepConfig,
  pickInstrumental,
  resolveRemote,
} from './stems.js';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));
vi.mock('./catalog.js', () => ({ getSongDetails: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

describe('mvsepConfig', () => {
  it('is null without a token — the route answers 501, clients stay on the full mix', () => {
    expect(mvsepConfig({})).toBeNull();
  });

  it('defaults to BS-Roformer on the public endpoint, overridable by env', () => {
    expect(mvsepConfig({ MVSEP_API_TOKEN: 't' })).toEqual({
      token: 't',
      base: 'https://mvsep.com/api',
      sepType: 40,
    });
    expect(
      mvsepConfig({
        MVSEP_API_TOKEN: 't',
        MVSEP_API_BASE: 'https://hk.mvsep.com/api',
        MVSEP_SEP_TYPE: '20',
      }).sepType,
    ).toBe(20);
  });
});

describe('pickInstrumental', () => {
  it('prefers the explicitly named instrumental file', () => {
    const files = [
      { name: 'song_vocals.mp3', link: 'v' },
      { name: 'song_instrum.mp3', link: 'i' },
    ];
    expect(pickInstrumental(files).link).toBe('i');
  });

  it('still reads legacy name/link shapes, matching the Other stem positively', () => {
    const files = [
      { name: 'track (Vocals).mp3', link: 'v' },
      { name: 'track (Other).mp3', link: 'o' },
    ];
    expect(pickInstrumental(files).link).toBe('o');
  });

  // The live API labels stems with `type` + `url` + `download` and carries no
  // `name`/`link` at all — matching only those older fields picked whichever
  // file came first, i.e. karaoke playing the isolated VOCALS.
  it('reads the shape the api actually returns (type/url/download)', () => {
    const files = [
      { type: 'Vocals', url: 'https://x/j_bs_roformer_vocals.mp3', download: 'j_vocals.mp3' },
      { type: 'Other', url: 'https://x/j_bs_roformer_other.mp3', download: 'j_other.mp3' },
    ];
    expect(pickInstrumental(files).link).toBe('https://x/j_bs_roformer_other.mp3');
  });

  it('returns null rather than falling back to the vocals stem', () => {
    expect(
      pickInstrumental([{ type: 'Vocals', url: 'https://x/j_vocals.mp3' }]),
    ).toBeNull();
  });

  it('returns null for empty or junk file lists', () => {
    expect(pickInstrumental([])).toBeNull();
    expect(pickInstrumental(null)).toBeNull();
    expect(pickInstrumental([{ name: 'only_vocals.mp3', link: 'v' }])).toBeNull();
  });
});

// The stage-1 (get-remote) poll of a remote-url job. The heartbeat contract
// is the load-bearing part: `alive` may be true ONLY for a positively-
// acknowledged in-progress job. The account's single free-tier slot is "a
// non-stale submitted row exists", so a row that heartbeats on garbage
// (error envelope, rotated token) never goes stale and blocks every other
// track's separation for as long as anyone polls it.
describe('resolveRemote', () => {
  const cfg = { token: 'tok', base: 'https://mvsep.test/api', sepType: 40 };
  const answers = (body) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => JSON.stringify(body) })));
  afterEach(() => vi.unstubAllGlobals());

  it('hands over the stage-2 hash once the download is done', async () => {
    answers({ success: true, status: 'done', data: { hash: 'file-320.mp4' } });
    expect(await resolveRemote(cfg, 'h1')).toEqual({ hash: 'file-320.mp4' });
  });

  it('marks disowned jobs terminal so the row can fail and re-claim', async () => {
    answers({ success: false, status: 'not_found', data: {} });
    expect((await resolveRemote(cfg, 'h1')).terminal).toBe(true);
  });

  it('keeps an acknowledged in-progress job alive', async () => {
    answers({ success: true, status: 'downloading' });
    expect((await resolveRemote(cfg, 'h1')).alive).toBe(true);
  });

  it('does NOT keep an unrecognized error envelope alive — it must age out, not wedge the slot', async () => {
    answers({ success: false, message: 'Wrong API token' });
    const r = await resolveRemote(cfg, 'h1');
    expect(r.hash).toBeUndefined();
    expect(r.terminal).toBeFalsy();
    expect(r.alive).toBe(false);
  });

  it('reports transient network trouble as null (leave the row alone)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await resolveRemote(cfg, 'h1')).toBeNull();
  });
});

describe('claimStems', () => {
  it('claims via insert-or-reclaim and reports whether we won', async () => {
    pool.query.mockResolvedValue({ rows: [{ track_id: 't1' }] });
    expect(await claimStems('t1', 1000)).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    // Fresh insert starts 'queued'; re-claim only on failed-under-cap or a
    // stale queued/submitting claim. Submitted/storing rows are advanced by a
    // poll, never reclaimed here.
    expect(sql).toContain(`'queued'`);
    expect(sql).toContain(`track_stems.status = 'failed'`);
    expect(sql).toContain(`IN ('queued', 'submitting')`);
    // tries bumps ONLY on a failed retry — queue-waiting reclaims never burn it.
    expect(sql).toContain('CASE WHEN');
    // The staleness cutoff arrives pre-computed (now − 30min). Subtracting two
    // parameters IN SQL ("$2 - $4") is untyped and threw "operator is not
    // unique" on Postgres — the error that 500'd every prod stems poll.
    expect(sql).not.toMatch(/\$\d+ - \$\d+/);
    expect(params).toEqual(['t1', 1000, 3, 1000 - 30 * 60 * 1000]);
  });

  it('reports a lost claim when the row is live in someone else’s hands', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await claimStems('t1')).toBe(false);
  });
});

describe('isSafePublicUrl', () => {
  it('accepts ordinary https hosts', () => {
    expect(isSafePublicUrl('https://mvsep.com/download/abc.mp3')).toBe(true);
    expect(isSafePublicUrl('https://cdn.mvsep.com/x/y.mp3')).toBe(true);
  });

  it('rejects non-https, loopback, private, link-local and metadata hosts', () => {
    expect(isSafePublicUrl('http://mvsep.com/x.mp3')).toBe(false); // not https
    expect(isSafePublicUrl('https://localhost/x')).toBe(false);
    expect(isSafePublicUrl('https://127.0.0.1/x')).toBe(false);
    expect(isSafePublicUrl('https://10.0.0.5/x')).toBe(false);
    expect(isSafePublicUrl('https://192.168.1.9/x')).toBe(false);
    expect(isSafePublicUrl('https://172.16.4.4/x')).toBe(false);
    expect(isSafePublicUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafePublicUrl('https://100.100.100.200/x')).toBe(false); // CGNAT
    expect(isSafePublicUrl('not a url')).toBe(false);
  });
});
