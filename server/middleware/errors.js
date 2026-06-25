// Centralized error handling for the API.
//
// - asyncHandler: wraps an async route so a rejected promise is forwarded to
//   Express' error middleware. Express 4 does NOT do this on its own — an
//   unguarded async handler that rejects becomes an unhandled rejection. (#26)
//
// - clientError: the ONLY error string we ever send to a client. Intentional
//   4xx messages (statusCode < 500) and errors explicitly flagged `expose:true`
//   pass through; anything 5xx / unknown / flagged `expose:false` collapses to a
//   generic message so upstream-provider response bodies, Gemini error text, and
//   Postgres internals never leak to callers. Full detail is logged server-side. (#27)
//
// - errorMiddleware / notFound: terminal handlers, mounted LAST in app.js.

const GENERIC = {
  400: 'bad request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not found',
  409: 'conflict',
  413: 'request too large',
  429: 'too many requests — slow down a moment.',
};

export function clientError(err) {
  const status = Number(err?.statusCode) || 500;
  // expose:false always hides; expose:true always shows; otherwise show only
  // intentional client-facing 4xx (which carry curated messages like
  // "playlist not found"), hide everything 5xx/unknown.
  const exposable = err?.expose === true || (err?.expose !== false && status < 500);
  if (exposable && typeof err?.message === 'string' && err.message) return err.message;
  return GENERIC[status] ?? 'something went wrong';
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, res) {
  res.status(404).json({ error: 'not found' });
}

// Express identifies error middleware by its arity (4 args) — `next` must stay
// in the signature even though it's only used to delegate already-sent responses.
// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, next) {
  // Full detail server-side only; never to the client.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err?.stack ?? err?.message ?? err);
  if (res.headersSent) return next(err);
  res.status(Number(err?.statusCode) || 500).json({ error: clientError(err) });
}
