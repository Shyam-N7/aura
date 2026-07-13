// Image uploads → Vercel Blob. The client resizes before sending (covers 600px,
// avatars 256px), so bodies are tiny; the server is the real boundary — it
// checks the declared type, the magic bytes, and a hard size cap before storing.
// Blobs are public (covers/avatars are shown on public pages) with an
// unguessable filename.

import crypto from 'node:crypto';
import { put } from '@vercel/blob';

const MAX_BYTES = 2 * 1024 * 1024;   // ceiling; the client resize lands well under this
const KINDS = new Set(['cover', 'avatar']);
const TYPES = {
  'image/jpeg': { ext: 'jpg',  magic: [0xFF, 0xD8, 0xFF] },
  'image/png':  { ext: 'png',  magic: [0x89, 0x50, 0x4E, 0x47] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },   // 'RIFF' container
};

function fail(status, msg) { const e = new Error(msg); e.statusCode = status; throw e; }
function magicOk(buf, magic) {
  return buf.length >= magic.length && magic.every((b, i) => buf[i] === b);
}

export async function uploadImage(userId, { kind, contentType, body }) {
  if (!KINDS.has(kind)) fail(400, 'unsupported upload kind');
  const type = TYPES[contentType];
  if (!type) fail(415, 'unsupported image type — use jpeg, png, or webp');
  if (!Buffer.isBuffer(body) || body.length === 0) fail(400, 'empty upload');
  if (body.length > MAX_BYTES) fail(413, 'image too large');
  if (!magicOk(body, type.magic)) fail(400, "that doesn't look like a real image");
  const key = `${kind}/${userId}-${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
  const { url } = await put(key, body, { access: 'public', contentType, addRandomSuffix: false });
  return { url };
}
