import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pool, query } from './db.js';
import { hideTrack, unhideTrack, listHidden } from './hiddenTracks.js';

vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [] });
  query.mockResolvedValue({ rows: [] });
});

describe('hideTrack / unhideTrack', () => {
  it('upserts the hide row idempotently', async () => {
    await hideTrack('u1', 'trk1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO hidden_tracks');
    expect(sql).toContain('ON CONFLICT (user_id, track_id) DO NOTHING');
    expect(params.slice(0, 2)).toEqual(['u1', 'trk1']);
  });

  it('rejects junk track ids with a 400', async () => {
    for (const bad of [null, '', 42, 'x'.repeat(65)]) {
      await expect(hideTrack('u1', bad)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('unhide deletes the row', async () => {
    await unhideTrack('u1', 'trk1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM hidden_tracks');
    expect(params).toEqual(['u1', 'trk1']);
  });
});

describe('listHidden', () => {
  it('returns hydrated rows newest-first, falling back to the id for vanished tracks', async () => {
    query.mockResolvedValue({
      rows: [
        { track_id: 't1', hidden_at: '200', id: 't1', title: 'Known', artist: 'A', album: null,
          language: 'tamil', duration_sec: 100, stream_url: 's', raw: { imageUrl: 'i' } },
        { track_id: 'gone', hidden_at: '100', id: null, title: null },
      ],
    });
    const out = await listHidden('u1');
    expect(out[0]).toMatchObject({ id: 't1', title: 'Known', hiddenAt: 200 });
    expect(out[1]).toMatchObject({ id: 'gone', title: 'gone', hiddenAt: 100 });
    expect(query.mock.calls[0][0]).toContain('ORDER BY h.hidden_at DESC');
  });
});
