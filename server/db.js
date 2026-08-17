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

// ── pool.query retries transient drops itself ────────────────────────
// The audit (reports/02-review.md C3/A4) found 133 direct pool.query calls
// against 66 uses of the query() wrapper below — the retry existed but two
// thirds of the codebase silently bypassed it, because nothing at a call site
// says which of the two you should have used. Converting 133 call sites meant
// rewriting ~65 test assertions that mock pool.query (attempted, reverted).
// So the choice is removed instead: the pool's own query() now carries the
// SAME narrow retry — transient connection drops only, never SQL errors (see
// isTransient below) — and both spellings behave identically.
//
// Scope guards, load-bearing:
// - Only the promise form is wrapped; a callback-style call (pg supports one)
//   passes through untouched rather than being retried half-observed. Nothing
//   in this repo uses callbacks, but the guard keeps a future one honest.
// - Transactions are unaffected by construction: they run on a dedicated
//   client from pool.connect() (see createSessionWithCap), and client.query
//   is not wrapped — multi-statement retry stays at the transaction boundary.
// - query({retries: 0}) remains a REAL opt-out (listening-events and
//   impressions use it: non-idempotent INSERTs with no unique key, where a
//   transient-socket replay could double-insert) — it runs against the raw
//   pool, not the retrying wrapper, so 0 means 0.
const rawPoolQuery = pool.query.bind(pool);

