// Trigger layer: decides WHO to tell and WHAT to say when something happens
// (fresh mixes, playlist activity, a library gone quiet). Every send goes
// through push.js sendCategory, which owns the guardrails — per-category
// switches, quiet hours, frequency caps — so triggers here stay simple and
// can never spam on their own. All functions are fire-and-forget safe: they
// swallow their own errors so a notification hiccup never fails the request
// that caused it.
import { query } from './db.js';
import { sendCategory, cardArtUrl } from './push.js';

const HOME = 'https://www.aurafm.live/';

// Big-picture art for a card: the track's own cover (raw JSONB carries the
// provider payload; imageUrl is the client-facing art URL).
async function trackArt(trackId) {
  if (!trackId) return null;
  const { rows } = await query(
    `SELECT raw->>'imageUrl' AS art FROM tracks WHERE id = $1`,
    [trackId],
  );
  const art = rows[0]?.art;
  return typeof art === 'string' && art.startsWith('https://') ? art : null;
}

// Cron just generated fresh editions for this user (autoPlaylists.js
// refreshDueMixes reports them). One card per user per morning, art from the
// first track of the first fresh mix.
export async function notifyMixesReady(userId, names, coverTrackId) {
  try {
    if (!Array.isArray(names) || !names.length) return;
    const one = names.length === 1;
    await sendCategory(userId, 'mixes', {
      title: one ? `your ${names[0]} is ready` : 'your mixes are ready',
      body: one
        ? 'a fresh edition for today. tap to listen.'
        : `${names.length} fresh mixes for today. tap to listen.`,
      image: cardArtUrl(await trackArt(coverTrackId), `mixes-${userId}`),
      link: HOME,
      collapseKey: 'mixes',
    });
  } catch (err) {
    console.warn('[notify] mixes-ready failed:', err?.message ?? err);
  }
}

// Someone added a song to a shared playlist → tell the other members, never
// the actor. Solo playlists have no other members, so they send nothing.
export async function notifyTrackAdded(actorId, playlistId, trackId) {
  try {
    const { rows } = await query(
      `SELECT p.name AS playlist_name, p.user_id AS owner_id,
              t.title AS track_title, u.name AS actor_name
       FROM playlists p, tracks t, users u
       WHERE p.id = $1 AND t.id = $2 AND u.id = $3`,
      [playlistId, trackId, actorId],
    );
    if (!rows.length) return;
    const meta = rows[0];
    const { rows: collab } = await query(
      'SELECT user_id FROM playlist_collaborators WHERE playlist_id = $1',
      [playlistId],
    );
    const recipients = new Set([meta.owner_id, ...collab.map(c => c.user_id)]);
    recipients.delete(actorId);
    const image = cardArtUrl(await trackArt(trackId), `pl-${playlistId}`);
    for (const uid of recipients) {
      await sendCategory(uid, 'social', {
        title: `${meta.actor_name} added a song`,
        body: `"${meta.track_title}" is now in ${meta.playlist_name}.`,
        image,
        link: HOME,
        collapseKey: `pl-${playlistId}`,
      });
    }
  } catch (err) {
    console.warn('[notify] track-added failed:', err?.message ?? err);
  }
}

// An invite was accepted → tell the playlist owner they have company.
export async function notifyInviteAccepted(actorId, playlistId) {
  try {
    const { rows } = await query(
      `SELECT p.name AS playlist_name, p.user_id AS owner_id, u.name AS actor_name
       FROM playlists p, users u
       WHERE p.id = $1 AND u.id = $2`,
      [playlistId, actorId],
    );
    if (!rows.length || rows[0].owner_id === actorId) return;
    await sendCategory(rows[0].owner_id, 'social', {
      title: `${rows[0].actor_name} joined your playlist`,
      body: `${rows[0].playlist_name} has a new member. say hi with a song.`,
      image: cardArtUrl(null, `pl-${playlistId}`),
      link: HOME,
      collapseKey: `pl-${playlistId}`,
    });
  } catch (err) {
    console.warn('[notify] invite-accepted failed:', err?.message ?? err);
  }
}

// Re-engagement, honestly hooked to the user's real library: users who can be
// reached (have a device), listened recently enough to still care (≤30 days)
// but have gone quiet (≥4 days). What "is waiting" is a real thing they made —
// their newest playlist, or their liked songs. sendCategory's 96h gap +
// category switch keep this to one gentle card every few days at most.
export async function sweepNudges({ maxSends = 25, now = Date.now() } = {}) {
  let sent = 0;
  try {
    const { rows: quiet } = await query(
      `SELECT pt.user_id
       FROM push_tokens pt JOIN listening_events le ON le.user_id = pt.user_id
       GROUP BY pt.user_id
       HAVING MAX(le.ts) < $1 AND MAX(le.ts) > $2`,
      [now - 4 * 86400_000, now - 30 * 86400_000],
    );
    for (const { user_id: userId } of quiet) {
      if (sent >= maxSends) break;
      const { rows: pl } = await query(
        'SELECT name FROM playlists WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [userId],
      );
      let payload = null;
      if (pl.length) {
        payload = {
          title: 'your playlist is waiting',
          body: `${pl[0].name} is ready when you are.`,
        };
      } else {
        const { rows: likes } = await query(
          'SELECT COUNT(*) AS n FROM liked_tracks WHERE user_id = $1',
          [userId],
        );
        const n = Number(likes[0]?.n ?? 0);
        if (!n) continue; // nothing real to point at — no manufactured urgency
        payload = {
          title: 'your liked songs are waiting',
          body: n === 1 ? 'a song you love, ready when you are.' : `${n} songs you love, ready when you are.`,
        };
      }
      const out = await sendCategory(userId, 'nudges', {
        ...payload,
        image: cardArtUrl(null, `nudge-${userId}`),
        link: HOME,
        collapseKey: 'nudge',
      }, { now });
      if (out.sent > 0) sent++;
    }
  } catch (err) {
    console.warn('[notify] nudge sweep failed:', err?.message ?? err);
  }
  return { nudged: sent };
}
