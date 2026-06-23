import { Router } from 'express';
import { pool } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { isModeKey } from './modes.js';
import { sanitizeUser } from './auth.js';

// Listening-mode routes. This slice just switches the active context; the
// per-mode PIN (lock / unlock / PIN-to-exit) and explicit-override routes land
// with the rest of Phase 1.
const router = Router();

router.post('/active', requireAuth, async (req, res) => {
  const key = String(req.body?.key ?? '');
  if (!isModeKey(key)) return res.status(400).json({ error: 'unknown mode', code: 'bad_mode' });
  try {
    const { rows } = await pool.query(
      'UPDATE users SET active_mode = $1 WHERE id = $2 RETURNING *',
      [key, req.userId],
    );
    if (!rows.length) return res.status(404).json({ error: 'user not found' });
    res.json({ user: sanitizeUser(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
