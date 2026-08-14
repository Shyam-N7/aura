import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';

// The router in isolation: auth stubbed to a fixed user, the job engine mocked.
// What is under test is the HTTP contract the two clients code against —
// status codes, the {error, code} shape, the id guards, and the flag-off
// behaviour that protects production.
//
// Driven over a real socket via node:http rather than supertest, because this
// repo deliberately has no supertest (see the note in auth.stepup.test.js) and
// one router is not worth a dependency. The requests are real either way.

let enabled = true;
vi.mock('./middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.userId = 'u1'; next(); },
}));
vi.mock('./importJobs.js', () => ({
  youtubeImportEnabled: () => enabled,
  enqueueImport: vi.fn(),
  drainJob: vi.fn().mockResolvedValue({}),
  getJob: vi.fn(),
  resolveReviewItem: vi.fn(),
  STATUS: {
    QUEUED: 'queued', FETCHING: 'fetching', MATCHING: 'matching',
    READY: 'ready', COMPLETE: 'complete', FAILED: 'failed',
  },
}));
vi.mock('./db.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } }));

import router from './importRoutes.js';
import { enqueueImport, getJob, resolveReviewItem, drainJob } from './importJobs.js';

const app = express();
app.use(express.json());
app.use('/api/import/youtube', router);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

// A minimal stand-in for supertest's fluent API — enough for these tests and
// nothing more.
function req(method, path) {
  const p = {
    _body: undefined,
    send(body) { p._body = body; return p; },
    then(resolve, reject) {
      return fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: p._body === undefined ? undefined : JSON.stringify(p._body),
      })
        .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
        .then(resolve, reject);
    },
  };
  return p;
}
const request = () => ({
  get: (path) => req('GET', path),
  post: (path) => req('POST', path),
  delete: (path) => req('DELETE', path),
});

const jobView = (over = {}) => ({
  job: {
    id: 'yti_abc123', yt_playlist_id: 'PLx', kind: 'PL', status: 'ready',
    title: 'Road Trip', windowed: false, playlist_id: 'pl_1',
    total_count: 3, auto_count: 2, review_count: 1, unmatched_count: 0,
    error: null, created_at: 1, updated_at: 2, ...over,
  },
  items: [{
    id: 42, position: 0, yt_title: 'Kesariya', yt_channel: 'Uploader', yt_duration: 268,
    tier: 'review', track_id: null, score: 0.75, state: 'pending',
    candidates: [{ id: 'c1', title: 'Kesariya', artist: 'Arijit Singh', score: 0.75 }],
  }],
  matching: 0,
});

beforeEach(() => {
  enabled = true;
  vi.clearAllMocks();
  drainJob.mockResolvedValue({});
});

describe('preview — costs nothing, answers everything', () => {
  it('classifies a playlist and a windowed mix differently', async () => {
    const pl = await request().post('/api/import/youtube/preview')
      .send({ url: 'https://www.youtube.com/playlist?list=PLabc' });
    expect(pl.status).toBe(200);
    expect(pl.body).toMatchObject({ importable: true, windowed: false, windowSize: null });

    const mix = await request().post('/api/import/youtube/preview')
      .send({ url: 'https://www.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk' });
    // A radio mix has no end — the client must say "the first 30", not imply it
    // imported the lot.
    expect(mix.body).toMatchObject({ importable: true, windowed: true, windowSize: 30 });
  });

  it('does not call the job engine at all', async () => {
    await request().post('/api/import/youtube/preview')
      .send({ url: 'https://www.youtube.com/playlist?list=PLabc' });
    expect(enqueueImport).not.toHaveBeenCalled();
    expect(drainJob).not.toHaveBeenCalled();
  });

  it('gives every refusal its own code, not a generic message', async () => {
    const cases = [
      ['https://www.youtube.com/playlist?list=WL', 'YT_WATCH_LATER'],
      ['https://www.youtube.com/playlist?list=HL', 'YT_HISTORY'],
      ['https://www.youtube.com/watch?v=abc12345678', 'YT_VIDEO_ONLY'],
      ['https://example.com/x', 'YT_NOT_YOUTUBE'],
      ['not a url at all', 'YT_NOT_A_URL'],
      ['', 'YT_EMPTY'],
    ];
    for (const [url, code] of cases) {
      const res = await request().post('/api/import/youtube/preview').send({ url });
      expect(res.status, url).toBe(422);
      expect(res.body.code, url).toBe(code);
    }
  });
});

