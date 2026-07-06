import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/auth', () => ({ fetchAuthed: vi.fn() }));

import { fetchAuthed } from '../lib/auth';
import { listAutoPlaylists } from './autoPlaylists';

describe('listAutoPlaylists', () => {
  it("sends the client tz offset so editions follow the user's calendar day", async () => {
    fetchAuthed.mockResolvedValue({ ok: true, json: async () => ({ playlists: [] }) });
    await listAutoPlaylists();
    expect(fetchAuthed.mock.calls[0][0])
      .toBe(`/api/playlists/auto?tzOffset=${new Date().getTimezoneOffset()}`);
  });
});
