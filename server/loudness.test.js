import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool } from './db.js';
import { getLoudness, claimMeasure, parseEbur128 } from './loudness.js';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));
vi.mock('./catalog.js', () => ({ getSongDetails: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
});

describe('parseEbur128', () => {
  // The tail of a real ebur128 stderr: per-frame lines also carry "I:", the
  // summary block comes last — last match must win.
  const STDERR = `
[Parsed_ebur128_0 @ 0x1] t: 187.5  TARGET:-23 LUFS  M: -13.6 S: -14.1  I: -14.9 LUFS  LRA: 5.8 LU  FTPK: -2.5 dBFS  TPK: -0.3 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -14.5 LUFS
    Threshold: -25.1 LUFS

  Loudness range:
    LRA:         6.3 LU
    Threshold: -35.2 LUFS
    LRA low:   -18.7 LUFS
    LRA high:  -12.4 LUFS

  True peak:
    Peak:       -0.3 dBFS
`;

  it('reads integrated loudness + true peak from the summary (last match wins)', () => {
    expect(parseEbur128(STDERR)).toEqual({ lufs: -14.5, truePeak: -0.3 });
  });

  it('returns null when there is no summary to trust', () => {
    expect(parseEbur128('conversion failed')).toBeNull();
  });

  it('tolerates a missing true-peak block', () => {
    expect(parseEbur128('I: -11 LUFS')).toEqual({ lufs: -11, truePeak: null });
  });
});

describe('getLoudness', () => {
  it('returns done rows keyed by track id', async () => {
    pool.query.mockResolvedValue({
      rows: [{ track_id: 'a', lufs: -12.5, true_peak: -0.8 }],
    });
    const out = await getLoudness(['a', 'b']);
    expect(out).toEqual({ a: { lufs: -12.5, truePeak: -0.8 } });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain(`status = 'done'`);
    expect(params[0]).toEqual(['a', 'b']);
  });

  it('drops junk ids, dedupes, caps the batch, and skips the query when empty', async () => {
    const ids = ['a', 'a', '', null, 42, 'x'.repeat(65), ...Array.from({ length: 80 }, (_, i) => `t${i}`)];
    await getLoudness(ids);
    expect(pool.query.mock.calls[0][1][0]).toHaveLength(50);
    pool.query.mockClear();
    expect(await getLoudness([null, ''])).toEqual({});
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('claimMeasure', () => {
  it('claims via insert-or-reclaim and reports whether it won', async () => {
    pool.query.mockResolvedValue({ rows: [{ track_id: 'a' }] });
    expect(await claimMeasure('a', 1000)).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO track_loudness');
    expect(sql).toContain('ON CONFLICT (track_id) DO UPDATE');
    expect(sql).toContain(`track_loudness.status = 'failed'`);
    expect(sql).toContain(`track_loudness.status = 'pending'`);
    expect(params[0]).toBe('a');

    pool.query.mockResolvedValue({ rows: [] });
    expect(await claimMeasure('a', 1000)).toBe(false);
  });
});