describe('create and poll', () => {
  it('returns 202 with the job view', async () => {
    enqueueImport.mockResolvedValue({ id: 'yti_abc123', status: 'queued' });
    getJob.mockResolvedValue(jobView());
    const res = await request().post('/api/import/youtube').send({ url: 'https://www.youtube.com/playlist?list=PLabc' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      id: 'yti_abc123', status: 'ready', playlistId: 'pl_1',
      counts: { total: 3, auto: 2, review: 1, unmatched: 0, matching: 0 },
    });
    // Item ids are strings on the wire: they are BIGSERIAL, and a client that
    // round-trips them through JSON must not depend on number precision.
    expect(res.body.items[0].id).toBe('42');
  });

  it('surfaces a failed drain as a readable job, not a 500', async () => {
    // The drain already recorded WHY on the job; throwing here would replace a
    // specific, displayable reason with a generic error.
    enqueueImport.mockResolvedValue({ id: 'yti_abc123', status: 'queued' });
    drainJob.mockRejectedValue(new Error('boom'));
    getJob.mockResolvedValue(jobView({ status: 'failed', error: 'YT_PRIVATE: that playlist is private' }));
    const res = await request().post('/api/import/youtube').send({ url: 'https://www.youtube.com/playlist?list=PLabc' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'failed', error: 'YT_PRIVATE' });
  });

  it('drives a drain while the job is live, and not once it is terminal', async () => {
    getJob.mockResolvedValue(jobView({ status: 'matching' }));
    await request().get('/api/import/youtube/yti_abc123');
    expect(drainJob).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    getJob.mockResolvedValue(jobView({ status: 'complete' }));
    await request().get('/api/import/youtube/yti_abc123');
    expect(drainJob).not.toHaveBeenCalled();
  });
});

describe('id guards', () => {
  // app.param does NOT propagate into a mounted Router, and itemId binds
  // against a BIGSERIAL — junk reached Postgres as a cast error, i.e. a 500 for
  // input that deserves a 400.
  it('rejects a malformed job id without touching the engine', async () => {
    for (const bad of ['not-an-id', "yti_x'; DROP TABLE users;--", 'yti_', '../etc']) {
      const res = await request().get(`/api/import/youtube/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.code, bad).toBe('YT_BAD_ID');
    }
    expect(getJob).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric item id', async () => {
    const res = await request().post('/api/import/youtube/yti_abc123/items/abc').send({ skip: true });
    expect(res.status).toBe(400);
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });
});

describe('resolve and cancel', () => {
  it('passes the choice through and returns progress', async () => {
    resolveReviewItem.mockResolvedValue({ pending: 0, accepted: 1 });
    const res = await request().post('/api/import/youtube/yti_abc123/items/42').send({ trackId: 'c1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 0, accepted: 1 });
    expect(resolveReviewItem).toHaveBeenCalledWith('u1', 'yti_abc123', '42', { trackId: 'c1', skip: false });
  });

  it('refuses a candidate we never offered', async () => {
    // Without this the endpoint is an arbitrary "add any track to this
    // playlist" primitive reachable with a job id.
    const err = Object.assign(new Error('that suggestion is no longer available'), {
      statusCode: 422, expose: true, code: 'YT_NOT_OFFERED',
    });
    resolveReviewItem.mockRejectedValue(err);
    const res = await request().post('/api/import/youtube/yti_abc123/items/42').send({ trackId: 'c_evil' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('YT_NOT_OFFERED');
  });

  it('will not cancel an import that already finished', async () => {
    getJob.mockResolvedValue(jobView({ status: 'complete' }));
    const res = await request().delete('/api/import/youtube/yti_abc123');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('YT_NOT_RUNNING');
  });

  it('cancels one still in flight', async () => {
    getJob.mockResolvedValue(jobView({ status: 'matching' }));
    const res = await request().delete('/api/import/youtube/yti_abc123');
    expect(res.status).toBe(200);
  });
});

describe('with the feature off', () => {
  // The check that protects production: with YOUTUBE_API_KEY unset nothing here
  // does work, and every answer is specific enough for a client to hide its
  // entry point rather than show a broken one.
  beforeEach(() => { enabled = false; });

  it('503s every route with YT_DISABLED and never reaches the engine', async () => {
    const calls = [
      request().post('/api/import/youtube/preview').send({ url: 'https://www.youtube.com/playlist?list=PLa' }),
      request().post('/api/import/youtube').send({ url: 'https://www.youtube.com/playlist?list=PLa' }),
      request().get('/api/import/youtube/yti_abc123'),
      request().post('/api/import/youtube/yti_abc123/items/42').send({ skip: true }),
      request().delete('/api/import/youtube/yti_abc123'),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('YT_DISABLED');
    }
    expect(enqueueImport).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
    expect(drainJob).not.toHaveBeenCalled();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });
});
