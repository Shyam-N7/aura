// Dedicated Vercel function for loudness measurement — the ONLY bundle that
// carries the ffmpeg-static binary (~80MB). vercel.json rewrites
// /api/loudness/measure here before the main catch-all, so the main app
// function stays lean; everything else about the route (auth, validation,
// claim, measure, store) is the shared handler in server/loudness.js.
import express from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import ffmpegPath from 'ffmpeg-static';
import { loudnessMeasureHandler } from '../server/loudness.js';
import { requireAuth, peekUserId } from '../server/middleware/auth.js';
import { errorMiddleware, notFound } from '../server/middleware/errors.js';
import { installProcessGuards } from '../server/processGuards.js';

installProcessGuards();

const app = express();

// Same defensive body handling as the main app: serverless may pre-parse JSON.
app.use((req, res, next) => {
  if (Number(req.headers['content-length']) > 2 * 1024) {
    return res.status(413).json({ error: 'request too large' });
  }
  if (req.body && typeof req.body === 'object') return next();
  express.json({ limit: '2kb' })(req, res, next);
});
app.use(cookieParser());

// Each measure costs a full track download + decode — cap the rate per
// account (else per-IP). In-memory is fine: the claim table already dedupes
// real work globally; this just blunts request floods per instance.
const measureLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests — slow down a moment.' },
  keyGenerator: (req) => {
    const uid = peekUserId(req);
    return uid ? `u:${uid}` : `ip:${req.ip ?? 'unknown'}`;
  },
});

app.post(
  '/api/loudness/measure',
  measureLimiter,
  requireAuth,
  loudnessMeasureHandler(async () => ffmpegPath),
);

app.use(notFound);
app.use(errorMiddleware);

export default app;
