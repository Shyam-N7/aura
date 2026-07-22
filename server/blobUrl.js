// Only our OWN Vercel Blob URLs may be stored as a cover/avatar image — reject an
// arbitrary URL a user might POST (which would then render on a public page).
// The Blob token carries our store id (vercel_blob_rw_<storeId>_…), and every
// URL `put` returns lives on <storeid>.public.blob.vercel-storage.com — so when
// the token is present the check pins that EXACT host, closing the gap where any
// stranger's Vercel Blob store also matched the suffix. Without a recognizable
// token (tests, local dev without uploads) the suffix check still holds.
// https-only and length-capped: the URL is stored and echoed on public pages.
const MAX_URL_LEN = 300;

function storeHost() {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

export function isBlobUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_URL_LEN) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const pinned = storeHost();
    if (pinned) return u.hostname === pinned;
    return u.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}
