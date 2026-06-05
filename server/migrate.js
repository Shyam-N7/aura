// One-off migration runner for deploys. Unlike the local dev bootstrap
// (initDb), this does NOT create the database — managed/serverless Postgres
// (e.g. Neon) provisions the database for you, and CREATE DATABASE needs admin
// privileges those endpoints don't grant. It only applies pending migrations.
//
// Usage (point DATABASE_URL at the target DB first). For Neon, use the DIRECT
// (non-pooled) connection string here — multi-statement DDL runs cleaner off
// the transaction pooler; the app itself uses the pooled (`-pooler`) endpoint.
//   PowerShell:  $env:DATABASE_URL="postgresql://...";  npm run migrate
//   bash:        DATABASE_URL="postgresql://..." npm run migrate
import { runMigrations, pool } from './db.js';

try {
  const version = await runMigrations();
  console.log(`AURA migrations applied — schema_version=${version}`);
} finally {
  await pool.end();
}
