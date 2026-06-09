// Mood inference — read the listener's last ~30 plays and classify their
// current emotional state into one of six AURA moods. Drift tells us whether
// the recent half is hotter, colder, or about the same as the older half.

import { generateJson } from '../llm.js';

const MOODS = ['restless', 'focused', 'calm', 'upbeat', 'warm', 'social'];

const SYSTEM = `you classify a listener's current mood from their recent listening events.
return JSON matching the schema. judge the mood from LISTENING BEHAVIOUR and the songs/artists
themselves — do NOT use language as a signal (ignore which language the tracks are in). one of
six moods:

- restless — can't settle: lots of skips, short listens, hopping between artists.
- focused  — sustained engagement: long full listens, few skips, one lane / mid-energy.
- calm     — slow, melancholic, lyrical: one or two artists deep, unhurried full listens.
- upbeat   — energetic, danceable, high-energy with full play-throughs.
- warm     — soft, romantic, ballads: long listens, repeats of the same emotional register.
- social   — party/dance/hip-hop energy, lots of variety, surface-level engagement.

reason: ≤ 12 words naming the ACTUAL songs/artists/patterns behind the read — reference the
tracks/artists they played (e.g. "lots of skips, hopping between Anirudh and A.R. Rahman" or
"deep on Sid Sriram ballads, full listens"). never mention language in the reason.

confidence is your sense of how clear the signal is: 0.9 if the pattern is obvious, 0.4 if the
events are mixed or sparse. drift compares the most recent ~15 plays to the older ~15:
  warming = mood shifting toward higher energy / brighter
  cooling = shifting toward lower energy / softer
  steady  = no clear movement.

if the listener has < 10 events, mood is your best guess at low confidence (≤ 0.5).
never invent moods outside the enum.`;

const SCHEMA = {
  type: 'object',
  properties: {
    mood:       { type: 'string', enum: MOODS },
    confidence: { type: 'number' },
    drift:      { type: 'string', enum: ['warming', 'cooling', 'steady'] },
    reason:     { type: 'string' },
  },
  required: ['mood', 'confidence', 'drift', 'reason'],
};

function buildPrompt({ events }) {
  // events: array of {title, artist, language, kind, position_sec, ts} most-recent first.
  const lines = events.map((e, i) => {
    const meta = [
      e.language,
      e.kind !== 'play' ? e.kind : null,
      e.position_sec ? `${Math.round(e.position_sec)}s` : null,
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${e.title} — ${e.artist}${meta ? ` (${meta})` : ''}`;
  }).join('\n');

  return `recent listening (most recent first, ${events.length} events):
${lines}

classify the current mood per the schema, and in \`reason\` explain the read in ≤ 12 words by
naming the actual songs/artists above — never the language.`;
}

export async function generateMoodInference({ events }) {
  return generateJson({
    system:  SYSTEM,
    prompt:  buildPrompt({ events }),
    schema:  SCHEMA,
    temperature: 0.3,
  });
}
