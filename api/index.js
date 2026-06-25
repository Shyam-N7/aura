// Vercel serverless entry — the entire Express app behind one function.
// vercel.json rewrites every `/api/*` request (any depth) here, and the
// function receives the ORIGINAL req.url (e.g. /api/catalog/featured), which
// the app's /api/... routes match against. DB migrations run separately
// (npm run migrate), so nothing bootstraps the schema per request.
import app from '../server/app.js';
import { installProcessGuards } from '../server/processGuards.js';

// Last-resort guards so a stray unhandled rejection / uncaught exception logs
// and survives instead of crashing the warm function instance. (security: #25/#26)
installProcessGuards();

export default app;
