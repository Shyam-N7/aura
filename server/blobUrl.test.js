import { describe, it, expect } from 'vitest';
import { isBlobUrl } from './blobUrl.js';

describe('isBlobUrl', () => {
  it('accepts our own Vercel Blob public URLs', () => {
    expect(isBlobUrl('https://abc123.public.blob.vercel-storage.com/cover/u1-deadbeef.jpg')).toBe(true);
  });
  it('rejects any other host (no arbitrary URLs on public pages)', () => {
    expect(isBlobUrl('https://evil.example/x.jpg')).toBe(false);
    expect(isBlobUrl('https://public.blob.vercel-storage.com.evil.com/x')).toBe(false);
    expect(isBlobUrl('not a url')).toBe(false);
    expect(isBlobUrl('')).toBe(false);
    expect(isBlobUrl(null)).toBe(false);
  });
});
