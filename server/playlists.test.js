import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn(), pool: { query: vi.fn() } }));

import { query, pool } from './db.js';
import {
  listPlaylists, createInvite, removeCollaborator,
  addTrackToPlaylist, acceptInvite, setPlaylistOnlyMe, getPlaylist, getPublicPlaylist,
  savePlaylist, listSavedPlaylists,
} from './playlists.js';

// Access is one query joining the playlist owner + the caller's collaborator row.
// Script it per test to place the caller as owner / editor / stranger.
const access = ({ ownerId, collabRole = null }) =>
  query.mockResolvedValueOnce({ rows: [{ owner_id: ownerId, collab_role: collabRole }] });

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  pool.query.mockResolvedValue({ rows: [] });
});

describe('listPlaylists', () => {
  it('orders by last activity so an edited playlist rises', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listPlaylists('u1');
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('ORDER BY p.updated_at DESC');
    expect(sql).not.toContain('ORDER BY p.created_at');
  });
});

describe('createInvite (viewer + editor roles)', () => {
  it('honours a viewer-role invite from the owner', async () => {
    access({ ownerId: 'u1' });
    const out = await createInvite('u1', 'pl1', { role: 'viewer' });
    expect(out.role).toBe('viewer');
    const insert = pool.query.mock.calls.find(c => /INSERT INTO playlist_invites/.test(c[0]));
    expect(insert[1]).toContain('viewer');   // role param persisted
  });

  it('falls back to editor for an unknown role', async () => {
    access({ ownerId: 'u1' });
    const out = await createInvite('u1', 'pl1', { role: 'admin' });
    expect(out.role).toBe('editor');
  });

  it('refuses a non-owner', async () => {
    access({ ownerId: 'owner', collabRole: 'editor' });   // caller is an editor, not owner
    await expect(createInvite('u2', 'pl1', { role: 'viewer' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('removeCollaborator (authorization)', () => {
  it('lets the owner remove any collaborator', async () => {
    access({ ownerId: 'u1' });
    await removeCollaborator('u1', 'pl1', 'someone');
    const del = pool.query.mock.calls.find(c => /DELETE FROM playlist_collaborators/.test(c[0]));
    expect(del[1]).toEqual(['pl1', 'someone']);
  });

  it('lets a collaborator remove themselves (leave)', async () => {
    access({ ownerId: 'owner', collabRole: 'editor' });
    await removeCollaborator('u2', 'pl1', 'u2');   // target === caller
    expect(pool.query.mock.calls.some(c => /DELETE FROM playlist_collaborators/.test(c[0]))).toBe(true);
  });

  it('forbids a non-owner removing someone else', async () => {
    access({ ownerId: 'owner', collabRole: 'editor' });
    await expect(removeCollaborator('u2', 'pl1', 'other')).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query.mock.calls.some(c => /DELETE FROM playlist_collaborators/.test(c[0]))).toBe(false);
  });
});

describe('per-track attribution (added_by)', () => {
  it('records who added a track', async () => {
    access({ ownerId: 'u1' });                    // requireEdit → getAccess
    pool.query.mockResolvedValueOnce({ rowCount: 1 });   // INSERT
    pool.query.mockResolvedValueOnce({ rows: [] });      // UPDATE touch
    await addTrackToPlaylist('u1', 'pl1', 'trk');
    const insert = pool.query.mock.calls.find(c => /INSERT INTO playlist_tracks/.test(c[0]));
    expect(insert[0]).toContain('added_by');
    expect(insert[1]).toEqual(['pl1', 'trk', expect.any(Number), 'u1']);
  });

  it('exposes addedBy to members', async () => {
    access({ ownerId: 'u1' });                    // requireView → owner
    query.mockResolvedValueOnce({ rows: [{ id: 'pl1', name: 'x', is_public: false, public_id: null, owner_id: 'u1', owner_name: 'shyam' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 't1', title: 'S', duration_sec: 200, raw: null, added_by: 'u2', added_by_name: 'ravi' }] });
    query.mockResolvedValueOnce({ rows: [] });    // collaborators
    const view = await getPlaylist('u1', 'pl1');
    expect(view.tracks[0].addedBy).toEqual({ userId: 'u2', name: 'ravi' });
  });

  it('never exposes addedBy (or a stream URL) on the public link', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'pl1' }] });   // public lookup
    query.mockResolvedValueOnce({ rows: [{ id: 'pl1', name: 'x', is_public: true, public_id: 'pub', owner_id: 'u1', owner_name: 'shyam' }] });
    query.mockResolvedValueOnce({ rows: [{ id: 't1', title: 'S', stream_url: 's', duration_sec: 200, raw: null, added_by: 'u2', added_by_name: 'ravi' }] });
    const view = await getPublicPlaylist('pub');
    expect(view.tracks[0].addedBy).toBeNull();
    expect(view.tracks[0].streamUrl).toBeNull();
  });
});

describe('acceptInvite attribution', () => {
  it('returns the inviter name', async () => {
    query.mockResolvedValueOnce({ rows: [{ token: 't', playlist_id: 'pl1', created_by: 'u1', role: 'editor', expires_at: Date.now() + 1e6, inviter_name: 'shyam' }] });
    query.mockResolvedValueOnce({ rows: [{ user_id: 'u1', name: 'Road Trip' }] });
    const out = await acceptInvite('u2', 't');
    expect(out).toMatchObject({ role: 'editor', inviterName: 'shyam', name: 'Road Trip' });
  });
});

describe('setPlaylistOnlyMe (hard revoke)', () => {
  it('severs collaborators, invites, and the public link — owner only', async () => {
    access({ ownerId: 'u1' });
    const out = await setPlaylistOnlyMe('u1', 'pl1');
    expect(out).toEqual({ isPublic: false, onlyMe: true });
    const sqls = pool.query.mock.calls.map(c => c[0]);
    expect(sqls.some(s => /DELETE FROM playlist_collaborators WHERE playlist_id/.test(s))).toBe(true);
    expect(sqls.some(s => /DELETE FROM playlist_invites WHERE playlist_id/.test(s))).toBe(true);
    expect(sqls.some(s => /is_public = FALSE/.test(s))).toBe(true);
  });

  it('refuses a non-owner (and severs nothing)', async () => {
    access({ ownerId: 'owner', collabRole: 'editor' });
    await expect(setPlaylistOnlyMe('u2', 'pl1')).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query.mock.calls.length).toBe(0);
  });
});