async function retryTransient(args, retries) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawPoolQuery(...args);
    } catch (err) {
      if (!isTransient(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

pool.query = function retryingPoolQuery(...args) {
  if (typeof args[args.length - 1] === 'function') {
    return rawPoolQuery(...args);
  }
  return retryTransient(args, 2);
};

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
  // Against the RAW pool: pool.query above already retries, and stacking the
  // two loops would compound attempts (3×3) — and would turn retries:0 into
  // a lie. One loop, one knob.
  return retryTransient([text, params], retries);
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
  async function v28_track_loudness(client) {
    // Per-track integrated loudness (BS.1770 via ffmpeg ebur128), measured
    // ONCE from the 320 kbps stream and then shared by every listener — the
    // data that powers volume leveling in the clients (JioSaavn provides
    // none). The row is also a claim/state machine so concurrent serverless
    // measure runs never duplicate the work: pending (claimed) → done |
    // failed; stale pending rows and failed rows under the retry cap are
    // re-claimable (server/loudness.js).
    await client.query(`
      CREATE TABLE track_loudness (
        track_id    TEXT   PRIMARY KEY,
        status      TEXT   NOT NULL DEFAULT 'pending',
        lufs        REAL,
        true_peak   REAL,
        tries       INT    NOT NULL DEFAULT 0,
        claimed_at  BIGINT NOT NULL,
        measured_at BIGINT
      );
    `);
  },
  async function v29_track_stems(client) {
    // Karaoke "music only": a per-track instrumental, separated ONCE from the
    // 320 kbps stream by an external service (MVSEP free queue) and cached in
    // Vercel Blob for every listener forever. The row is a claim/state machine
    // the clients' own polls drive forward, with atomic transitions guarding
    // each cost-bearing step against duplicate work:
    //   queued     — claimed, waiting for the free tier's single job slot
    //   submitting — one winner is calling MVSEP create (blocks double-submit)
    //   submitted  — MVSEP working (hash stored); in-progress polls heartbeat
    //   storing    — one winner is downloading + uploading to Blob
    //   done        — instrumental cached (instrumental_url)
    //   failed      — re-claimable while tries < cap
    // See server/stems.js.
    await client.query(`
      CREATE TABLE track_stems (
        track_id         TEXT   PRIMARY KEY,
        status           TEXT   NOT NULL DEFAULT 'queued',
        hash             TEXT,
        instrumental_url TEXT,
        tries            INT    NOT NULL DEFAULT 0,
        claimed_at       BIGINT NOT NULL,
        done_at          BIGINT
      );
    `);
  },
  async function v30_push_tokens(client) {
    // FCM device registrations (native app). One row per device token; a
    // token moving between accounts re-homes on conflict (last sign-in wins,
    // matching how the device itself behaves). Dead tokens are pruned by the
    // sender when FCM reports them unregistered (server/push.js).
    await client.query(`
      CREATE TABLE push_tokens (
        token        TEXT   PRIMARY KEY,
        user_id      TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform     TEXT   NOT NULL DEFAULT 'android',
        created_at   BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL
      );
      CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
    `);
  },
  async function v31_notification_policy(client) {
    // Triggered pushes (server/notify.js) need two per-user pieces of state:
    // which categories the user wants (absent row = everything on, the product
    // default — so the table only holds users who touched the switches), and a
    // log of delivered sends that enforces the frequency caps in
    // server/push.js sendCategory. push_log rows older than 30 days are pruned
    // by the daily cron.
    await client.query(`
      CREATE TABLE notification_prefs (
        user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        mixes      BOOLEAN NOT NULL DEFAULT TRUE,
        social     BOOLEAN NOT NULL DEFAULT TRUE,
        nudges     BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at BIGINT  NOT NULL
      );
      CREATE TABLE push_log (
        user_id  TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT   NOT NULL,
        sent_at  BIGINT NOT NULL
      );
      CREATE INDEX idx_push_log_user ON push_log(user_id, category, sent_at DESC);
    `);
  },
  async function v32_notifications(client) {
    // In-app notification feed (the bell/panel) — a durable log of the SAME
    // cards the push triggers compose (server/notify.js), so a card is never
    // lost to a quiet phone, a missing token, or a muted category: the panel
    // is the always-on channel, independent of sendCategory's guardrails.
    // payload carries the composed card ({title, body, image, link}) so the
    // panel never has to re-derive it. seen_at NULL = unseen.
    await client.query(`
      CREATE TABLE notifications (
        id         BIGSERIAL PRIMARY KEY,
        user_id    TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT   NOT NULL CHECK (type IN ('mixes', 'social', 'note')),
        payload    JSONB  NOT NULL,
        created_at BIGINT NOT NULL,
        seen_at    BIGINT
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
    `);
  },
  async function v33_youtube_import(client) {
    // YouTube playlist/mix import (server/importJobs.js). Four tables, and the
    // split between them is load-bearing rather than tidiness:
    //
    //   yt_import_jobs   one row per paste. Survives the request that made it,
    //                    because a serverless function can't hold a 30-track
    //                    match to completion reliably.
    //   yt_import_items  one row per video. This is the RESUME CURSOR — a drain
    //                    tick that runs out of time leaves rows in 'pending'
    //                    and the next tick picks up exactly there. It is also
    //                    the review queue the user works through.
    //   yt_match_cache   fingerprint -> catalog track. Cross-user and permanent.
    //   yt_playlist_links  refresh bookkeeping, finite playlists only.
    //
    // RETENTION (why items and cache are separate tables at all): YouTube's
    // terms cap storage of YouTube data at 30 days. yt_import_items holds video
    // titles, channel names and descriptions, so the daily cron deletes rows for
    // jobs older than 30 days. yt_match_cache is keyed on a fingerprint of OUR
    // OWN derived parse — never a video id — so it is outside that rule and may
    // persist; the reasoning is recorded at ytMatch.js fingerprint(). Putting
    // the cache inside the items table would have made the whole matcher's
    // memory expire monthly, which is the opposite of what it is for.
    await client.query(`
      CREATE TABLE yt_import_jobs (
        id             TEXT   PRIMARY KEY,
        user_id        TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        yt_playlist_id TEXT   NOT NULL,
        kind           TEXT   NOT NULL,
        strategy       TEXT   NOT NULL,
        status         TEXT   NOT NULL,
        title          TEXT,
        windowed       BOOLEAN NOT NULL DEFAULT FALSE,
        playlist_id    TEXT   REFERENCES playlists(id) ON DELETE SET NULL,
        total_count    INTEGER NOT NULL DEFAULT 0,
        auto_count     INTEGER NOT NULL DEFAULT 0,
        review_count   INTEGER NOT NULL DEFAULT 0,
        unmatched_count INTEGER NOT NULL DEFAULT 0,
        units_spent    INTEGER NOT NULL DEFAULT 0,
        error          TEXT,
        -- A drain LEASE, deliberately separate from updated_at.
        --
        -- Two drains must not work the same job (they would pay for the same
        -- catalog searches twice), but a drain that stops because it ran out of
        -- TIME must be resumable immediately — the next client poll is the next
        -- worker. Overloading updated_at for both cannot express that: a
        -- budget-exhausted job looks freshly-updated, so a staleness check would
        -- refuse to resume it for the whole stuck-timeout. Measured on a live
        -- database before this column existed: tick 2 was turned away and the
        -- import sat idle.
        --
        -- So: a drain takes a lease, releases it on the way out, and a lease
        -- left behind by a killed invocation expires on its own.
        leased_until   BIGINT NOT NULL DEFAULT 0,
        created_at     BIGINT NOT NULL,
        updated_at     BIGINT NOT NULL
      );
      -- The reaper's query is exactly (status, leased_until).
      CREATE INDEX idx_yt_jobs_status ON yt_import_jobs(status, leased_until);
      CREATE INDEX idx_yt_jobs_user   ON yt_import_jobs(user_id, created_at DESC);

      CREATE TABLE yt_import_items (
        id          BIGSERIAL PRIMARY KEY,
        job_id      TEXT    NOT NULL REFERENCES yt_import_jobs(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        -- YouTube-derived, subject to the 30-day prune above.
        video_id    TEXT,
        yt_title    TEXT,
        yt_channel  TEXT,
        yt_duration INTEGER,
        -- Ours: the parse, the verdict, and the alternatives offered at review.
        fingerprint TEXT,
        tier        TEXT,
        track_id    TEXT,
        score       REAL,
        candidates  JSONB,
        state       TEXT    NOT NULL DEFAULT 'pending',
        UNIQUE (job_id, position)
      );
      -- The drain's inner loop is "next pending item for this job, in order".
      CREATE INDEX idx_yt_items_pending ON yt_import_items(job_id, state, position);

      CREATE TABLE yt_match_cache (
        fingerprint    TEXT   PRIMARY KEY,
        track_id       TEXT   NOT NULL,
        score          REAL,
        -- Set when a HUMAN picked this pairing on the review screen. A confirmed
        -- entry outranks a scored one on lookup, which is how real corrections
        -- beat the heuristic instead of being overwritten by it on the next run.
        user_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        hits           INTEGER NOT NULL DEFAULT 0,
        created_at     BIGINT NOT NULL,
        updated_at     BIGINT NOT NULL
      );

      CREATE TABLE yt_playlist_links (
        playlist_id     TEXT   PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
        yt_playlist_id  TEXT   NOT NULL,
        kind            TEXT   NOT NULL,
        last_item_count INTEGER,
        last_synced_at  BIGINT NOT NULL,
        created_at      BIGINT NOT NULL
      );
    `);
  },
  async function v34_yt_cache_language_check(client) {
    await client.query(`
      -- When this row last had its track's language checked against the
      -- importing user's languages (importJobs.resolveItem). NULL = never.
      --
      -- Exists because a wrong AUTO match is otherwise permanent: it seeds
      -- this cache at >= the auto threshold, every later import
      -- short-circuits on it BEFORE search or scoring run, review acceptance
      -- is the only writer that outranks it, and a wrong auto is never
      -- OFFERED for review. The language re-check is the escape hatch — and
      -- it must fire once per row, ever, or a correct-but-out-of-affinity
      -- playlist (an english list for a tamil-affinity listener) would pay a
      -- full re-search on every refresh, forever.
      ALTER TABLE yt_match_cache ADD COLUMN lang_checked_at BIGINT;

      -- Raw fetched video count, unavailable entries included. The refresh
      -- "nothing changed" guard compares YouTube's raw itemCount against
      -- yt_playlist_links.last_item_count, which finishJob wrote as the count
      -- of USABLE videos — so a playlist holding one deleted video mismatched
      -- forever and re-drained on every refresh press.
      ALTER TABLE yt_import_jobs ADD COLUMN fetched_count INTEGER;
    `);
  },
];

// What the CODE expects the schema to be. The admin console compares this to
// the meta row so "apply database updates" can show as pending vs current —
// the gap between the two is exactly the failure that took imports down when
// v34 shipped in code while prod sat at 33.
export const EXPECTED_SCHEMA_VERSION = migrations.length;

export async function getSchemaVersion() {
  try {
    const { rows } = await pool.query(`SELECT value FROM meta WHERE key = 'schema_version'`);
    return rows.length ? Number(rows[0].value) : 0;
  } catch {
    // No meta table yet — a pre-bootstrap database reads as version 0.
    return 0;
  }
}

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
