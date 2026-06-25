// One-time email codes for signup verification and password reset. Codes are
// hashed at rest (sha256); the brute-force defense is the attempts cap + short
// expiry, not hash cost. Callers must pass an already-normalised email.

import crypto from 'node:crypto';
import { pool } from './db.js';
import { sendMail, renderOtpEmail } from './email.js';

const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const MAX_ATTEMPTS = 5;              // failed verifies per code
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between (email, purpose) sends

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Lazy cleanup — no scheduler in this app, so signup/forgot call this to keep
// the table from accumulating expired rows. Best-effort.
export async function sweepExpired() {
  try { await pool.query('DELETE FROM email_otps WHERE expires_at < $1', [Date.now()]); }
  catch { /* best-effort */ }
}

// Issues a fresh code for (email, purpose) and emails it. Throws an Error with
// `.statusCode = 429` + `.retryAfterSec` if still within the resend cooldown,
// or a 502/503 from the mailer if sending fails.
export async function issueOtp(email, { purpose = 'signup' } = {}) {
  const now = Date.now();

  const recent = await pool.query(
    `SELECT created_at FROM email_otps WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  if (recent.rowCount) {
    const elapsed = now - Number(recent.rows[0].created_at);
    if (elapsed < RESEND_COOLDOWN_MS) {
      const err = new Error('please wait a moment before requesting another code');
      err.statusCode = 429;
      err.retryAfterSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw err;
    }
  }

  // One active code per (email, purpose).
  await pool.query('DELETE FROM email_otps WHERE email = $1 AND purpose = $2', [email, purpose]);

  const code = generateCode();
  await pool.query(
    `INSERT INTO email_otps (email, code_hash, purpose, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [email, hashCode(code), purpose, now + OTP_TTL_MS, now],
  );

  const { subject, html, text } = renderOtpEmail({ code, purpose });
  await sendMail({ to: email, subject, html, text });
}

// Verifies a submitted code. NEVER throws on a wrong code — returns a
// discriminated result the route maps to a status:
//   { ok: true }
//   { ok: false, reason: 'no_code' | 'expired' | 'locked' }
//   { ok: false, reason: 'mismatch', attemptsLeft }
// `consume: false` validates the code WITHOUT deleting it — used to gate a
// multi-step flow (e.g. "verify code" then "set password") where the code must
// survive the first check and is consumed only once the action commits. A wrong
// code still burns an attempt regardless of `consume`.
export async function verifyOtp(email, code, { purpose = 'signup', consume = true } = {}) {
  const now = Date.now();
  const { rows } = await pool.query(
    `SELECT * FROM email_otps WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  if (!rows.length) return { ok: false, reason: 'no_code' };

  const row = rows[0];
  if (Number(row.expires_at) < now) {
    await pool.query('DELETE FROM email_otps WHERE id = $1', [row.id]);
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(hashCode(code), 'hex');
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!match) {
    // Atomic increment gated on the current value: concurrent wrong guesses are
    // serialized by the DB, so the attempt cap can't be raced past. Zero rows
    // updated means the cap was already reached → locked. (security: #3)
    const { rows: bumped } = await pool.query(
      'UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 RETURNING attempts',
      [row.id, MAX_ATTEMPTS],
    );
    const attempts = bumped.length ? bumped[0].attempts : MAX_ATTEMPTS;
    if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
    return { ok: false, reason: 'mismatch', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  // Single-use — clear every code for this (email, purpose) so it can't replay.
  // Skipped when peeking (consume:false); the caller consumes once it commits.
  if (consume) {
    await pool.query('DELETE FROM email_otps WHERE email = $1 AND purpose = $2', [email, purpose]);
  }
  return { ok: true };
}

// Deletes the active code(s) for (email, purpose). Call after a verified action
// commits (e.g. the password was actually updated) so a failed follow-up step
// never burns the user's still-valid code prematurely.
export async function consumeOtp(email, purpose) {
  await pool.query('DELETE FROM email_otps WHERE email = $1 AND purpose = $2', [email, purpose]);
}
