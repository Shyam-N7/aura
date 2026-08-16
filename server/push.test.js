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
import { sendToUser, sendCategory, inQuietHours } from './push.js';

beforeEach(() => {
  vi.clearAllMocks();
});
afterAll(() => vi.unstubAllEnvs());

describe('sendToUser', () => {
  it('surfaces non-token failures instead of discarding them', async () => {
    // The blind spot that hid a mismatched service account for a release:
    // every send failed, nothing was logged, and the console read
    // "sent to 0 devices" — indistinguishable from having no devices.
    vi.stubEnv('FIREBASE_ADMIN_JSON', JSON.stringify({ project_id: 'aura' }));
    query.mockResolvedValueOnce({ rows: [{ token: 't'.padEnd(20, 't') }] });
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: 'messaging/mismatched-credential' } }],
    });
    const out = await sendToUser('u1', { title: 't', body: 'b' });
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.error).toBe('messaging/mismatched-credential');
    // A foreign error must never prune the token — only the two dead codes do.
    expect(query).toHaveBeenCalledTimes(1);
  });


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
    // Delivery-critical, and both are invisible in any response FCM returns:
    // without high priority a dozing device defers the push to its next
    // maintenance window, and without an explicit channel the client SDK
    // routes it to a fallback channel at an importance we don't control.
    // The id is mirrored in MainApplication.PUSH_CHANNEL_ID and the app
    // manifest — asserting the literal here is what catches a drift between
    // the three.
    expect(msg.android.priority).toBe('high');
    expect(msg.android.notification.channelId).toBe('aura.push.v1');
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

// IST is UTC+5:30 (no DST): 12:30 IST = 07:00 UTC — comfortably outside the
// 22:30–07:00 quiet window. Every timestamp below is built from that anchor.
const MIDDAY = Date.UTC(2026, 0, 5, 7, 0, 0);

describe('inQuietHours (22:30–07:00 IST)', () => {
  it('honors the exact boundaries', () => {
    expect(inQuietHours(Date.UTC(2026, 0, 5, 16, 59))).toBe(false); // 22:29 IST
    expect(inQuietHours(Date.UTC(2026, 0, 5, 17, 0))).toBe(true);   // 22:30 IST
    expect(inQuietHours(Date.UTC(2026, 0, 5, 1, 29))).toBe(true);   // 06:59 IST
    expect(inQuietHours(Date.UTC(2026, 0, 5, 1, 30))).toBe(false);  // 07:00 IST
    expect(inQuietHours(MIDDAY)).toBe(false);
  });
});

describe('sendCategory (prefs + quiet hours + caps)', () => {
  it('rejects an unknown category outright', async () => {
    const out = await sendCategory('u1', 'nope', { title: 't', body: 'b' }, { now: MIDDAY });
    expect(out).toEqual({ sent: 0, reason: 'unknown_category' });
    expect(query).not.toHaveBeenCalled();
  });

  it('stays silent inside quiet hours — before any db read', async () => {
    const night = Date.UTC(2026, 0, 5, 18, 0); // 23:30 IST
    const out = await sendCategory('u1', 'mixes', { title: 't', body: 'b' }, { now: night });
    expect(out).toEqual({ sent: 0, reason: 'quiet_hours' });
    expect(query).not.toHaveBeenCalled();
  });

  it('respects a switched-off category', async () => {
    query.mockResolvedValueOnce({ rows: [{ mixes: false, social: true, nudges: true }] });
    const out = await sendCategory('u1', 'mixes', { title: 't', body: 'b' }, { now: MIDDAY });
    expect(out).toEqual({ sent: 0, reason: 'pref_off' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('defaults to all-on when the user never touched the switches', async () => {
    delete process.env.FIREBASE_ADMIN_JSON;
    query.mockResolvedValueOnce({ rows: [] });                       // no prefs row
    query.mockResolvedValueOnce({ rows: [{ last: null, day: '0' }] }); // caps clear
    const out = await sendCategory('u1', 'mixes', { title: 't', body: 'b' }, { now: MIDDAY });
    // Policy passed; only the (unconfigured) sender stopped it — and an
    // undelivered send must NOT burn the cap.
    expect(out).toEqual({ sent: 0, reason: 'no_credentials' });
    const inserts = query.mock.calls.filter(c => c[0].includes('INSERT INTO push_log'));
    expect(inserts).toHaveLength(0);
  });

  it('enforces the per-category minimum gap', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ last: MIDDAY - 3600_000, day: '1' }] }); // 1h ago < 20h gap
    const out = await sendCategory('u1', 'mixes', { title: 't', body: 'b' }, { now: MIDDAY });
    expect(out).toEqual({ sent: 0, reason: 'capped' });
  });

  it('enforces the all-categories daily cap', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ last: null, day: '4' }] });
    const out = await sendCategory('u1', 'social', { title: 't', body: 'b' }, { now: MIDDAY });
    expect(out).toEqual({ sent: 0, reason: 'daily_cap' });
  });

  it('sends and logs when every guard clears', async () => {
    vi.stubEnv('FIREBASE_ADMIN_JSON', JSON.stringify({ project_id: 'aura' }));
    query.mockResolvedValueOnce({ rows: [] });                         // prefs default
    query.mockResolvedValueOnce({ rows: [{ last: null, day: '0' }] }); // caps clear
    query.mockResolvedValueOnce({ rows: [{ token: 'alive'.padEnd(20, 'a') }] });
    sendEachForMulticast.mockResolvedValueOnce({ successCount: 1, responses: [{ success: true }] });
    query.mockResolvedValueOnce({ rows: [] });                         // the log INSERT
    const out = await sendCategory('u1', 'nudges', { title: 't', body: 'b' }, { now: MIDDAY });
    expect(out).toEqual({ sent: 1 });
    const log = query.mock.calls.find(c => c[0].includes('INSERT INTO push_log'));
    expect(log[1]).toEqual(['u1', 'nudges', MIDDAY]);
  });
});
