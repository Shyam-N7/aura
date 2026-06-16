import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set. Create .env.local with DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/aura');
}

const TARGET_URL = process.env.DATABASE_URL;
const TARGET_DB = new URL(TARGET_URL).pathname.replace(/^\//, '') || 'aura';

async function ensureDatabase() {
  const adminUrl = new URL(TARGET_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [TARGET_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${TARGET_DB}"`);
    console.log(`AURA db: created database "${TARGET_DB}"`);
  }
  await admin.end();
}

// max:2 keeps each warm serverless instance to a couple of sockets so high
// concurrency (many instances) doesn't exhaust Postgres' connection limit.
// Point DATABASE_URL at a pooled endpoint (e.g. Neon's `-pooler` host) in
// production so those sockets are further multiplexed server-side.
export const pool = new Pool({ connectionString: TARGET_URL, max: 2, idleTimeoutMillis: 10000 });

const migrations = [
  async function v1_initial(client) {
    await client.query(`
      CREATE TABLE tracks (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        artist        TEXT NOT NULL,
        album         TEXT,
        language      TEXT,
        duration_sec  INTEGER,
        energy        REAL,
        valence       REAL,
        feel          TEXT,
        palette       JSONB,
        stream_url    TEXT,
        raw           JSONB,
        fetched_at    BIGINT NOT NULL
      );

      CREATE TABLE listening_events (
        id            BIGSERIAL PRIMARY KEY,
        track_id      TEXT NOT NULL,
        ts            BIGINT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('play','pause','skip','seek','end')),
        position_sec  REAL,
        mood          TEXT,
        language      TEXT
      );
      CREATE INDEX idx_events_ts ON listening_events(ts);
      CREATE INDEX idx_events_track ON listening_events(track_id);

      CREATE TABLE preferences (
        id                INT PRIMARY KEY CHECK (id = 1),
        dj_name           TEXT NOT NULL DEFAULT 'AURA',
        default_mood      TEXT NOT NULL DEFAULT 'calm',
        language_weights  JSONB NOT NULL DEFAULT
          '{"tamil":0.25,"english":0.25,"hindi":0.2,"malayalam":0.15,"kannada":0.15}'::jsonb,
        ai_intensity      REAL NOT NULL DEFAULT 0.6,
        updated_at        BIGINT NOT NULL
      );
      INSERT INTO preferences (id, updated_at)
        VALUES (1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT);
    `);
  },
  async function v2_lyrics_and_why(client) {
    await client.query(`
      CREATE TABLE lyrics (
        track_id   TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        synced     BOOLEAN NOT NULL,
        payload    JSONB NOT NULL,
        fetched_at BIGINT NOT NULL
      );
      CREATE TABLE why_cache (
        track_id   TEXT NOT NULL,
        mood       TEXT NOT NULL,
        payload    JSONB NOT NULL,
        fetched_at BIGINT NOT NULL,
        PRIMARY KEY (track_id, mood)
      );
    `);
  },
  async function v3_journal_cache(client) {
    await client.query(`
      CREATE TABLE journal_cache (
        date        TEXT PRIMARY KEY,
        payload     JSONB NOT NULL,
        events_seen INT NOT NULL,
        fetched_at  BIGINT NOT NULL
      );
    `);
  },
  async function v4_personal_collection(client) {
    await client.query(`
      CREATE TABLE liked_tracks (
        track_id TEXT PRIMARY KEY,
        liked_at BIGINT NOT NULL
      );
      CREATE INDEX idx_likes_liked_at ON liked_tracks(liked_at DESC);

      CREATE TABLE playlists (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        cover_track_id TEXT,
        created_at     BIGINT NOT NULL,
        updated_at     BIGINT NOT NULL
      );

      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    TEXT NOT NULL,
        position    INT NOT NULL,
        added_at    BIGINT NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );
      CREATE INDEX idx_pl_tracks_order ON playlist_tracks(playlist_id, position);
    `);
  },
  async function v5_mood_snapshots(client) {
    await client.query(`
      CREATE TABLE mood_snapshots (
        id           BIGSERIAL PRIMARY KEY,
        ts           BIGINT NOT NULL,
        mood         TEXT NOT NULL,
        confidence   REAL NOT NULL,
        drift        TEXT,
        events_seen  INT NOT NULL
      );
      CREATE INDEX idx_mood_snapshots_ts ON mood_snapshots(ts DESC);
    `);
  },
  async function v6_multi_user(client) {
    await client.query(`
      CREATE TABLE users (
        id              TEXT PRIMARY KEY,
        email           TEXT UNIQUE NOT NULL,
        name            TEXT NOT NULL,
        password_hash   TEXT,
        google_sub      TEXT UNIQUE,
        created_at      BIGINT NOT NULL,
        last_login_at   BIGINT,
        has_onboarded   BOOLEAN NOT NULL DEFAULT FALSE,
        seed_artists    JSONB NOT NULL DEFAULT '[]'::jsonb,
        seed_languages  JSONB NOT NULL DEFAULT '[]'::jsonb,
        seed_mood       TEXT,
        dj_name         TEXT NOT NULL DEFAULT 'AURA'
      );
      CREATE INDEX idx_users_email ON users(email);

      DROP TABLE IF EXISTS mood_snapshots CASCADE;
      DROP TABLE IF EXISTS journal_cache CASCADE;
      DROP TABLE IF EXISTS playlist_tracks CASCADE;
      DROP TABLE IF EXISTS playlists CASCADE;
      DROP TABLE IF EXISTS liked_tracks CASCADE;
      DROP TABLE IF EXISTS listening_events CASCADE;
      DROP TABLE IF EXISTS preferences CASCADE;

      CREATE TABLE listening_events (
        id            BIGSERIAL PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id      TEXT NOT NULL,
        ts            BIGINT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('play','pause','skip','seek','end')),
        position_sec  REAL,
        mood          TEXT,
        language      TEXT
      );
      CREATE INDEX idx_events_user_ts ON listening_events(user_id, ts DESC);
      CREATE INDEX idx_events_track ON listening_events(track_id);

      CREATE TABLE liked_tracks (
        user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        liked_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, track_id)
      );
      CREATE INDEX idx_likes_user ON liked_tracks(user_id, liked_at DESC);

      CREATE TABLE playlists (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        description    TEXT,
        cover_track_id TEXT,
        created_at     BIGINT NOT NULL,
        updated_at     BIGINT NOT NULL
      );
      CREATE INDEX idx_playlists_user ON playlists(user_id);

      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    TEXT NOT NULL,
        position    INT NOT NULL,
        added_at    BIGINT NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );
      CREATE INDEX idx_pl_tracks_order ON playlist_tracks(playlist_id, position);

      CREATE TABLE mood_snapshots (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ts           BIGINT NOT NULL,
        mood         TEXT NOT NULL,
        confidence   REAL NOT NULL,
        drift        TEXT,
        events_seen  INT NOT NULL
      );
      CREATE INDEX idx_mood_user_ts ON mood_snapshots(user_id, ts DESC);

      CREATE TABLE journal_cache (
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date        TEXT NOT NULL,
        payload     JSONB NOT NULL,
        events_seen INT NOT NULL,
        fetched_at  BIGINT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
    `);
  },
  async function v7_email_otp(client) {
    await client.query(`
      -- Email ownership verification. ADD with DEFAULT TRUE back-fills every
      -- existing account to verified (no lockout), then flip the default to
      -- FALSE so all FUTURE signups (which never list this column) start
      -- unverified until they enter an emailed code.
      ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE;

      -- Short-lived one-time codes for signup verification and password reset.
      -- code_hash is sha256 hex (never plaintext); the brute-force defense is
      -- the attempts cap + expiry, not hash cost.
      CREATE TABLE email_otps (
        id          BIGSERIAL PRIMARY KEY,
        email       TEXT   NOT NULL,
        code_hash   TEXT   NOT NULL,
        purpose     TEXT   NOT NULL DEFAULT 'signup' CHECK (purpose IN ('signup','reset')),
        attempts    INT    NOT NULL DEFAULT 0,
        expires_at  BIGINT NOT NULL,
        created_at  BIGINT NOT NULL
      );
      CREATE INDEX idx_email_otps_lookup ON email_otps(email, purpose, created_at DESC);
      CREATE INDEX idx_email_otps_expiry ON email_otps(expires_at);
    `);
  },
  async function v8_mood_reason(client) {
    // Song-grounded one-liner explaining the inferred mood (the "reading you" read).
    await client.query(`ALTER TABLE mood_snapshots ADD COLUMN reason TEXT`);
  },
  async function v9_lyric_jobs(client) {
    // Queue for generating synced lyrics from audio when no provider has the song.
    // track_id PK = one job per track (natural dedupe; re-enqueue is an UPSERT).
    // The lyrics table's `source` column has no CHECK constraint, so the new
    // values 'pending'/'generated' it will carry need no schema change there.
    await client.query(`
      CREATE TABLE lyric_jobs (
        track_id    TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','processing','done','failed')),
        method      TEXT,            -- 'align' | 'asr'
        external_id TEXT,            -- Replicate prediction id
        attempts    INT  NOT NULL DEFAULT 0,
        confidence  REAL,
        error       TEXT,
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL
      );
      CREATE INDEX idx_lyric_jobs_status ON lyric_jobs(status, updated_at);
    `);
  },
  async function v10_lyrics_metrics(client) {
    // One row per /api/lyrics request: how long it took, whether it was a cache
    // hit, which provider answered, and whether it ended up synced. Lets us track
    // true fetch cost (cold p50/p95) and the cache-hit rate over time — the real
    // measure of whether prefetch is working.
    await client.query(`
      CREATE TABLE lyrics_metrics (
        id        BIGSERIAL PRIMARY KEY,
        track_id  TEXT NOT NULL,
        ts        BIGINT NOT NULL,
        ms        INTEGER NOT NULL,
        cache_hit BOOLEAN NOT NULL,
        source    TEXT,
        synced    BOOLEAN NOT NULL,
        ok        BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX idx_lyrics_metrics_ts ON lyrics_metrics(ts DESC);
    `);
  },
];

// Apply any pending migrations against an EXISTING database. Safe for managed/
// serverless Postgres (e.g. Neon) — it never creates the database. The local
// dev bootstrap (initDb) handles creation; production applies migrations once
// out-of-band via `npm run migrate` (server/migrate.js).
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const { rows } = await client.query(`SELECT value FROM meta WHERE key = 'schema_version'`);
    const current = rows.length ? Number(rows[0].value) : 0;
    const pending = migrations.slice(current);
    if (pending.length === 0) return current;

    await client.query('BEGIN');
    try {
      for (const m of pending) await m(client);
      const next = String(current + pending.length);
      await client.query(`
        INSERT INTO meta (key, value) VALUES ('schema_version', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [next]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return current + pending.length;
  } finally {
    client.release();
  }
}

// Local dev bootstrap: create the database if missing (admin connection), then
// migrate. NOT used on the serverless request path — there the database already
// exists and migrations are applied out-of-band via `npm run migrate`.
export async function initDb() {
  await ensureDatabase();
  return runMigrations();
}
