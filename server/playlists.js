import crypto from 'node:crypto';
import { pool, query } from './db.js';

function newId() {
  return 'pl_' + Math.random().toString(36).slice(2, 10);
}

// Invite tokens are bearer credentials (presenting one grants collaborator access
// for 7 days), so they must be unguessable — use a CSPRNG, not Math.random.
// base64url keeps the token safe inside the /playlists?join=… share link.
function newToken() {
  return 'inv_' + crypto.randomBytes(18).toString('base64url');
}

// Public share id — an unguessable CSPRNG token for the /p/:public_id link, kept
// distinct from the weak internal `pl_` id so it can't be enumerated.
function newPublicId() {
  return 'pub_' + crypto.randomBytes(12).toString('base64url');
}

function notFound() {
  const err = new Error('playlist not found');
  err.statusCode = 404;
  throw err;
}
function forbidden(msg = "you can't edit this playlist") {
  const err = new Error(msg);
  err.statusCode = 403;
  throw err;
}

// The caller's access to a playlist: { exists, role } where role is
// 'owner' | 'editor' | 'viewer' | null (exists but no access). One round-trip:
// joins the caller's collaborator row (if any) to the playlist's owner.
async function getAccess(userId, playlistId) {
  const { rows } = await query(
    `SELECT p.user_id AS owner_id, p.is_public, c.role AS collab_role
     FROM playlists p
     LEFT JOIN playlist_collaborators c ON c.playlist_id = p.id AND c.user_id = $1
     WHERE p.id = $2`,
    [userId, playlistId],
  );
  if (!rows.length) return { exists: false, role: null, member: false };
  const r = rows[0];
  // `member` = owner or an actual collaborator (vs. a public-link viewer). It
  // gates the collaborator list — a public playlist is viewable by any signed-in
  // user (they get streams, unlike the anonymous /p/ link), but such a viewer is
  // not a member and never sees who the collaborators are.
  if (r.owner_id === userId) return { exists: true, role: 'owner', member: true };
  if (r.collab_role) return { exists: true, role: r.collab_role, member: true };
  if (r.is_public) return { exists: true, role: 'viewer', member: false };
  return { exists: true, role: null, member: false };
}
const canView = (role) => role === 'owner' || role === 'editor' || role === 'viewer';
const canEdit = (role) => role === 'owner' || role === 'editor';

// Require at least view (else 404, which also hides existence from non-members) /
// edit (404 if not a member, 403 if a viewer) access; returns the role.
async function requireView(userId, playlistId) {
  const a = await getAccess(userId, playlistId);
  if (!a.exists || !canView(a.role)) notFound();
  return a.role;
}
async function requireEdit(userId, playlistId) {
  const a = await getAccess(userId, playlistId);
  if (!a.exists || !canView(a.role)) notFound();
  if (!canEdit(a.role)) forbidden();
  return a.role;
}

export async function listPlaylists(userId) {
  // Owned playlists PLUS those the user collaborates on. `shared` is true when a
  // playlist has any collaborators (owner's view) or the caller is a collaborator.
  const { rows } = await query(`
    SELECT p.id, p.name, p.description, p.cover_track_id, p.created_at, p.updated_at, p.user_id AS owner_id,
           COALESCE(c.cnt, 0)::int  AS track_count,
           COALESCE(cc.ccnt, 0)::int AS collaborator_count,
           t.raw                    AS cover_raw,
           col.role                 AS my_role
    FROM playlists p
    LEFT JOIN (
      SELECT playlist_id, COUNT(*) AS cnt FROM playlist_tracks GROUP BY playlist_id
    ) c ON c.playlist_id = p.id
    LEFT JOIN (
      SELECT playlist_id, COUNT(*) AS ccnt FROM playlist_collaborators GROUP BY playlist_id
    ) cc ON cc.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = p.cover_track_id
    LEFT JOIN playlist_collaborators col ON col.playlist_id = p.id AND col.user_id = $1
    WHERE p.user_id = $1 OR col.user_id = $1
    ORDER BY p.updated_at DESC
  `, [userId]);
  return rows.map(r => {
    const mine = r.owner_id === userId;
    return {
      id:            r.id,
      name:          r.name,
      description:   r.description,
      trackCount:    r.track_count,
      coverImageUrl: r.cover_raw?.imageUrl ?? null,
      updatedAt:     Number(r.updated_at),
      role:          mine ? 'owner' : r.my_role,
      shared:        !mine || r.collaborator_count > 0,
    };
  });
}

