// The notification card artist. Android never lets an app paint the OS card's
// background — but the big picture inside it is entirely ours, so EVERY aura
// push wears a composed 1000×500 card: the album art full-bleed under a house
// scrim (or the deep aura background when there's no art), the player's own
// seeded ribbon wave flowing across it — same hash, same sine, so each card's
// wave is deterministically its own — and the ring mark with the wordmark
// stacked bottom-left. Rendered by @resvg/resvg-js (no native build) with the
// app's real Hanken Grotesk, bundled: serverless has no fonts of its own.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { isBlobUrl } from './blobUrl.js';

const W = 1000;
const H = 500;
const BG = '#1a1814';
const CREAM = '#f5ede1';
const SAND = '#d8d0c2';
const ACCENT = '#d97757';

const FONT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'assets',
  'HankenGrotesk-SemiBold.ttf',
);

// Only art we host or serve may be fetched into the compositor — this
// endpoint is public (FCM fetches it unauthenticated), so an open fetch
// would be a proxy/SSRF. Catalog CDN + the pinned Blob store, nothing else.
export function allowedArtUrl(url) {
  if (typeof url !== 'string' || url.length > 1000) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return u.hostname === 'c.saavncdn.com' || isBlobUrl(url);
}

// The player ribbon's exact seed hash (web ProgressRibbon, ported verbatim
// including the bit ops) — amp/freq/phase all fall out of the seed string, so
// the same card renders byte-identical forever (cacheable) while every
// distinct art/seed gets its own wave.
export function ribbonPath(seed, { y = 356, span = W, samples = 80, wave = 96 } = {}) {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) & 0xffffffff;
  const amp = ((s >>> 0) % 50) / 220 + 0.16;
  const freq = 1.4 + ((s >>> 4) % 40) / 40;
  const phase = ((s >>> 8) % 628) / 100;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * span;
    const tt = (i / samples) * Math.PI * 2 * freq + phase;
    const env = Math.sin((i / samples) * Math.PI) * 0.7 + 0.3;
    const yy = y + Math.sin(tt) * amp * wave * env;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${yy.toFixed(1)}`);
  }
  return pts.join(' ');
}

// art: { buffer, mime } or null for the brand-only card.
export function cardSvg({ art = null, seed = 'aura' } = {}) {
  const wavePath = ribbonPath(seed);
  const artLayer = art
    ? `<image href="data:${art.mime};base64,${art.buffer.toString('base64')}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${W}" height="${H}" fill="url(#scrim)"/>`
    : `<rect width="${W}" height="${H}" fill="${BG}"/>
       <circle cx="500" cy="250" r="420" fill="url(#glow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG}" stop-opacity="0.10"/>
      <stop offset="0.45" stop-color="${BG}" stop-opacity="0.38"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0.94"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="${ACCENT}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${artLayer}
  <!-- ring constellation, echoing the launcher/OG mark, bled off top-right -->
  <g transform="translate(872 84)" fill="none" stroke="${CREAM}">
    <circle r="216" stroke-width="4" opacity="0.10"/>
    <circle r="138" stroke-width="4" opacity="0.15"/>
    <circle r="70" stroke-width="4" opacity="0.22"/>
  </g>
  <circle cx="872" cy="84" r="24" fill="${ACCENT}" opacity="0.85"/>
  <!-- this card's own wave: soft under-stroke, faux glow, accent crest -->
  <path d="${wavePath}" stroke="${CREAM}" stroke-opacity="0.14" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="${wavePath}" stroke="${ACCENT}" stroke-opacity="0.25" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="${wavePath}" stroke="${ACCENT}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <!-- brand stack: the mark with the wordmark below it -->
  <g transform="translate(96 386)" fill="none" stroke="${SAND}">
    <circle r="30" stroke-width="2.4" opacity="0.42"/>
    <circle r="18.5" stroke-width="2.4" opacity="0.58"/>
  </g>
  <circle cx="96" cy="386" r="8" fill="${ACCENT}"/>
  <text x="96" y="462" text-anchor="middle" font-family="Hanken Grotesk"
    font-size="40" letter-spacing="1.5" fill="${CREAM}">aura</text>
</svg>`;
}

let fontBuffer = null;

export function renderCardPng({ art = null, seed = 'aura' } = {}) {
  if (!fontBuffer) fontBuffer = readFileSync(FONT_PATH);
  const resvg = new Resvg(cardSvg({ art, seed }), {
    fitTo: { mode: 'width', value: W },
    background: BG,
    font: {
      loadSystemFonts: false,
      fontBuffers: [fontBuffer],
      defaultFontFamily: 'Hanken Grotesk',
    },
  });
  return resvg.render().asPng();
}

const FETCH_TIMEOUT_MS = 4000;
const MAX_ART_BYTES = 4 * 1024 * 1024;
// resvg rasters png/jpeg/gif; webp would render as a blank box. Anchored:
// the matched mime is interpolated into the SVG data: URI, so a trailing
// payload in a hostile content-type must never ride along.
const OK_MIME = /^image\/(jpeg|png|gif)$/;

// Fetch the (already allowlist-checked) art. Returns { buffer, mime } or
// throws a client-safe Error with statusCode.
export async function fetchArt(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) {
      const err = new Error('art fetch failed');
      err.statusCode = 422;
      throw err;
    }
    // Redirects are followed, so the URL we LANDED on must pass the same
    // allowlist as the one we started from — an open redirect on an
    // allowlisted host must not turn this into an open image proxy.
    if (res.url && res.url !== url && !allowedArtUrl(res.url)) {
      const err = new Error('art fetch failed');
      err.statusCode = 422;
      throw err;
    }
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!OK_MIME.test(mime)) {
      const err = new Error('unsupported image type');
      err.statusCode = 422;
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ART_BYTES) {
      const err = new Error('image too large');
      err.statusCode = 422;
      throw err;
    }
    return { buffer: buf, mime };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('art fetch timed out');
      err.statusCode = 422;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
