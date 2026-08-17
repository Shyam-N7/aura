import { pool } from './db.js';
import { getSongDetails } from './catalog.js';

function rowToTrack(row) {
  const raw = row.raw ?? {};
  return {
    id:          row.id,
    title:       row.title,
    artist:      row.artist,
    album:       row.album,
    language:    row.language,
    durationSec: row.duration_sec,
    streamUrl:   row.stream_url,
    imageUrl:    raw.imageUrl ?? null,
    energy:      row.energy,
    valence:     row.valence,
    feel:        row.feel,
    palette:     row.palette,
  };
}

async function upsert(track) {
  await pool.query(`
    INSERT INTO tracks (id, title, artist, album, language, duration_sec, stream_url, raw, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      title        = EXCLUDED.title,
      artist       = EXCLUDED.artist,
      album        = EXCLUDED.album,
      language     = EXCLUDED.language,
      duration_sec = EXCLUDED.duration_sec,
      stream_url   = EXCLUDED.stream_url,
      raw          = EXCLUDED.raw,
      fetched_at   = EXCLUDED.fetched_at
  `, [
    track.id, track.title, track.artist, track.album, track.language,
    track.durationSec, track.streamUrl,
    // Carry the explicit flag when the source knew it (mapRecoSong/search do) —
    // discovery re-checks it on cached candidates; absent = unknown, not clean.
    JSON.stringify(track.explicit === true
      ? { imageUrl: track.imageUrl, explicit: true }
      : { imageUrl: track.imageUrl }),
    Date.now(),
  ]);
}

export async function cacheTracks(tracks) {
  // One multi-row statement, not one round trip per track. The import drain
  // calls this per matched song with up to four rows; against a remote
  // database the per-row spelling billed up to four network round trips for
  // what is a single VALUES list. Last-write-wins on duplicate ids within one
  // call is fine — they carry the same payload.
  const usable = [];
  const seen = new Set();
  for (const t of tracks) {
    if (t?.id && !seen.has(t.id)) {
      seen.add(t.id);
      usable.push(t);
    }
  }
  if (!usable.length) return;
  const ts = Date.now();
  const params = [];
  const rows = usable.map(track => {
    const base = params.length;
    params.push(
      track.id, track.title, track.artist, track.album, track.language,
      track.durationSec, track.streamUrl,
      JSON.stringify(track.explicit === true
        ? { imageUrl: track.imageUrl, explicit: true }
        : { imageUrl: track.imageUrl }),
      ts,
    );
    return `(${Array.from({ length: 9 }, (_, i) => `$${base + i + 1}`).join(',')})`;
  });
  try {
    await pool.query(`
      INSERT INTO tracks (id, title, artist, album, language, duration_sec, stream_url, raw, fetched_at)
      VALUES ${rows.join(',')}
      ON CONFLICT (id) DO UPDATE SET
        title        = EXCLUDED.title,
        artist       = EXCLUDED.artist,
        album        = EXCLUDED.album,
        language     = EXCLUDED.language,
        duration_sec = EXCLUDED.duration_sec,
        stream_url   = EXCLUDED.stream_url,
        raw          = EXCLUDED.raw,
        fetched_at   = EXCLUDED.fetched_at
    `, params);
  } catch (err) {
    console.error('cacheTracks upsert failed', usable.map(t => t.id).join(','), err.message);
  }
}

export async function getTrackById(id) {
  const { rows } = await pool.query('SELECT * FROM tracks WHERE id = $1', [id]);
  if (rows.length) return rowToTrack(rows[0]);

  const tracks = await getSongDetails([id]);
  if (tracks.length === 0) {
    const err = new Error(`track not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  await upsert(tracks[0]);
  return tracks[0];
}