describe('save to library', () => {
  it("owners can't save their own (no-op, no write)", async () => {
    access({ ownerId: 'u1' });
    expect(await savePlaylist('u1', 'pl1')).toEqual({ saved: false, own: true });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('saves a public playlist for a non-owner', async () => {
    query.mockResolvedValueOnce({ rows: [{ owner_id: 'owner', is_public: true, collab_role: null }] });
    expect(await savePlaylist('u2', 'pl1')).toEqual({ saved: true });
    const ins = pool.query.mock.calls.find(c => /INSERT INTO saved_playlists/.test(c[0]));
    expect(ins[1]).toEqual(['u2', 'pl1', expect.any(Number)]);
  });

  it('refuses to save a playlist not shared with you', async () => {
    query.mockResolvedValueOnce({ rows: [{ owner_id: 'owner', is_public: false, collab_role: null }] });
    await expect(savePlaylist('u2', 'pl1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lists saved playlists carrying an accessibility flag, leaking no metadata of a revoked one', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'pl1', name: 'A', updated_at: '1', owner_id: 'o', is_public: true, owner_name: 'x', track_count: 3, cover_raw: null, accessible: true },
      { id: 'pl2', name: 'Renamed-Secret', updated_at: '9', owner_id: 'o', is_public: false, owner_name: 'x', track_count: 7, cover_raw: { imageUrl: 'c' }, accessible: false },
    ] });
    const out = await listSavedPlaylists('u2');
    expect(out[0]).toMatchObject({ name: 'A', trackCount: 3, accessible: true });
    // The since-unshared one ships only id + the flag — no current name/count/cover/owner.
    expect(out[1]).toEqual({ id: 'pl2', name: null, trackCount: 0, coverImageUrl: null, updatedAt: null, ownerName: null, accessible: false });
  });
});

describe('public playlists are viewable by any signed-in user', () => {
  it('grants a streaming viewer read, but leaks no member identities', async () => {
    query.mockResolvedValueOnce({ rows: [{ owner_id: 'owner', is_public: true, collab_role: null }] });   // getAccess → viewer, member:false
    query.mockResolvedValueOnce({ rows: [{ id: 'pl1', name: 'x', is_public: true, public_id: 'pub', owner_id: 'owner', owner_name: 'o', save_count: 2 }] });
    // NOTE added_by is populated — a non-member must STILL not see it (the leak the review caught).
    query.mockResolvedValueOnce({ rows: [{ id: 't1', title: 'S', stream_url: 's', duration_sec: 200, raw: null, added_by: 'collab', added_by_name: 'ravi' }] });
    const view = await getPlaylist('u2', 'pl1');
    expect(view.role).toBe('viewer');
    expect(view.tracks[0].streamUrl).toBe('s');   // authed viewer gets streams (unlike /p/)
    expect(view.tracks[0].addedBy).toBeNull();     // per-track attribution hidden from a non-member
    expect(view.collaborators).toEqual([]);        // member list hidden too
    expect(view.saveCount).toBe(2);
  });
});
