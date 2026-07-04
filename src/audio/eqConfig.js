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
// Retuned so every preset plays at ~Flat loudness (the makeup gain no longer
// attenuates modest boosts — see HtmlAudioPlayer._makeupGain) and each is a genuine
// improvement, not a quieter/duller Flat. Peaks kept ≤ +4 dB so makeup stays unity;
// the 0 dBFS limiter shapes the peaks. Calm/Warm keep their character but with
// gentler high roll-off so they aren't "duller than Flat".
export const EQ_PRESETS = [
  { id: 'flat',    name: 'Flat',    gains: [  0,    0,    0,   0,    0,    0,    0,    0  ] },
  // Punchy, full, bright — a loudness/excitement smile (bass + presence + air).
  { id: 'loud',    name: 'Loud',    gains: [  4,    3,    0.5, 1,    2,    2,    3,    4  ] },
  // Lifts the 1k–6k presence band where vocals live — the antidote to "music
  // loud, lyrics low" (and the tone Car Mode applies).
  { id: 'clarity', name: 'Vocal clarity', gains: [ 0, 0, 1, 2.5, 4, 2, 0, 0 ] },
  { id: 'focused', name: 'Focused', gains: [ -1,    0,    0,   2,    3,    1.5,  0,   -0.5] },
  { id: 'upbeat',  name: 'Upbeat',  gains: [  4,    2,    0,  -0.5,  1,    2.5,  3.5,  4  ] },
  { id: 'social',  name: 'Social',  gains: [  1.5,  1.5,  2,   3,    2.5,  1.5,  1,    1  ] },
  { id: 'warm',    name: 'Warm',    gains: [  3,    3,    1.5, 0.5,  0,   -1,   -1.5, -2  ] },
  { id: 'calm',    name: 'Calm',    gains: [  1.5,  2,    1,   0,   -0.5, -1,   -1.5, -1.5] },
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

// Loudness-leveling gain for a measured program RMS: the linear gain that moves it
// toward `target`, clamped to [minDb, maxDb] so we never over-boost a quiet track
// or crush a hot one. Returns null when the program is effectively silent (don't
// adjust). Pure (testable); the engine ramps toward this value slowly.
export function levelGainFor(rms, { target, minDb, maxDb }) {
  if (!(rms > 1e-4)) return null;
  const g = target / rms;
  return Math.max(dbToGain(minDb), Math.min(dbToGain(maxDb), g));
}
