import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { signToken, requireAuth } from './middleware/auth.js';
import { issueOtp, verifyOtp, consumeOtp, sweepExpired } from './otp.js';
import { adminBlocked } from './adminGate.js';
import { buildModesView } from './modes.js';

const router = Router();

// Dev-only flow trace — silent when NODE_ENV=production (e.g. on Vercel).
const trace = (...a) => { if (process.env.NODE_ENV !== 'production') console.log(...a); };

function genId() {
  let s = 'u_';
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

const norm = (email) => String(email).toLowerCase().trim();

// Dev/staging admin gate response (see adminGate.js). Inert when ADMIN_ONLY is off.
const ADMIN_ONLY_RESPONSE = { error: 'this is a private dev environment — only the admin can sign in.', code: 'admin_only' };

export function sanitizeUser(row) {
  return {
    id:             row.id,
    email:          row.email,
    name:           row.name,
    hasOnboarded:   row.has_onboarded,
    seedArtists:    row.seed_artists ?? [],
    seedLanguages:  row.seed_languages ?? [],
    seedMood:       row.seed_mood ?? null,
    djName:         row.dj_name,
    familyMode:     row.family_mode ?? false,
    activeMode:     row.active_mode ?? 'everyday',
    modes:          buildModesView(row.modes_state ?? {}),
  };
}

// Maps a verifyOtp() failure result to an HTTP response.
function otpFail(res, result) {
  switch (result.reason) {
    case 'no_code':  return res.status(400).json({ error: 'no code found — request a new one', code: 'no_code' });
    case 'expired':  return res.status(410).json({ error: 'that code has expired — request a new one', code: 'expired' });
    case 'locked':   return res.status(429).json({ error: 'too many attempts — request a new code', code: 'locked' });
    case 'mismatch': return res.status(401).json({ error: "that code isn't right", code: 'mismatch', attemptsLeft: result.attemptsLeft });
    default:         return res.status(400).json({ error: 'verification failed', code: 'error' });
  }
}

// ── Sign up ──────────────────────────────────────────────────────────
// Creates the account UNVERIFIED and emails a 6-digit code — no token is
// issued until the code is verified (POST /verify-otp).
router.post('/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body ?? {};
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

    const e = norm(email);
    if (adminBlocked(e)) return res.status(403).json(ADMIN_ONLY_RESPONSE);
    sweepExpired();

    const existing = await pool.query('SELECT id, email_verified FROM users WHERE email = $1', [e]);
    const hash = await bcrypt.hash(password, 12);
    const now = Date.now();

    if (existing.rowCount) {
      const u = existing.rows[0];
      if (u.email_verified) return res.status(409).json({ error: 'email already registered' });
      // Abandoned (unverified) signup — let them restart: refresh credentials
      // and re-issue a code rather than block with a 409.
      await pool.query('UPDATE users SET name = $1, password_hash = $2 WHERE id = $3', [name.trim(), hash, u.id]);
    } else {
      const id = genId();
      await pool.query(
        `INSERT INTO users (id, email, name, password_hash, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, e, name.trim(), hash, now],
      );
    }

    await issueOtp(e, { purpose: 'signup' });
    res.json({ pendingVerification: true, email: e });
  } catch (err) {
    if (err.statusCode === 429) return res.status(429).json({ error: err.message, code: 'cooldown', retryAfterSec: err.retryAfterSec });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[auth/signup]', err);
    res.status(500).json({ error: 'signup failed' });
  }
});

// ── Sign in ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (adminBlocked(email)) return res.status(403).json(ADMIN_ONLY_RESPONSE);

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (!rows.length) return res.status(401).json({ error: 'invalid credentials' });

  const user = rows[0];
  if (!user.password_hash) return res.status(401).json({ error: 'this account uses social login — try Google' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  // Gate unverified accounts AFTER the password check (so verification status
  // never leaks to password guessers). Re-arm a code and route to the OTP step.
  if (!user.email_verified) {
    issueOtp(user.email, { purpose: 'signup' }).catch(() => { /* best-effort; respects cooldown */ });
    return res.status(403).json({ error: 'please verify your email first', pendingVerification: true, email: user.email });
  }

  await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [Date.now(), user.id]);
  const token = signToken(user.id);
  res.json({ token, user: sanitizeUser(user) });
});

// ── Google OAuth ─────────────────────────────────────────────────────
let _googleClient = null;
async function verifyGoogleToken(idToken) {
  if (!_googleClient) {
    const { OAuth2Client } = await import('google-auth-library');
    _googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }
  const ticket = await _googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

router.post('/google', async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) return res.status(400).json({ error: 'missing idToken' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });

  try {
    const payload = await verifyGoogleToken(idToken);
    const { sub, email, name } = payload;
    if (adminBlocked(email)) return res.status(403).json(ADMIN_ONLY_RESPONSE);

    const existing = await pool.query('SELECT * FROM users WHERE google_sub = $1', [sub]);
    let user;
    if (existing.rowCount) {
      user = existing.rows[0];
      await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [Date.now(), user.id]);
    } else {
      const byEmail = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
      if (byEmail.rowCount) {
        // Google proved ownership of this email — link the account and mark it
        // verified (promotes an unverified email/password row in one step).
        user = byEmail.rows[0];
        await pool.query('UPDATE users SET google_sub = $1, last_login_at = $2, email_verified = TRUE WHERE id = $3', [sub, Date.now(), user.id]);
      } else {
        const id = genId();
        const now = Date.now();
        await pool.query(
          `INSERT INTO users (id, email, name, google_sub, created_at, last_login_at, email_verified)
           VALUES ($1, $2, $3, $4, $5, $5, TRUE)`,
          [id, email.toLowerCase(), name ?? email.split('@')[0], sub, now],
        );
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        user = rows[0];
      }
    }

    const token = signToken(user.id);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.warn('[auth/google]', err.message);
    res.status(401).json({ error: 'google token verification failed' });
  }
});

// ── Verify signup code ───────────────────────────────────────────────
// Flips email_verified and issues the session — same { token, user } shape as
// the old signup, so the client's session path is unchanged.
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body ?? {};
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });
    if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'enter the 6-digit code', code: 'bad_format' });

    const e = norm(email);
    if (adminBlocked(e)) return res.status(403).json(ADMIN_ONLY_RESPONSE);
    const result = await verifyOtp(e, code, { purpose: 'signup' });
    if (!result.ok) return otpFail(res, result);

    const upd = await pool.query(
      'UPDATE users SET email_verified = TRUE, last_login_at = $1 WHERE email = $2 RETURNING *',
      [Date.now(), e],
    );
    if (!upd.rowCount) return res.status(409).json({ error: 'account no longer exists — sign up again', code: 'signup_expired' });

    const token = signToken(upd.rows[0].id);
    res.json({ token, user: sanitizeUser(upd.rows[0]) });
  } catch (err) {
    console.error('[auth/verify-otp]', err);
    res.status(500).json({ error: 'verification failed' });
  }
});

// ── Resend signup code ───────────────────────────────────────────────
// Anti-enumeration: only (re)issues for a real unverified account, but always
// returns 200 (except an honest cooldown 429 so the UI can show the timer).
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const e = norm(email);

    const { rows } = await pool.query('SELECT email_verified FROM users WHERE email = $1', [e]);
    if (rows.length && !rows[0].email_verified) {
      await issueOtp(e, { purpose: 'signup' });
    }
    res.json({ ok: true, cooldownSec: 60 });
  } catch (err) {
    if (err.statusCode === 429) return res.status(429).json({ error: err.message, code: 'cooldown', retryAfterSec: err.retryAfterSec });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[auth/resend-otp]', err);
    res.status(500).json({ error: 'could not resend code' });
  }
});

// ── Forgot password — request a reset code ───────────────────────────
// Anti-enumeration: always 200 unless an honest cooldown 429. Only emails a
// code for an account that actually has a password to reset.
router.post('/forgot', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const e = norm(email);
    trace('[forgot] request:', e);
    sweepExpired();

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [e]);
    if (rows.length && rows[0].password_hash) {
      trace('[forgot] account has a password → issuing reset code');
      await issueOtp(e, { purpose: 'reset' });
    } else {
      trace('[forgot] no resettable account → 200, no code (anti-enumeration)');
    }
    res.json({ ok: true, cooldownSec: 60 });
  } catch (err) {
    if (err.statusCode === 429) { trace('[forgot] cooldown → 429, retryAfter', err.retryAfterSec, 's'); return res.status(429).json({ error: err.message, code: 'cooldown', retryAfterSec: err.retryAfterSec }); }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    console.error('[auth/forgot]', err);
    res.status(500).json({ error: 'request failed' });
  }
});

// ── Forgot password — verify the reset code (step 1 of 2) ────────────
// Non-destructive check so the two-step UI can confirm the code before asking
// for a new password; the code is consumed later by /reset-password, only once
// the password actually changes. Anti-enumeration is preserved: a non-existent /
// passwordless account has no code, so this returns the generic no_code.
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, code } = req.body ?? {};
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });
    if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'enter the 6-digit code', code: 'bad_format' });

    const e = norm(email);
    trace('[reset] peek-verify:', e);
    const result = await verifyOtp(e, code, { purpose: 'reset', consume: false });
    if (!result.ok) { trace('[reset] peek rejected:', result.reason); return otpFail(res, result); }
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/verify-reset-otp]', err);
    res.status(500).json({ error: 'verification failed' });
  }
});

// ── Reset password — verify code + set new password (step 2 of 2) ─────
// On success sets the new hash and marks the email verified (control proven),
// then returns { ok: true } WITHOUT a session — the user re-logs in with the new
// password. The code is verified non-destructively, then consumed only AFTER the
// password update commits — so a failed update never strands the user on a code
// that's already been deleted.
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body ?? {};
    if (!email || !code || !password) return res.status(400).json({ error: 'email, code and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
    if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'enter the 6-digit code', code: 'bad_format' });

    const e = norm(email);
    trace('[reset] verify:', e, `(code len ${String(code).length})`);
    const result = await verifyOtp(e, code, { purpose: 'reset', consume: false });
    if (!result.ok) { trace('[reset] code rejected:', result.reason); return otpFail(res, result); }
    trace('[reset] code ok → updating password');

    const hash = await bcrypt.hash(password, 12);
    const upd = await pool.query(
      'UPDATE users SET password_hash = $1, email_verified = TRUE, last_login_at = $2 WHERE email = $3',
      [hash, Date.now(), e],
    );
    if (!upd.rowCount) { trace('[reset] no matching account row'); return res.status(409).json({ error: 'account not found', code: 'no_account' }); }

    // Password committed — now retire the code so it can't be replayed.
    await consumeOtp(e, 'reset');

    trace('[reset] password updated → require re-login:', e);
    // No session minted — the user signs in again with the new password.
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/reset-password]', err);
    res.status(500).json({ error: 'reset failed' });
  }
});

// ── Current user ─────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'user not found' });
  res.json({ user: sanitizeUser(rows[0]) });
});

// ── Update preferences ───────────────────────────────────────────────
router.patch('/me/preferences', requireAuth, async (req, res) => {
  const { hasOnboarded, seedArtists, seedLanguages, seedMood, djName } = req.body ?? {};
  const sets = [];
  const vals = [];
  let i = 1;

  if (hasOnboarded !== undefined)  { sets.push(`has_onboarded = $${i++}`);  vals.push(!!hasOnboarded); }
  if (seedArtists !== undefined)   { sets.push(`seed_artists = $${i++}`);   vals.push(JSON.stringify(seedArtists)); }
  if (seedLanguages !== undefined) { sets.push(`seed_languages = $${i++}`); vals.push(JSON.stringify(seedLanguages)); }
  if (seedMood !== undefined)      { sets.push(`seed_mood = $${i++}`);      vals.push(seedMood); }
  if (djName !== undefined)        { sets.push(`dj_name = $${i++}`);        vals.push(djName); }

  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

  vals.push(req.userId);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);

  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  res.json({ user: sanitizeUser(rows[0]) });
});

// ── GDPR: export all of my data ──────────────────────────────────────
// Returns one JSON bundle of everything we hold for this user. Account row is
// run through sanitizeUser so the password hash never leaves the server.
// A full export is a heavy 7-table read, so cap it tighter than the broad auth
// limiter (per IP, a few per hour) — it can't be driven for DB load.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'too many export requests — try again in a little while.' },
});
router.get('/me/export', exportLimiter, requireAuth, async (req, res) => {
  const uid = req.userId;
  try {
    const [user, events, likes, playlists, playlistTracks, moods, journal] = await Promise.all([
      pool.query('SELECT * FROM users WHERE id = $1', [uid]),
      pool.query('SELECT track_id, ts, kind, position_sec, mood, language FROM listening_events WHERE user_id = $1 ORDER BY ts', [uid]),
      pool.query('SELECT track_id, liked_at FROM liked_tracks WHERE user_id = $1 ORDER BY liked_at', [uid]),
      pool.query('SELECT id, name, description, cover_track_id, created_at, updated_at FROM playlists WHERE user_id = $1', [uid]),
      pool.query('SELECT pt.playlist_id, pt.track_id, pt.position, pt.added_at FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = $1 ORDER BY pt.playlist_id, pt.position', [uid]),
      pool.query('SELECT ts, mood, confidence, drift, reason, events_seen FROM mood_snapshots WHERE user_id = $1 ORDER BY ts', [uid]),
      pool.query('SELECT date, payload, events_seen, fetched_at FROM journal_cache WHERE user_id = $1 ORDER BY date', [uid]),
    ]);
    if (!user.rows.length) return res.status(404).json({ error: 'user not found' });
    res.setHeader('Content-Disposition', 'attachment; filename="aura-data-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: sanitizeUser(user.rows[0]),
      listeningEvents: events.rows,
      likes: likes.rows,
      playlists: playlists.rows.map(p => ({
        ...p,
        tracks: playlistTracks.rows.filter(t => t.playlist_id === p.id),
      })),
      moodSnapshots: moods.rows,
      journal: journal.rows,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── GDPR: delete my account ──────────────────────────────────────────
// Removes the user row; every per-user table (listening_events, liked_tracks,
// playlists → playlist_tracks, mood_snapshots, journal_cache) is ON DELETE
// CASCADE, so all listening history goes with it. Not reversible.
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    if (!rowCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
