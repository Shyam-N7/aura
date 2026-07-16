import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Unit-test sessionPayload in isolation (same heavy-import mocking as
// auth.stepup.test.js — no supertest in this repo, so we exercise the exported
// helper directly rather than the routes, which all delegate to it).
vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn(), isTransient: () => false }));
vi.mock('./otp.js', () => ({ verifyOtp: vi.fn(), issueOtp: vi.fn(), consumeOtp: vi.fn(), sweepExpired: vi.fn() }));
vi.mock('./adminGate.js', () => ({ adminBlocked: () => false }));
vi.mock('./modes.js', () => ({ buildModesView: () => [] }));
vi.mock('./securityAlerts.js', () => ({ sendNewDeviceAlert: vi.fn() }));
vi.mock('bcrypt', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

let auth;
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'unit-test-secret');
  auth = await import('./auth.js');
});
afterAll(() => vi.unstubAllEnvs());

const row = { id: 'u1', email: 'a@b.com', name: 'a', password_hash: 'HASH' };
const req = (headers = {}) => ({ get: (h) => headers[h.toLowerCase()] });
const res = (sessionToken) => ({ locals: sessionToken ? { sessionToken } : {} });

describe('sessionPayload — token-in-body for native clients only', () => {
  it('web client (no header): user only, never a token', () => {
    const body = auth.sessionPayload(req(), res('JWT'), row);
    expect(body.user.id).toBe('u1');
    expect(body).not.toHaveProperty('token');
  });

  it('native client gets the same JWT in the body', () => {
    const body = auth.sessionPayload(req({ 'x-aura-client': 'native' }), res('JWT'), row);
    expect(body.token).toBe('JWT');
  });

  it('other X-Aura-Client values do not qualify', () => {
    const body = auth.sessionPayload(req({ 'x-aura-client': 'web' }), res('JWT'), row);
    expect(body).not.toHaveProperty('token');
  });

  it('no stashed token (no session created) → no token even for native', () => {
    const body = auth.sessionPayload(req({ 'x-aura-client': 'native' }), res(null), row);
    expect(body).not.toHaveProperty('token');
  });

  it('user is sanitized (no password_hash leaks)', () => {
    const body = auth.sessionPayload(req({ 'x-aura-client': 'native' }), res('JWT'), row);
    expect(JSON.stringify(body)).not.toContain('HASH');
    expect(body.user.hasPassword).toBe(true);
  });
});
