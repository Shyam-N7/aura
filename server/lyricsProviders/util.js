// Shared helpers for the synced-lyrics provider chain: a timeout-bounded fetch,
// an LRC parser, and a sanity gate that rejects an LRC whose timing clearly
// belongs to a different recording. Kept provider-agnostic so each provider
// (lrclib, musixmatch, netease) and the generation worker can reuse them
// without importing each other.

export function fetchWithTimeout(url, { headers, ms = 15000, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { method, headers, body, signal: ctl.signal })
    .finally(() => clearTimeout(timer));
}

// "[mm:ss.xx]line text"  →  { t: seconds, line: text }. Tolerates duplicate
// timestamps (some providers emit them) by sorting; drops metadata/blank lines.
export function parseLRC(lrc) {
  if (!lrc || typeof lrc !== 'string') return [];
  const out = [];
  const re = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;
  for (const raw of lrc.split(/\r?\n/)) {
    const m = re.exec(raw);
    if (!m) continue;
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    const frac    = Number((m[3] ?? '0').padEnd(3, '0')) / 1000;
    const t = minutes * 60 + seconds + frac;
    out.push({ t, line: (m[4] ?? '').trim() });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Secondary safety net against wrong-song matches. LRCLIB already matches on
// duration upstream, but Musixmatch/NetEase don't always — so we reject an LRC
// whose last timestamp runs past the track's end (a longer/different recording)
// or finishes in the first third (a truncated/mismatched snippet). Between those
// bounds we accept: long instrumental intros and outros are normal.
export function passesQuality(lines, durationSec) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  if (!durationSec || durationSec <= 0) return true;   // nothing to validate against
  const lastT = lines[lines.length - 1].t;
  if (lastT > durationSec + 15) return false;
  if (lastT < durationSec * 0.33) return false;
  return true;
}
