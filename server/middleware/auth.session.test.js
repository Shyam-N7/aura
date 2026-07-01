import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Mock the DB so resolveSession's `query` and createSessionWithCap's transactional
// client are fully controllable — no real Postgres connection is opened.
vi.mock('../db.js', () => {
  const query = vi.fn();
  const pool = { query, connect: vi.fn() };
  return { pool, query, isTransient: () => false };
});

let auth, db;
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('JWT_SECRET', 'unit-test-secret');
  db = await import('../db.js');
  auth = await import('./auth.js');
});
afterAll(() => vi.unstubAllEnvs());

const reqWithToken = (userId, tv, sid) =>
  ({ headers: { authorization: `Bearer ${auth.signToken(userId, tv, sid)}` }, cookies: {} });

describe('resolveSession', () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue({ rows: [] }); });

  it('grandfathers a legacy (no-sid) token when token_version matches', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: 2 }] });
    expect(await auth.resolveSession(reqWithToken('u1', 2, null))).toEqual({ userId: 'u1', sid: null });
  });
  it('rejects a legacy token whose token_version is stale', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: 5 }] });
    expect(await auth.resolveSession(reqWithToken('u1', 2, null))).toBeNull();
  });
  it('accepts a sid token with a live, non-revoked session row', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tv: 0, sid: 'ses1', revoked_at: null, last_seen_at: Date.now() }] });
    expect(await auth.resolveSession(reqWithToken('u1', 0, 'ses1'))).toEqual({ userId: 'u1', sid: 'ses1' });
  });
  it('rejects a sid token whose session was revoked', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tv: 0, sid: 'ses1', revoked_at: Date.now(), last_seen_at: Date.now() }] });
    expect(await auth.resolveSession(reqWithToken('u1', 0, 'ses1'))).toBeNull();
  });
  it('rejects a sid token when the session row is missing (LEFT JOIN → null sid)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tv: 0, sid: null, revoked_at: null, last_seen_at: null }] });
    expect(await auth.resolveSession(reqWithToken('u1', 0, 'ses1'))).toBeNull();
  });
  it('rejects a sid token on a token_version mismatch (global kill switch)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tv: 7, sid: 'ses1', revoked_at: null, last_seen_at: Date.now() }] });
    expect(await auth.resolveSession(reqWithToken('u1', 0, 'ses1'))).toBeNull();
  });
});

describe('createSessionWithCap', () => {
  const mockClient = ({ capCount = 0, known = false, tracked = false }) => {
    const calls = [];
    return {
      calls,
      client: {
        query: vi.fn(async (sql) => {
          calls.push(sql);
          if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 'u1' }] };
          if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: capCount }] };
          if (/bool_or/.test(sql)) return { rows: [{ known, tracked }] };
          return { rows: [] };
        }),
        release: vi.fn(),
      },
    };
  };
  const req = { headers: {}, ip: '1.1.1.1' };

  it('creates a session and flags newDevice for an unknown device on a tracked account', async () => {
    const { client } = mockClient({ capCount: 0, known: false, tracked: true });
    db.pool.connect.mockResolvedValueOnce(client);
    const r = await auth.createSessionWithCap(req, 'u1', 0, 3, null, 'dev_x');
    expect(r.capped).toBe(false);
    expect(r.newDevice).toBe(true);
    expect(r.sid).toMatch(/^ses_/);
    expect(typeof r.token).toBe('string');
    expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/^COMMIT/));
  });
  it('does NOT flag newDevice for the first tracked device', async () => {
    const { client } = mockClient({ capCount: 0, known: false, tracked: false });
    db.pool.connect.mockResolvedValueOnce(client);
    const r = await auth.createSessionWithCap(req, 'u1', 0, 3, null, 'dev_x');
    expect(r.newDevice).toBe(false);
  });
  it('returns capped:true at the device limit (no INSERT)', async () => {
    const { client, calls } = mockClient({ capCount: 3 });
    db.pool.connect.mockResolvedValueOnce(client);
    const r = await auth.createSessionWithCap(req, 'u1', 0, 3, null, 'dev_x');
    expect(r).toEqual({ capped: true });
    expect(calls.some((s) => /INSERT INTO user_sessions/.test(s))).toBe(false);
  });
});
