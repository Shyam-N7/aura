// Only our OWN Vercel Blob URLs may be stored as a cover/avatar image — reject an
// arbitrary URL a user might POST (which would then render on a public page).
export function isBlobUrl(url) {
  try { return new URL(url).hostname.endsWith('.public.blob.vercel-storage.com'); }
  catch { return false; }
}