export async function searchPlaylists(userId, q, { limit = 5 } = {}) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  // Match owned OR collaborated playlists by name OR by a contained track.
  const { rows } = await query(
    `SELECT p.id, p.name, p.cover_track_id, p.updated_at,
            COALESCE(c.cnt, 0)::int AS track_count,
            t.raw                   AS cover_raw
     FROM playlists p
     LEFT JOIN (
       SELECT playlist_id, COUNT(*) AS cnt FROM playlist_tracks GROUP BY playlist_id
     ) c ON c.playlist_id = p.id
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     LEFT JOIN playlist_collaborators col ON col.playlist_id = p.id AND col.user_id = $1
     WHERE (p.user_id = $1 OR col.user_id = $1)
       AND (p.name ILIKE $2
        OR EXISTS (
          SELECT 1 FROM playlist_tracks pt
          JOIN tracks tr ON tr.id = pt.track_id
          WHERE pt.playlist_id = p.id
            AND (tr.title ILIKE $2 OR tr.artist ILIKE $2)
        ))
     ORDER BY p.updated_at DESC
     LIMIT $3`,
    [userId, `%${term}%`, limit],
  );
  return rows.map(r => ({
    id:            r.id,
    name:          r.name,
    trackCount:    r.track_count,
    coverImageUrl: r.cover_raw?.imageUrl ?? null,
    updatedAt:     Number(r.updated_at),
  }));
}

