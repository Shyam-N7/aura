import { pool } from './db.js';

function newId() {
  return 'pl_' + Math.random().toString(36).slice(2, 10);
}

function newToken() {
  let s = 'inv_';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
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
  const { rows } = await pool.query(
    `SELECT p.user_id AS owner_id, c.role AS collab_role
     FROM playlists p
     LEFT JOIN playlist_collaborators c ON c.playlist_id = p.id AND c.user_id = $1
     WHERE p.id = $2`,
    [userId, playlistId],
  );
  if (!rows.length) return { exists: false, role: null };
  const r = rows[0];
  if (r.owner_id === userId) return { exists: true, role: 'owner' };
  if (r.collab_role) return { exists: true, role: r.collab_role };
  return { exists: true, role: null };
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
  const { rows } = await pool.query(`
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
    ORDER BY p.created_at DESC
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
  const { rows } = await pool.query(
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

export async function getPlaylist(userId, id) {
  const role = await requireView(userId, id);
  const { rows: meta } = await pool.query(
    `SELECT p.id, p.name, p.description, p.cover_track_id, p.updated_at, p.user_id AS owner_id,
            t.raw AS cover_raw, ou.name AS owner_name
     FROM playlists p
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     LEFT JOIN users  ou ON ou.id = p.user_id
     WHERE p.id = $1`,
    [id],
  );
  if (meta.length === 0) notFound();
  const { rows: trackRows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            pt.position, pt.added_at
     FROM playlist_tracks pt
     LEFT JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC`,
    [id],
  );
  const { rows: collabRows } = await pool.query(
    `SELECT c.user_id, c.role, u.name
     FROM playlist_collaborators c JOIN users u ON u.id = c.user_id
     WHERE c.playlist_id = $1 ORDER BY c.added_at ASC`,
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
      streamUrl:   r.stream_url,
      imageUrl:    r.raw?.imageUrl ?? null,
    }));
  const row = meta[0];
  const collaborators = collabRows.map(c => ({ userId: c.user_id, name: c.name, role: c.role }));
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description,
    trackCount:    tracks.length,
    coverImageUrl: row.cover_raw?.imageUrl ?? null,
    updatedAt:     Number(row.updated_at),
    role,                                   // the caller's role: owner | editor | viewer
    canEdit:       canEdit(role),
    shared:        collaborators.length > 0 || role !== 'owner',
    ownerName:     row.owner_name ?? null,
    collaborators,
    tracks,
  };
}

// Cheap change cursor for collaboration polling — just the updated_at timestamp.
export async function getPlaylistRev(userId, id) {
  await requireView(userId, id);
  const { rows } = await pool.query('SELECT updated_at FROM playlists WHERE id = $1', [id]);
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
    `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
     SELECT $1, $2, COALESCE(MAX(position), -1) + 1, $3
     FROM playlist_tracks
     WHERE playlist_id = $1
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, ts],
  );
  if (ins.rowCount === 0) {
    const { rows } = await pool.query(`SELECT name FROM playlists WHERE id = $1`, [playlistId]);
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

// Reorder to match `orderedTrackIds` (only ids already in the playlist move). A
// transaction keeps the positions consistent; there's no UNIQUE on position so
// transient overlaps during the rewrite are fine.
export async function reorderPlaylist(userId, playlistId, orderedTrackIds) {
  await requireEdit(userId, playlistId);
  if (!Array.isArray(orderedTrackIds) || !orderedTrackIds.length) {
    const err = new Error('order must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedTrackIds.length; i++) {
      await client.query(
        'UPDATE playlist_tracks SET position = $1 WHERE playlist_id = $2 AND track_id = $3',
        [i, playlistId, orderedTrackIds[i]],
      );
    }
    await client.query('UPDATE playlists SET updated_at = $1 WHERE id = $2', [Date.now(), playlistId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
export async function acceptInvite(userId, token) {
  const { rows } = await pool.query('SELECT * FROM playlist_invites WHERE token = $1', [String(token ?? '')]);
  if (!rows.length) {
    const err = new Error('this invite link is invalid');
    err.statusCode = 404;
    throw err;
  }
  const inv = rows[0];
  if (Number(inv.expires_at) < Date.now()) {
    const err = new Error('this invite link has expired');
    err.statusCode = 410;
    throw err;
  }
  const { rows: pl } = await pool.query('SELECT user_id, name FROM playlists WHERE id = $1', [inv.playlist_id]);
  if (!pl.length) notFound();
  // Owner accepting their own link is a no-op (they already have full access).
  if (pl[0].user_id === userId) return { playlistId: inv.playlist_id, name: pl[0].name, role: 'owner' };
  await pool.query(
    `INSERT INTO playlist_collaborators (playlist_id, user_id, role, added_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [inv.playlist_id, userId, inv.role, Date.now()],
  );
  return { playlistId: inv.playlist_id, name: pl[0].name, role: inv.role };
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
