// Security alerts — new-device sign-in emails + a factual "also active elsewhere"
// note. Orchestration only: composes the render (email.js) + send (email.js) with one
// honest geo query. Best-effort; the caller awaits it inside try/catch so a mail
// failure never fails a login.
//
// Honest limits (by design): city/country come ONLY from Vercel's x-vercel-ip-*
// headers → present in prod, null locally (so the sharing note is inert in dev), and
// IP-geo is coarse (VPN / travel). That's exactly why the note only STRENGTHENS
// wording — it never blocks a sign-in and never scores a user.

import { query } from './db.js';
import { sendMail, renderNewDeviceEmail } from './email.js';

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;   // matches the session lifetime

// Another currently-active session for this user in a DIFFERENT country. Returns the
// differing country code, or null (no other session / no geo / same country). Inert
// locally, where country is null.
export async function foreignConcurrentCountry(userId, currentSid, country) {
  if (!country) return null;   // no geo on THIS sign-in → nothing to compare against
  const { rows } = await query(
    `SELECT country FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2
        AND country IS NOT NULL AND country <> $3
        AND created_at > $4
      ORDER BY last_seen_at DESC LIMIT 1`,
    [userId, currentSid ?? '', country, Date.now() - ACTIVE_WINDOW_MS],
  );
  return rows[0]?.country ?? null;
}

// Compose + send the new-device alert. `meta` is the sign-in's reqMeta
// (label/city/country/ip). Guards on a missing recipient. Must be AWAITED by the
// caller (a serverless lambda can freeze right after res.json, dropping an
// un-awaited send), inside try/catch so it never fails the login.
export async function sendNewDeviceAlert({ userId, email, name, sid, meta = {} }) {
  if (!email) return;
  const alsoActiveIn = await foreignConcurrentCountry(userId, sid, meta.country).catch(() => null);
  const rendered = renderNewDeviceEmail({
    name,
    deviceLabel: meta.label,
    city: meta.city,
    country: meta.country,
    ip: meta.ip,
    time: new Date().toUTCString(),   // UTC — the user's timezone isn't known server-side
    alsoActiveIn,
  });
  await sendMail({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text });
}
