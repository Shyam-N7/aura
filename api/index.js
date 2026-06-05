// Vercel serverless entry — the entire Express app behind one function.
// vercel.json rewrites every `/api/*` request (any depth) here, and the
// function receives the ORIGINAL req.url (e.g. /api/catalog/featured), which
// the app's /api/... routes match against. DB migrations run separately
// (npm run migrate), so nothing bootstraps the schema per request.
import app from '../server/app.js';

export default app;
