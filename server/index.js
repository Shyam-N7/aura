// Local dev entry point. Bootstraps the database (creates it if missing + runs
// migrations) then starts the long-lived Express server on PORT. Production
// runs the SAME app (./app.js) as a stateless Vercel function — see
// api/[...path].js — with migrations applied once via `npm run migrate`.
import app from './app.js';
import { initDb } from './db.js';

const schemaVersion = await initDb();
console.log(`AURA db ready (schema_version=${schemaVersion})`);

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  console.log(`AURA api listening on :${PORT}`);
});
