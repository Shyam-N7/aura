import { fetchAuthed } from '../lib/auth';

// Resize an image client-side (so the request body stays tiny and well under
// Vercel's function body limit), then upload it to Blob via the server. `kind`
// is 'cover' (→600px) or 'avatar' (→256px). Returns { url }.
const MAX_DIM = { cover: 600, avatar: 256 };

export async function uploadImage(file, { kind = 'cover' } = {}) {
  const blob = await resizeToJpeg(file, MAX_DIM[kind] ?? 600);
  const res = await fetchAuthed(`/api/uploads/image?kind=${encodeURIComponent(kind)}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  return body;   // { url }
}

// Draw the image onto a canvas capped at `max` on its long edge, re-encode as
// JPEG. Rejects anything that isn't a decodable image.
function resizeToJpeg(file, max) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('couldn’t process that image'))),
        'image/jpeg', 0.85,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('that isn’t an image')); };
    img.src = objectUrl;
  });
}
