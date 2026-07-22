import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Unit-test the sender in isolation (house pattern — no supertest): mock db
// and firebase-admin so no test ever touches Postgres or Firebase.
vi.mock('./db.js', () => ({ query: vi.fn() }));
const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(x => x),
  getApps: () => [],
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));

import { query } from './db.js';
import { sendToUser } from './push.js';

beforeEach(() => {
  vi.clearAllMocks();
});
afterAll(() => vi.unstubAllEnvs());

describe('sendToUser', () => {
  it('no-ops without credentials — dev and tests never need Firebase', async () => {
    delete process.env.FIREBASE_ADMIN_JSON;
    const out = await sendToUser('u1', { title: 't', body: 'b' });
    expect(out).toEqual({ sent: 0, reason: 'no_credentials' });
    expect(query).not.toHaveBeenCalled();
  });

  it('sends to every device and prunes tokens FCM reports gone', async () => {
    vi.stubEnv('FIREBASE_ADMIN_JSON', JSON.stringify({ project_id: 'aura' }));
    query.mockResolvedValueOnce({ rows: [{ token: 'alive'.padEnd(20, 'a') }, { token: 'dead'.padEnd(20, 'd') }] });
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] }); // the prune DELETE

    const out = await sendToUser('u1', {
      title: 'your wednesday mix is ready',
      body: 'three songs from artists you love',
      image: 'https://example.com/art.jpg',
      link: 'https://www.aurafm.live/',
      collapseKey: 'mix-ready',
    });

    expect(out).toEqual({ sent: 1 });
    const msg = sendEachForMulticast.mock.calls[0][0];
    expect(msg.tokens).toHaveLength(2);
    expect(msg.notification.title).toContain('wednesday');
    expect(msg.android.collapseKey).toBe('mix-ready');
    expect(msg.android.notification.imageUrl).toBe('https://example.com/art.jpg');
    expect(msg.data.link).toBe('https://www.aurafm.live/');
    // The dead token — and only it — is pruned.
    const del = query.mock.calls.find(c => c[0].includes('DELETE'));
    expect(del[1][0]).toEqual(['dead'.padEnd(20, 'd')]);
  });

  it('reports no_tokens for a user with no registered devices', async () => {
    vi.stubEnv('FIREBASE_ADMIN_JSON', JSON.stringify({ project_id: 'aura' }));
    query.mockResolvedValueOnce({ rows: [] });
    const out = await sendToUser('u2', { title: 't', body: 'b' });
    expect(out).toEqual({ sent: 0, reason: 'no_tokens' });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });
});
