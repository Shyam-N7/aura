import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// db.js throws at load unless DATABASE_URL is set (and it would try to connect on
// query()). isTransient is pure — it never touches the pool — so a dummy URL is
// enough. Stub env BEFORE the dynamic import.
let db;
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  db = await import('./db.js');
});
afterAll(() => vi.unstubAllEnvs());

describe('isTransient — what query() may retry', () => {
  it('is true for dropped/timed-out connections (retry is safe)', () => {
    expect(db.isTransient(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(db.isTransient(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(db.isTransient(Object.assign(new Error('x'), { errno: 'EPIPE' }))).toBe(true);
    expect(db.isTransient(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(db.isTransient(new Error('terminating connection due to administrator command'))).toBe(true);
  });

  it('unwraps an AggregateError (Node surfaces connect-timeouts this way)', () => {
    const agg = new AggregateError(
      [Object.assign(new Error('x'), { code: 'ETIMEDOUT' })],
      'all connection attempts failed',
    );
    expect(db.isTransient(agg)).toBe(true);
  });

  it('is FALSE for SQL/constraint errors (deterministic — retrying re-trips them)', () => {
    expect(db.isTransient(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
    expect(db.isTransient(Object.assign(new Error('syntax error'), { code: '42601' }))).toBe(false);
    expect(db.isTransient(new Error('something application-level'))).toBe(false);
    expect(db.isTransient(null)).toBe(false);
    expect(db.isTransient(undefined)).toBe(false);
  });
});
