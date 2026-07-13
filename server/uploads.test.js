import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@vercel/blob', () => ({ put: vi.fn().mockResolvedValue({ url: 'https://blob.example/xyz.jpg' }) }));

import { put } from '@vercel/blob';
import { uploadImage } from './uploads.js';

// Minimal valid image buffers (magic bytes + padding).
const jpeg = (n = 64) => { const b = Buffer.alloc(n); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };
const png  = (n = 64) => { const b = Buffer.alloc(n); [0x89, 0x50, 0x4E, 0x47].forEach((v, i) => (b[i] = v)); return b; };

beforeEach(() => vi.clearAllMocks());

describe('uploadImage', () => {
  it('stores a valid jpeg under an unguessable, kind-scoped key and returns the url', async () => {
    const out = await uploadImage('u1', { kind: 'cover', contentType: 'image/jpeg', body: jpeg() });
    expect(out).toEqual({ url: 'https://blob.example/xyz.jpg' });
    const [key, body, opts] = put.mock.calls[0];
    expect(key).toMatch(/^cover\/u1-[0-9a-f]{16}\.jpg$/);
    expect(body).toBeInstanceOf(Buffer);
    expect(opts).toMatchObject({ access: 'public', contentType: 'image/jpeg' });
  });

  it('accepts png for an avatar', async () => {
    await uploadImage('u1', { kind: 'avatar', contentType: 'image/png', body: png() });
    expect(put.mock.calls[0][0]).toMatch(/^avatar\/u1-[0-9a-f]{16}\.png$/);
  });

  it('rejects an unknown kind (400)', async () => {
    await expect(uploadImage('u1', { kind: 'banner', contentType: 'image/jpeg', body: jpeg() }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects an unsupported type (415)', async () => {
    await expect(uploadImage('u1', { kind: 'cover', contentType: 'image/gif', body: jpeg() }))
      .rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects a too-large body (413)', async () => {
    await expect(uploadImage('u1', { kind: 'cover', contentType: 'image/jpeg', body: jpeg(3 * 1024 * 1024) }))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it('rejects bytes whose magic number lies about being a jpeg (400)', async () => {
    await expect(uploadImage('u1', { kind: 'cover', contentType: 'image/jpeg', body: Buffer.from('not an image') }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects an empty body (400)', async () => {
    await expect(uploadImage('u1', { kind: 'cover', contentType: 'image/jpeg', body: Buffer.alloc(0) }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
