import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { sanitizeUser } from './auth.js';
import { searchSongs } from './catalog.js';

// PIN-gated Family mode. Enabling sets a bcrypt-hashed PIN and turns the flag on;
// disabling requires that PIN. Per-account throttle (attempts + lockout) blunts
// PIN guessing independently of the IP rate limiter. The flag itself rides the
// user row (sanitizeUser exposes `familyMode`); the client hides explicit tracks
// from discovery while it's on, and the PIN protects turning it back off.

const router = Router();

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;   // lock disable for 15 min after MAX_ATTEMPTS

const validPin = (pin) => typeof pin === 'string' && /^\d{4,6}$/.test(pin);

// ── Enable Family mode (set the PIN) ─────────────────────────────────
router.post('/enable', requireAuth, async (req, res) => {
  try {
    const { pin } = req.body ?? {};
    if (!validPin(pin)) return res.status(400).json({ error: 'choose a 4–6 digit PIN', code: 'bad_format' });

    const { rows } = await pool.query('SELECT family_mode FROM users WHERE id = $1', [req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'user not found' });
    if (rows[0].family_mode) return res.status(409).json({ error: 'family mode is already on' });

    const hash = await bcrypt.hash(pin, 12);
    const upd = await pool.query(
      `UPDATE users SET family_mode = TRUE, family_pin_hash = $1,
         family_pin_attempts = 0, family_pin_locked_until = NULL
       WHERE id = $2 RETURNING *`,
      [hash, req.userId],
    );
    res.json({ user: sanitizeUser(upd.rows[0]) });
  } catch (err) {
    console.error('[family/enable]', err);
    res.status(500).json({ error: 'could not enable family mode' });
  }
});

// ── Disable Family mode (verify the PIN) ─────────────────────────────
router.post('/disable', requireAuth, async (req, res) => {
  try {
    const { pin } = req.body ?? {};
    if (!validPin(pin)) return res.status(400).json({ error: 'enter your 4–6 digit PIN', code: 'bad_format' });

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'user not found' });
    const u = rows[0];
    if (!u.family_mode) return res.status(409).json({ error: 'family mode is not on' });

    const now = Date.now();
    if (u.family_pin_locked_until && Number(u.family_pin_locked_until) > now) {
      return res.status(429).json({
        error: 'too many attempts — try again later', code: 'locked',
        retryAfterSec: Math.ceil((Number(u.family_pin_locked_until) - now) / 1000),
      });
    }

    const ok = u.family_pin_hash && await bcrypt.compare(pin, u.family_pin_hash);
    if (!ok) {
      const attempts = (u.family_pin_attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await pool.query(
          'UPDATE users SET family_pin_attempts = 0, family_pin_locked_until = $1 WHERE id = $2',
          [now + LOCK_MS, req.userId],
        );
        return res.status(429).json({ error: 'too many attempts — try again later', code: 'locked', retryAfterSec: Math.ceil(LOCK_MS / 1000) });
      }
      await pool.query('UPDATE users SET family_pin_attempts = $1 WHERE id = $2', [attempts, req.userId]);
      return res.status(401).json({ error: "that PIN isn't right", code: 'mismatch', attemptsLeft: MAX_ATTEMPTS - attempts });
    }

    const upd = await pool.query(
      `UPDATE users SET family_mode = FALSE, family_pin_hash = NULL,
         family_pin_attempts = 0, family_pin_locked_until = NULL
       WHERE id = $1 RETURNING *`,
      [req.userId],
    );
    res.json({ user: sanitizeUser(upd.rows[0]) });
  } catch (err) {
    console.error('[family/disable]', err);
    res.status(500).json({ error: 'could not disable family mode' });
  }
});

// ── Curated, read-only sets ──────────────────────────────────────────
// Built fresh from the catalog by theme. Read-only (no mutation routes) so they
// are "locked" by nature, and explicit tracks are filtered out server-side.
const CURATED = [
  { key: 'devotional', title: 'Devotional', query: 'bhakti devotional' },
  { key: 'wedding',    title: 'Wedding',    query: 'wedding songs' },
  { key: 'kuthu',      title: 'Kuthu',      query: 'kuthu' },
];

router.get('/sets', requireAuth, async (_req, res) => {
  try {
    const results = await Promise.allSettled(CURATED.map(c => searchSongs(c.query, { limit: 16 })));
    const sets = CURATED.map((c, i) => {
      const r = results[i];
      const tracks = (r.status === 'fulfilled' ? r.value : [])
        .filter(t => t && t.streamUrl && !t.explicit)
        .slice(0, 12);
      return { key: c.key, title: c.title, tracks };
    }).filter(s => s.tracks.length);
    res.json({ sets });
  } catch (err) {
    console.error('[family/sets]', err);
    res.status(500).json({ error: 'could not load family sets' });
  }
});

export default router;
