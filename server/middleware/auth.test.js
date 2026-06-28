import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// middleware/auth.js imports db.js, which throws at load unless DATABASE_URL is
// set. A dummy URL is enough — the functions under test (deviceLabel, signToken,
// peekUserId) never open a connection. Stub env BEFORE the dynamic import.
let auth;
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('JWT_SECRET', 'unit-test-secret');
  auth = await import('./auth.js');
});
afterAll(() => vi.unstubAllEnvs());

describe('deviceLabel', () => {
  it('combines browser + OS', () => {
    expect(auth.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 Chrome/120 Safari/537.36'))
      .toBe('Chrome · Windows');
    expect(auth.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605 Version/16 Mobile Safari/604.1'))
      .toBe('Safari · iOS');
    expect(auth.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Version/17 Safari/605'))
      .toBe('Safari · macOS');
  });
  it('falls back for an unknown UA', () => {
    expect(auth.deviceLabel('')).toBe('Unknown device');
    expect(auth.deviceLabel('curl/8.0')).toBe('Unknown device');
  });
});

describe('signToken + peekUserId', () => {
  const bearer = (t) => ({ headers: { authorization: `Bearer ${t}` }, cookies: {} });

  it('round-trips the subject through a signed token (sid carried)', () => {
    const t = auth.signToken('u_abc', 3, 'ses_1');
    expect(auth.peekUserId(bearer(t))).toBe('u_abc');
  });

  it('reads the httpOnly session cookie too', () => {
    const t = auth.signToken('u_xyz', 0, 'ses_2');
    expect(auth.peekUserId({ headers: {}, cookies: { aura_session: t } })).toBe('u_xyz');
  });

  it('returns null for a missing / tampered token (no key forgery)', () => {
    expect(auth.peekUserId({ headers: {}, cookies: {} })).toBeNull();
    expect(auth.peekUserId(bearer('not.a.jwt'))).toBeNull();
    const t = auth.signToken('u_abc', 0, 'ses_1');
    expect(auth.peekUserId(bearer(t + 'tampered'))).toBeNull();
  });
});