// Load a playlist's meta + tracks (+ optionally collaborators) into the response
// shape, AFTER access has been decided by the caller. `role` is the viewer's role
// (owner | editor | viewer | null for an anonymous public viewer). Shared by the
// authed getPlaylist and the anonymous getPublicPlaylist so the shape stays in
// one place. The public path passes includeCollaborators:false — member identities
// are never exposed on a public link.
async function loadPlaylistView(id, { role = null, includeCollaborators = true } = {}) {
  const { rows: meta } = await query(
    `SELECT p.id, p.name, p.description, p.cover_track_id, p.updated_at, p.user_id AS owner_id,
            p.is_public, p.public_id,
            t.raw AS cover_raw, ou.name AS owner_name,
            (SELECT COUNT(*) FROM saved_playlists sp WHERE sp.playlist_id = p.id)::int AS save_count
     FROM playlists p
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     LEFT JOIN users  ou ON ou.id = p.user_id
     WHERE p.id = $1`,
    [id],
  );
  if (meta.length === 0) notFound();
  const { rows: trackRows } = await query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            pt.position, pt.added_at, pt.added_by, au.name AS added_by_name
     FROM playlist_tracks pt
     LEFT JOIN tracks t ON t.id = pt.track_id
     LEFT JOIN users  au ON au.id = pt.added_by
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC`,
    [id],
  );
  const tracks = trackRows
    .filter(r => r.id != null)
    .map(r => ({
      id:          r.id,
      title:       r.title,
      artist:      r.artist,
      album:       r.album,
      language:    r.language,
      durationSec: r.duration_sec,
      // Anonymous public viewers (role null) get NO stream URL — the public link
      // is a view-only teaser, not free unauthenticated streaming.
      streamUrl:   role ? r.stream_url : null,
      imageUrl:    r.raw?.imageUrl ?? null,
      // Who added this track — MEMBERS ONLY (gate on includeCollaborators, the
      // membership signal, NOT on role: a public-link viewer has role 'viewer'
      // but is not a member, and must never learn collaborator identities). Also
      // covers the anonymous /p/ path (includeCollaborators false there). Legacy
      // rows (pre-attribution) have no added_by → null, no chip shown.
      addedBy:     (includeCollaborators && r.added_by) ? { userId: r.added_by, name: r.added_by_name } : null,
    }));
  const row = meta[0];
  let collaborators = [];
  if (includeCollaborators) {
    const { rows: collabRows } = await query(
      `SELECT c.user_id, c.role, u.name
       FROM playlist_collaborators c JOIN users u ON u.id = c.user_id
       WHERE c.playlist_id = $1 ORDER BY c.added_at ASC`,
      [id],
    );
    collaborators = collabRows.map(c => ({ userId: c.user_id, name: c.name, role: c.role }));
  }
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description,
    trackCount:    tracks.length,
    coverImageUrl: row.cover_raw?.imageUrl ?? null,
    updatedAt:     Number(row.updated_at),
    saveCount:     Number(row.save_count ?? 0),
    role,                                   // the caller's role: owner | editor | viewer | null
    canEdit:       canEdit(role),
    shared:        collaborators.length > 0 || (!!role && role !== 'owner'),
    ownerName:     row.owner_name ?? null,
    isPublic:      row.is_public ?? false,
    publicId:      row.public_id ?? null,
    collaborators,
    tracks,
  };
}

export async function getPlaylist(userId, id) {
  const access = await getAccess(userId, id);
  if (!access.exists || !canView(access.role)) notFound();
  // Public-link viewers (not members) get a streaming read but no member list.
  return loadPlaylistView(id, { role: access.role, includeCollaborators: access.member });
}

// Anonymous, view-only fetch by the public share id. 404s (not 403) when the id
// is unknown OR the playlist isn't public — same "hide existence" posture as
// requireView. No auth, no collaborator list, role null (→ canEdit false).
export async function getPublicPlaylist(publicId) {
  const { rows } = await query(
    `SELECT id FROM playlists WHERE public_id = $1 AND is_public = TRUE`,
    [String(publicId ?? '')],
  );
  if (!rows.length) notFound();
  return loadPlaylistView(rows[0].id, { role: null, includeCollaborators: false });
}

// Owner toggles public visibility. Enabling mints a public_id on first use and
// reuses it on re-enable (old links revive); disabling keeps the id but the
// public fetch requires is_public = TRUE, so the link 404s while off.
export async function setPlaylistVisibility(userId, id, isPublic) {
  const access = await getAccess(userId, id);
  if (!access.exists) notFound();
  if (access.role !== 'owner') forbidden('only the owner can change who can see this playlist');
  const { rows } = isPublic
    ? await pool.query(
        `UPDATE playlists SET is_public = TRUE, public_id = COALESCE(public_id, $2)
         WHERE id = $1 RETURNING is_public, public_id`,
        [id, newPublicId()],
      )
    : await pool.query(
        `UPDATE playlists SET is_public = FALSE WHERE id = $1 RETURNING is_public, public_id`,
        [id],
      );
  return { isPublic: rows[0].is_public, publicId: rows[0].public_id };
}

// Cheap change cursor for collaboration polling — just the updated_at timestamp.
export async function getPlaylistRev(userId, id) {
  await requireView(userId, id);
  const { rows } = await query('SELECT updated_at FROM playlists WHERE id = $1', [id]);
  if (!rows.length) notFound();
  return { updatedAt: Number(rows[0].updated_at) };
}

export async function createPlaylist(userId, { name, description = null }) {
  const id = newId();
  const ts = Date.now();
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    const err = new Error('playlist name is required');
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO playlists (id, user_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, userId, trimmed, description, ts],
  );
  return { id, name: trimmed, description, trackCount: 0, coverImageUrl: null, updatedAt: ts, role: 'owner', shared: false };
}

export async function deletePlaylist(userId, id) {
  // Owner-only (destructive). CASCADE cleans tracks, collaborators, invites.
  const { rowCount } = await pool.query(
    `DELETE FROM playlists WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (rowCount === 0) notFound();
}

