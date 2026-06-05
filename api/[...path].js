// Vercel serverless entry — the entire Express app behind one catch-all
// function. Every /api/* request routes here, and the app's own /api/... route
// definitions match against the preserved req.url (Vercel does not strip the
// prefix). The database schema is applied separately via `npm run migrate`, so
// nothing bootstraps the DB on the request path. Keeping the whole app in one
// function means a single cold-start path and shared warm caches per instance.
import app from '../server/app.js';

export default app;
