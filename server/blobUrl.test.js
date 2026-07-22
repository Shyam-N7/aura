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
  it('is https-only and length-capped (the url is stored + echoed publicly)', () => {
    expect(isBlobUrl('http://abc123.public.blob.vercel-storage.com/x.jpg')).toBe(false);
    expect(isBlobUrl(`https://abc123.public.blob.vercel-storage.com/${'a'.repeat(300)}.jpg`)).toBe(false);
  });
  it('pins the EXACT store host when the Blob token is present', () => {
    const prev = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_MyStore99_secretpart';
    try {
      // Our own store passes; any OTHER Vercel Blob store (a stranger's) no
      // longer matches on the suffix alone.
      expect(isBlobUrl('https://mystore99.public.blob.vercel-storage.com/cover/u1-cafe.jpg')).toBe(true);
      expect(isBlobUrl('https://elses.public.blob.vercel-storage.com/cover/u1-cafe.jpg')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = prev;
    }
  });
});
