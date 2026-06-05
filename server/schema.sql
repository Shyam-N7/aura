-- AURA schema (Phase I, schema_version=1)
-- Run as the postgres superuser. Two steps because CREATE DATABASE cannot be
-- combined with table creation in the same connection.
--
-- Step 1 (from default 'postgres' database):
--   psql -U postgres -c "CREATE DATABASE aura;"
--
-- Step 2 (connect to aura, then run this file):
--   psql -U postgres -d aura -f server/schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
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

CREATE TABLE IF NOT EXISTS listening_events (
  id            BIGSERIAL PRIMARY KEY,
  track_id      TEXT NOT NULL,
  ts            BIGINT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('play','pause','skip','seek','end')),
  position_sec  REAL,
  mood          TEXT,
  language      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts    ON listening_events(ts);
CREATE INDEX IF NOT EXISTS idx_events_track ON listening_events(track_id);

CREATE TABLE IF NOT EXISTS preferences (
  id                INT PRIMARY KEY CHECK (id = 1),
  dj_name           TEXT  NOT NULL DEFAULT 'AURA',
  default_mood      TEXT  NOT NULL DEFAULT 'calm',
  language_weights  JSONB NOT NULL DEFAULT
    '{"tamil":0.25,"english":0.25,"hindi":0.2,"malayalam":0.15,"kannada":0.15}'::jsonb,
  ai_intensity      REAL  NOT NULL DEFAULT 0.6,
  updated_at        BIGINT NOT NULL
);

INSERT INTO preferences (id, updated_at)
  VALUES (1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
  ON CONFLICT (id) DO NOTHING;

-- Mark schema as initialized so the server's migration runner skips v1.
INSERT INTO meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT (key) DO NOTHING;

-- Verify
SELECT 'meta'              AS tbl, COUNT(*) FROM meta
UNION ALL SELECT 'tracks',           COUNT(*) FROM tracks
UNION ALL SELECT 'listening_events', COUNT(*) FROM listening_events
UNION ALL SELECT 'preferences',      COUNT(*) FROM preferences;
