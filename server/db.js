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
// keepAlive lets the OS probe the socket so a connection Neon reaped out-of-band
// is detected sooner (fewer dead-socket handoffs); max:2 + idleTimeout unchanged.
export const pool = new Pool({ connectionString: TARGET_URL, max: 2, idleTimeoutMillis: 10000, keepAlive: true });

// node-postgres REQUIRES a pool 'error' listener: an idle client whose backend
// socket is dropped out-of-band (routine on Neon's pooled endpoint, which reaps
// idle connections) emits 'error' on the pool. With no listener the EventEmitter
// rethrows as an uncaught exception and can take the process down. This converts
// it to a logged, non-fatal event — the next query re-acquires a fresh client.
// (security: #25)
pool.on('error', (err) => {
  console.error('[db] idle client error (non-fatal):', err?.message ?? err);
});

// ── Transient-error resilience ───────────────────────────────────────
// pool.on('error') only catches drops on IDLE clients. When a query grabs a
// socket Neon already reaped, the query itself rejects (ECONNRESET / ETIMEDOUT)
// straight to the caller — which, on an authed request, becomes a 500. These are
// blips, not real failures: a retry re-acquires a fresh client and succeeds.
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND',
]);

// True for a dropped/timed-out connection — NEVER for a SQL or constraint error
// (those carry a Postgres `code` like '23505'/'42601' and are deterministic, so
// retrying just burns time and re-trips the same fault). Node may also surface the
// connect timeout as an AggregateError whose `.errors[]` hold the real codes.
export function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code) || TRANSIENT_CODES.has(err.errno)) return true;
  if (Array.isArray(err.errors) && err.errors.some(isTransient)) return true;
  return /Connection terminated|terminating connection|server closed the connection|Client has encountered a connection error/i
    .test(String(err.message ?? ''));
}