export async function addTrackToPlaylist(userId, playlistId, trackId) {
  await requireEdit(userId, playlistId);
  const ts = Date.now();
  // Append at end: position = max + 1, starting at 0 for empty playlist.
  // ON CONFLICT DO NOTHING means a duplicate add inserts 0 rows — surface a 409.
  const ins = await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, added_by)
     SELECT $1, $2, COALESCE(MAX(position), -1) + 1, $3, $4
     FROM playlist_tracks
     WHERE playlist_id = $1
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, ts, userId],
  );
  if (ins.rowCount === 0) {
    const { rows } = await query(`SELECT name FROM playlists WHERE id = $1`, [playlistId]);
    const name = rows[0]?.name ?? 'this playlist';
    const err = new Error(`already in ${name.toLowerCase()}`);
    err.statusCode = 409;
    err.code = 'duplicate';
    throw err;
  }
  // Touch updated_at (poll cursor); set cover only if not already set.
  await pool.query(
    `UPDATE playlists SET updated_at = $1, cover_track_id = COALESCE(cover_track_id, $2) WHERE id = $3`,
    [ts, trackId, playlistId],
  );
}

// Set the playlist cover to a chosen track's art (owner/editor). The track must
// be in the playlist. Custom uploaded images (P3) take precedence over this.
export async function setPlaylistCover(userId, playlistId, trackId) {
  await requireEdit(userId, playlistId);
  const { rows } = await query(
    `SELECT t.raw FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1 AND pt.track_id = $2`,
    [playlistId, trackId],
  );
  if (!rows.length) {
    const err = new Error("that track isn't in this playlist");
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    `UPDATE playlists SET cover_track_id = $2, updated_at = $3 WHERE id = $1`,
    [playlistId, trackId, Date.now()],
  );
  return { coverImageUrl: rows[0].raw?.imageUrl ?? null };
}

