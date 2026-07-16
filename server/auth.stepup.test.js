import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Unit-test the delete step-up in isolation. Mock every heavy transitive import of
// auth.js (db, otp, bcrypt, adminGate→config, modes, securityAlerts) so importing it
// never touches Postgres, the mailer, or config's fail-fast env checks. (No supertest
// in this repo, so we exercise the exported assertDeleteStepUp helper directly rather
// than the route.)
vi.mock('./db.js', () => ({ pool: { query: vi.fn() }, query: vi.fn(), isTransient: () => false }));
vi.mock('./otp.js', () => ({ verifyOtp: vi.fn(), issueOtp: vi.fn(), consumeOtp: vi.fn(), sweepExpired: vi.fn() }));
vi.mock('./adminGate.js', () => ({ adminBlocked: () => false }));
vi.mock('./modes.js', () => ({ buildModesView: () => [] }));
vi.mock('./securityAlerts.js', () => ({ sendNewDeviceAlert: vi.fn() }));
vi.mock('bcrypt', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

let auth, db, otp, bcrypt;
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'unit-test-secret');
  db = await import('./db.js');
  otp = await import('./otp.js');
  bcrypt = (await import('bcrypt')).default;
  auth = await import('./auth.js');
});
afterAll(() => vi.unstubAllEnvs());

const pwUser   = { id: 'u1', email: 'a@b.com', password_hash: 'HASH', delete_attempts: 0, delete_locked_until: null };
const googUser = { id: 'u2', email: 'g@b.com', password_hash: null,   delete_attempts: 0, delete_locked_until: null };

describe('assertDeleteStepUp — password branch', () => {
  beforeEach(() => { db.pool.query.mockReset(); bcrypt.compare.mockReset(); });

  it('ok when the password matches', async () => {
    bcrypt.compare.mockResolvedValue(true);
    db.pool.query.mockResolvedValue({ rows: [] });   // reset-counter UPDATE
    expect((await auth.assertDeleteStepUp(pwUser, { password: 'right' })).ok).toBe(true);
  });

  it('401 + attempt bump on a wrong password', async () => {
    bcrypt.compare.mockResolvedValue(false);
    db.pool.query.mockResolvedValue({ rows: [{ delete_attempts: 1 }] });
    const r = await auth.assertDeleteStepUp(pwUser, { password: 'wrong' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body.attemptsLeft).toBe(4);
  });

  it('429 locked when the failed attempt trips the cap (attempts reset to 0)', async () => {
    bcrypt.compare.mockResolvedValue(false);
    db.pool.query.mockResolvedValue({ rows: [{ delete_attempts: 0 }] });
    const r = await auth.assertDeleteStepUp(pwUser, { password: 'wrong' });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('locked');
  });

  it('429 before bcrypt when already locked', async () => {
    const locked = { ...pwUser, delete_locked_until: Date.now() + 60_000 };
    const r = await auth.assertDeleteStepUp(locked, { password: 'whatever' });
    expect(r.status).toBe(429);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});

describe('assertDeleteStepUp — code branch (Google-only)', () => {
  beforeEach(() => { otp.verifyOtp.mockReset(); });

  it('requires a code', async () => {
    const r = await auth.assertDeleteStepUp(googUser, {});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('code_required');
  });
  it('ok on a valid code (peeked, not consumed)', async () => {
    otp.verifyOtp.mockResolvedValue({ ok: true });
    const r = await auth.assertDeleteStepUp(googUser, { code: '123456' });
    expect(r.ok).toBe(true);
    expect(otp.verifyOtp).toHaveBeenCalledWith('g@b.com', '123456', { purpose: 'delete', consume: false });
  });
  it('401 on a wrong code', async () => {
    otp.verifyOtp.mockResolvedValue({ ok: false, reason: 'mismatch', attemptsLeft: 2 });
    const r = await auth.assertDeleteStepUp(googUser, { code: '000000' });
    expect(r.status).toBe(401);
    expect(r.body.attemptsLeft).toBe(2);
  });
});
