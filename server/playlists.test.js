import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn(), pool: { query: vi.fn() } }));

import { query, pool } from './db.js';
import { listPlaylists, createInvite, removeCollaborator } from './playlists.js';

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