// Drop-in for pool.query that retries ONLY transient connection drops with a short
// exponential backoff. Safe for idempotent reads and single-statement writes (the
// heartbeat UPDATE is idempotent). Multi-statement transactions must retry at the
// transaction boundary instead (see createSessionWithCap), not here.
export async function query(text, params, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (!isTransient(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

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
  async function v11_family_mode(client) {
    // PIN-gated Family mode: hides explicit content + surfaces curated locked
    // sets; turning it OFF requires the PIN. The PIN is bcrypt-hashed (same cost
    // as passwords); attempts/locked_until throttle disable guesses per-account.
    await client.query(`
      ALTER TABLE users ADD COLUMN family_mode BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN family_pin_hash TEXT;
      ALTER TABLE users ADD COLUMN family_pin_attempts INT NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN family_pin_locked_until BIGINT;
    `);
  },
  async function v12_playlist_collab(client) {
    // Shared-playlist collaboration. A playlist stays single-OWNER (playlists.
    // user_id); collaborators get per-user edit/view access. Invites are
    // token-based share links with an expiry. The client polls playlists.
    // updated_at (bumped on every edit) to sync collaborators' views.
    await client.query(`
      CREATE TABLE playlist_collaborators (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
        role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor')),
        added_at    BIGINT NOT NULL,
        PRIMARY KEY (playlist_id, user_id)
      );
      CREATE INDEX idx_pl_collab_user ON playlist_collaborators(user_id);

      CREATE TABLE playlist_invites (
        token       TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor')),
        expires_at  BIGINT NOT NULL,
        created_at  BIGINT NOT NULL
      );
      CREATE INDEX idx_pl_invites_playlist ON playlist_invites(playlist_id);
    `);
  },
  async function v13_listening_modes(client) {
    // Listening modes: switchable contexts (everyday/family/bhakti/trip/focus/kids),
    // each seeded by real artists → the provider similarity graph, with its own
    // explicit policy + optional PIN. active_mode = the user's current context;
    // modes_state holds per-mode { pinHash, pinAttempts, lockedUntil, explicitOff }.
    // The old PIN-gated Family mode folds in → backfilled below.
    // We also start CAPTURING signal from day one (before learning uses it):
    // listening_events.mode tags behaviour per context; track_similarity
    // accumulates our own copy of the provider's similarity graph; track_features
    // is reserved (empty) for a future audio/embedding engine.
    await client.query(`
      ALTER TABLE users ADD COLUMN active_mode TEXT NOT NULL DEFAULT 'everyday';
      ALTER TABLE users ADD COLUMN modes_state JSONB NOT NULL DEFAULT '{}'::jsonb;

      UPDATE users SET modes_state = jsonb_build_object(
        'family', jsonb_strip_nulls(jsonb_build_object(
          'pinHash',     family_pin_hash,
          'pinAttempts', family_pin_attempts,
          'lockedUntil', family_pin_locked_until,
          'explicitOff', true
        ))
      ) WHERE family_mode = TRUE;

      ALTER TABLE listening_events ADD COLUMN mode TEXT;
      CREATE INDEX idx_events_user_mode_ts ON listening_events(user_id, mode, ts DESC);

      CREATE TABLE track_similarity (
        source_track_id  TEXT NOT NULL,
        related_track_id TEXT NOT NULL,
        provenance       TEXT NOT NULL,
        rank             INT,
        observed_at      BIGINT NOT NULL,
        PRIMARY KEY (source_track_id, related_track_id, provenance)
      );
      CREATE INDEX idx_track_sim_source ON track_similarity(source_track_id);

      CREATE TABLE track_features (
        track_id   TEXT PRIMARY KEY,
        features   JSONB,
        updated_at BIGINT
      );
    `);
  },
  async function v14_security_hardening(client) {
    // Session revocation + per-account login throttle.
    // token_version is embedded as a JWT claim and compared on every authed
    // request; bumping it (password reset / "log out everywhere") invalidates
    // every outstanding token for that user — the kill switch the stateless JWT
    // lacked. failed_login_attempts / login_locked_until mirror the family-PIN
    // throttle so credential guessing is bounded per-ACCOUNT (not just per-IP),
    // independent of the in-memory rate limiter. (security: M2 / #4)
    await client.query(`
      ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN login_locked_until BIGINT;
    `);
  },
  async function v15_sensing_preference(client) {
    // User toggle for the "sensing" welcome intro (the animated mood-reveal shown
    // before home on mobile/tablet). DEFAULT TRUE preserves today's behaviour for
    // every existing account; the client adds a once-per-day + tap-to-skip cadence
    // on top of this on/off flag.
    await client.query(`
      ALTER TABLE users ADD COLUMN show_sensing BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  },
  async function v16_playlist_public_links(client) {
    // Public, view-only sharing. is_public gates anonymous read access; public_id
    // is a SEPARATE unguessable CSPRNG token used in the share URL (/p/:public_id)
    // so the weak internal pl_ id is never exposed and links can't be enumerated.
    // public_id is minted lazily the first time a playlist is made public and kept
    // on toggle-off so re-enabling revives the same link. This is independent of
    // the collaborator/invite model (v12) — a playlist can be publicly viewable
    // AND have editor collaborators.
    await client.query(`
      ALTER TABLE playlists ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE playlists ADD COLUMN public_id TEXT UNIQUE;
    `);
  },
  async function v17_user_sessions(client) {
    // Per-login session rows so the stateless JWT gains a server-side handle: the
    // token now carries a `sid` claim validated against this table, enabling device
    // listing, per-device logout, and a hard concurrent-device CAP (none possible
    // before). token_version stays the global "log out everywhere" kill switch;
    // deleting/revoking a row kills exactly one device. Tokens minted before this
    // (no sid) keep working via the token_version check alone until they expire.
    // The now-playing columns (playing_*) back Wave 2's cross-device awareness +
    // resume, so the device row doubles as the per-device now-playing registry —
    // no separate table or push channel. city/country come from Vercel's
    // x-vercel-ip-* headers (no external geo dependency).
    await client.query(`
      CREATE TABLE user_sessions (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_label  TEXT,
        user_agent    TEXT,
        ip            TEXT,
        city          TEXT,
        country       TEXT,
        created_at    BIGINT NOT NULL,
        last_seen_at  BIGINT NOT NULL,
        revoked_at    BIGINT,
        playing_track JSONB,
        is_playing    BOOLEAN NOT NULL DEFAULT FALSE,
        playing_at    BIGINT,
        position_sec  REAL
      );
      CREATE INDEX idx_user_sessions_user ON user_sessions(user_id) WHERE revoked_at IS NULL;
    `);
  },
  async function v18_lyric_gen_attempts(client) {
    // Per-user daily ceiling on lyric-generation dispatches so one account can't
    // drain the GLOBAL daily cap (lyric_jobs is per-track/shared, so it can't
    // attribute spend to a user on its own). One row per (user, track); the 24h
    // COUNT bounds how many DISTINCT tracks a user can trigger generation for.
    await client.query(`
      CREATE TABLE lyric_gen_attempts (
        user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL,
        ts       BIGINT NOT NULL,
        PRIMARY KEY (user_id, track_id)
      );
      CREATE INDEX idx_lyric_gen_user_ts ON lyric_gen_attempts(user_id, ts);
    `);
  },
  async function v19_listening_event_source(client) {
    // Capture WHERE a play came from (the queue's source label — "tonight's set",
    // a playlist name, search, a station, …). Pure signal capture for the future
    // recommendation engine — nothing reads it yet; it just stops us throwing away
    // provenance we already have on the client. Nullable; old rows stay NULL.
    await client.query(`ALTER TABLE listening_events ADD COLUMN source TEXT`);
  },
  async function v20_mood_infer_claim(client) {
    // Cross-device de-dupe for the auto mood inference: an atomic, self-expiring
    // claim so two devices crossing the staleness threshold within the Gemini-call
    // window don't BOTH infer (a read-only check can't catch that concurrent case).
    await client.query(`ALTER TABLE users ADD COLUMN mood_inferring_at BIGINT`);
  },
  async function v21_device_and_delete_stepup(client) {
    // Wave 3 security extras — all additive / backward-compatible (old instances keep
    // working during a rolling deploy; every column is nullable or defaulted).
    // - user_sessions.device_id: opaque persistent-device id (from the `aura_device`
    //   cookie) so signing in on an UNrecognized device can raise a heads-up email.
    // - users.delete_attempts / delete_locked_until: an ISOLATED step-up lockout for
    //   account deletion — dedicated columns so it can't cross-lock the login throttle.
    await client.query(`ALTER TABLE user_sessions ADD COLUMN device_id TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN delete_attempts INT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN delete_locked_until BIGINT`);
    // Widen the OTP purpose CHECK so a 'delete' step-up code can be issued — the
    // inline constraint (auto-named email_otps_purpose_check) pins signup/reset, so a
    // 'delete' INSERT would fail with 23514 until this runs.
    await client.query(`ALTER TABLE email_otps DROP CONSTRAINT IF EXISTS email_otps_purpose_check`);
    await client.query(`ALTER TABLE email_otps ADD CONSTRAINT email_otps_purpose_check
      CHECK (purpose IN ('signup','reset','delete'))`);
  },
  async function v22_mix_editions_and_hidden(client) {
    // "Made for you" mixes (server/autoPlaylists.js + tasteScore.js).
    // - mix_editions: per-user dated snapshots of each generated mix, the
    //   journal_cache pattern generalised — payload keeps trackId+reason only
    //   (rows re-hydrate via JOIN tracks at read so metadata stays fresh).
    //   Editions are never deleted: past editions are the archive.
    // - hidden_tracks: the explicit "don't show this again" contract — a hard
    //   exclusion from every mix and auto-radio pick, visible and undoable in
    //   Settings (unlike skip-shelving, which is implicit and self-healing).
    await client.query(`
      CREATE TABLE mix_editions (
        user_id      TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mix_key      TEXT   NOT NULL,
        edition_key  TEXT   NOT NULL,
        payload      JSONB  NOT NULL,
        generated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, mix_key, edition_key)
      );
      CREATE INDEX idx_mix_editions_latest ON mix_editions(user_id, mix_key, generated_at DESC);
      CREATE TABLE hidden_tracks (
        user_id   TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id  TEXT   NOT NULL,
        hidden_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, track_id)
      );
    `);
  },
  async function v23_impressions(client) {
    // What the home surfaces SHOWED you, per user-local day — the signal AURA
    // never captured. It lets the quick-picks ranker demote picks we've shown
    // repeatedly but you never played (YouTube's "churn"), so the ring keeps
    // moving instead of re-serving the same discs. SHOWN-only (no new listening
    // data); the daily cron prunes rows past 90 days.
    await client.query(`
      CREATE TABLE impressions (
        user_id  TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id TEXT   NOT NULL,
        surface  TEXT   NOT NULL,
        day      TEXT   NOT NULL,
        count    INT    NOT NULL DEFAULT 1,
        first_ts BIGINT NOT NULL,
        last_ts  BIGINT NOT NULL,
        PRIMARY KEY (user_id, track_id, surface, day)
      );
      CREATE INDEX idx_impressions_user_surface ON impressions(user_id, surface, last_ts DESC);
    `);
  },
  async function v24_playlist_track_added_by(client) {
    // Per-track attribution for collab playlists — "who added this song".
    // Nullable + ON DELETE SET NULL: existing rows stay NULL (no retroactive
    // attribution — the UI simply shows no chip for them), and if the adder's
    // account is deleted the track stays put, just unattributed.
    await client.query(
      `ALTER TABLE playlist_tracks ADD COLUMN added_by TEXT REFERENCES users(id) ON DELETE SET NULL`,
    );
  },
  async function v25_saved_playlists(client) {
    // "Save someone's playlist to your library" — the lightweight middle tier of
    // sharing (want it in your library without editing it). Distinct from
    // collaboration (which grants edit) and from the anonymous public link.
    await client.query(`
      CREATE TABLE saved_playlists (
        user_id     TEXT   NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
        playlist_id TEXT   NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        saved_at    BIGINT NOT NULL,
        PRIMARY KEY (user_id, playlist_id)
      );
      CREATE INDEX idx_saved_playlists_playlist ON saved_playlists(playlist_id);
    `);
  },
  async function v26_playlist_cover_image(client) {
    // A custom uploaded cover (Vercel Blob URL). Takes precedence over the
    // cover_track_id art; nullable, so a playlist without one falls back to a
    // chosen/first track's art exactly as before.
    await client.query(`ALTER TABLE playlists ADD COLUMN cover_image_url TEXT`);
  },
  async function v27_user_avatar(client) {
    // A profile photo (Vercel Blob URL). Nullable — no avatar falls back to the
    // initial-letter monogram everywhere it's shown.
    await client.query(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
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
