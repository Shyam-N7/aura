// One-off test push: sends to the most recently registered device (the
// phone that just enrolled). Needs env: DATABASE_URL (prod, read-only use)
// + FIREBASE_ADMIN_JSON (the service-account JSON string). Run:
//   node scripts/send-test-push.mjs
import { sendToUser } from '../server/push.js';
import { query, pool } from '../server/db.js';

try {
  const { rows } = await query(
    'SELECT user_id, last_seen_at FROM push_tokens ORDER BY last_seen_at DESC LIMIT 1',
  );
  if (!rows.length) {
    console.log('NO TOKEN ROWS — the app has not registered yet.');
  } else {
    const age = Math.round((Date.now() - Number(rows[0].last_seen_at)) / 60000);
    console.log(`newest device row is ${age} min old — sending…`);
    const out = await sendToUser(rows[0].user_id, {
      title: 'hello from aura',
      body: 'the first push, straight to your pocket. tap to open your music.',
      link: 'https://www.aurafm.live/',
      collapseKey: 'test',
    });
    console.log('RESULT', JSON.stringify(out));
  }
} finally {
  await pool.end();
}
