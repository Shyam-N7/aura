import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool } from './db.js';
import {
  claimStems,
  isSafePublicUrl,
  mvsepConfig,
  pickInstrumental,
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

  it('otherwise takes whichever file is not the vocals', () => {
    const files = [
      { name: 'track (Vocals).mp3', link: 'v' },
      { name: 'track (Other).mp3', link: 'o' },
    ];
    expect(pickInstrumental(files).link).toBe('o');
  });

  it('returns null for empty or junk file lists', () => {
    expect(pickInstrumental([])).toBeNull();
    expect(pickInstrumental(null)).toBeNull();
    expect(pickInstrumental([{ name: 'only_vocals.mp3', link: 'v' }])).toBeNull();
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
    expect(params).toEqual(['t1', 1000, 3, 30 * 60 * 1000]);
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
