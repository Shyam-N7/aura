// Equalizer configuration — the single source of truth shared by the audio
// engine (HtmlAudioPlayer builds one BiquadFilter per frequency) and the EQ UI
// (Equalizer.jsx draws one fader per frequency). Keeping bands + presets here
// means the graph and the controls can never drift out of sync.

// 8 bands, low → high. Lowest is a low-shelf, highest a high-shelf, the rest
// peaking filters (see HtmlAudioPlayer._ensureGraph). Spread roughly by octave
// from sub-bass to air so the faders feel evenly spaced and give real control.
export const EQ_FREQS = [60, 150, 400, 1000, 2400, 6000, 12000, 16000];

// Short labels under each fader.
export const EQ_LABELS = ['60', '150', '400', '1k', '2.4k', '6k', '12k', '16k'];

// Faders run ±EQ_RANGE_DB decibels around flat (0).
export const EQ_RANGE_DB = 12;

// Mood presets — tied to AURA's own mood vocabulary, not the generic
// Rock/Pop/Bass-Boost banks every other app ships. Each `gains` array is one dB
// value per band (same order as EQ_FREQS). Flat is the neutral reset.
export const EQ_PRESETS = [
  { id: 'flat',    name: 'Flat',    gains: [  0,   0,    0,   0,    0,    0,    0,    0  ] },
  { id: 'calm',    name: 'Calm',    gains: [  1,   1.5,  1,   0,   -1,   -2,   -2.5, -2  ] },
  { id: 'focused', name: 'Focused', gains: [ -2,  -1,    0,   2,    2.5,  1,    0,   -1  ] },
  { id: 'upbeat',  name: 'Upbeat',  gains: [  3,   2,    0,  -1,    0,    2,    3,    3  ] },
  { id: 'warm',    name: 'Warm',    gains: [  2.5, 3,    1.5, 0.5, -0.5, -1.5, -2,   -2.5] },
  { id: 'social',  name: 'Social',  gains: [  1,   1,    2,   3,    2.5,  1.5,  1,    1  ] },
];

// All-flat gains array — the safe default when nothing is stored yet.
export const EQ_FLAT = EQ_FREQS.map(() => 0);

// True when two gain arrays are effectively equal (used to highlight the active
// preset, and to tell "Custom" from a named preset). Tolerant of float drift.
export function gainsMatch(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 0.01) return false;
  }
  return true;
}

// Normalize an arbitrary stored value into a valid gains array (right length,
// numbers, clamped to range). Guards against corrupt localStorage.
export function sanitizeGains(arr) {
  const out = EQ_FREQS.map((_, i) => {
    const n = Number(arr?.[i]);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, n));
  });
  return out;
}

// Decibels → linear amplitude gain. Shared by the audio engine's makeup/headroom
// stage (HtmlAudioPlayer) so dB math lives with the rest of the EQ config.
export function dbToGain(db) { return Math.pow(10, db / 20); }