export async function removeTrackFromPlaylist(userId, playlistId, trackId) {
  await requireEdit(userId, playlistId);
  await pool.query(
    `DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId],
  );
  // If the removed track was the cover, fall back to position 0; always bump updated_at.
  await pool.query(
    `UPDATE playlists SET
       cover_track_id = CASE WHEN cover_track_id = $2
         THEN (SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC LIMIT 1)
         ELSE cover_track_id END,
       updated_at = $3
     WHERE id = $1`,
    [playlistId, trackId, Date.now()],
  );
}

// ── Collaboration ────────────────────────────────────────────────────
const validRole = (r) => r === 'editor' || r === 'viewer';

// Owner mints a share token (default 7-day expiry).
export async function createInvite(userId, playlistId, { role = 'editor' } = {}) {
  const access = await getAccess(userId, playlistId);
  if (!access.exists) notFound();
  if (access.role !== 'owner') forbidden('only the owner can share this playlist');
  const r = validRole(role) ? role : 'editor';
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  await pool.query(
    `INSERT INTO playlist_invites (token, playlist_id, created_by, role, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [token, playlistId, userId, r, expiresAt, now],
  );
  return { token, role: r, expiresAt };
}

// Accept a token → become a collaborator. Idempotent (re-accept updates role).
// Returns the inviter's name so the client can say "shared by <name>".
export async function acceptInvite(userId, token) {
  const { rows } = await query(
    `SELECT i.*, iu.name AS inviter_name
     FROM playlist_invites i LEFT JOIN users iu ON iu.id = i.created_by
     WHERE i.token = $1`,
    [String(token ?? '')],
  );
  if (!rows.length) {
    const err = new Error('this invite link is invalid');
    err.statusCode = 404;
    throw err;
  }
  const inv = rows[0];
  const inviterName = inv.inviter_name ?? null;
  if (Number(inv.expires_at) < Date.now()) {
    const err = new Error('this invite link has expired');
    err.statusCode = 410;
    throw err;
  }
  const { rows: pl } = await query('SELECT user_id, name FROM playlists WHERE id = $1', [inv.playlist_id]);
  if (!pl.length) notFound();
  // Owner accepting their own link is a no-op (they already have full access).
  if (pl[0].user_id === userId) return { playlistId: inv.playlist_id, name: pl[0].name, role: 'owner', inviterName };
  await pool.query(
    `INSERT INTO playlist_collaborators (playlist_id, user_id, role, added_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [inv.playlist_id, userId, inv.role, Date.now()],
  );
  return { playlistId: inv.playlist_id, name: pl[0].name, role: inv.role, inviterName };
}

// Owner removes any collaborator; a collaborator may remove themselves (leave).
export async function removeCollaborator(userId, playlistId, targetUserId) {
  const access = await getAccess(userId, playlistId);
  if (!access.exists) notFound();
  const isOwner = access.role === 'owner';
  if (!isOwner && targetUserId !== userId) forbidden('only the owner can remove collaborators');
  await pool.query(
    `DELETE FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2`,
    [playlistId, targetUserId],
  );
}

// ── Save to library (the lightweight "keep it, don't edit it" tier) ──
// Save any playlist you can view but don't own. Owners can't save their own.
export async function savePlaylist(userId, id) {
  const access = await getAccess(userId, id);
  if (!access.exists) notFound();
  if (access.role === 'owner') return { saved: false, own: true };
  if (!canView(access.role)) forbidden("this playlist isn't shared with you");
  await pool.query(
    `INSERT INTO saved_playlists (user_id, playlist_id, saved_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, playlist_id) DO NOTHING`,
    [userId, id, Date.now()],
  );
  return { saved: true };
}

export async function unsavePlaylist(userId, id) {
  await pool.query(`DELETE FROM saved_playlists WHERE user_id = $1 AND playlist_id = $2`, [userId, id]);
  return { saved: false };
}

// The user's saved (not owned, not collaborated) playlists. `accessible` is false
// when the owner has since unshared it — the row renders "no longer shared".
export async function listSavedPlaylists(userId) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.updated_at, p.user_id AS owner_id, p.is_public,
            ou.name AS owner_name,
            COALESCE(tc.cnt, 0)::int AS track_count,
            t.raw AS cover_raw,
            (p.is_public OR p.user_id = $1 OR col.user_id IS NOT NULL) AS accessible
     FROM saved_playlists sp
     JOIN playlists p ON p.id = sp.playlist_id
     LEFT JOIN users ou ON ou.id = p.user_id
     LEFT JOIN (SELECT playlist_id, COUNT(*) AS cnt FROM playlist_tracks GROUP BY playlist_id) tc ON tc.playlist_id = p.id
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     LEFT JOIN playlist_collaborators col ON col.playlist_id = p.id AND col.user_id = $1
     WHERE sp.user_id = $1
     ORDER BY sp.saved_at DESC`,
    [userId],
  );
  // An inaccessible (since-unshared) playlist leaks nothing current — the row
  // renders "no longer shared" from the flag alone, so don't ship its live
  // name/count/cover/owner (which may have changed after it was revoked).
  return rows.map(r => r.accessible
    ? {
        id:            r.id,
        name:          r.name,
        trackCount:    r.track_count,
        coverImageUrl: r.cover_raw?.imageUrl ?? null,
        updatedAt:     Number(r.updated_at),
        ownerName:     r.owner_name ?? null,
        accessible:    true,
      }
    : { id: r.id, name: null, trackCount: 0, coverImageUrl: null, updatedAt: null, ownerName: null, accessible: false });
}

// "Only you" — the hard-private state. Owner-only: revoke every collaborator,
// kill all outstanding invite tokens, and turn the public link off. A complete
// severing of every sharing path in one call.
export async function setPlaylistOnlyMe(userId, playlistId) {
  const access = await getAccess(userId, playlistId);
  if (!access.exists) notFound();
  if (access.role !== 'owner') forbidden('only the owner can change who can see this playlist');
  await pool.query(`DELETE FROM playlist_collaborators WHERE playlist_id = $1`, [playlistId]);
  await pool.query(`DELETE FROM playlist_invites WHERE playlist_id = $1`, [playlistId]);
  await pool.query(`UPDATE playlists SET is_public = FALSE WHERE id = $1`, [playlistId]);
  return { isPublic: false, onlyMe: true };
}
