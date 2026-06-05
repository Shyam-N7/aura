// Mood inference — read the listener's last ~30 plays and classify their
// current emotional state into one of six AURA moods. Drift tells us whether
// the recent half is hotter, colder, or about the same as the older half.

import { generateJson } from '../llm.js';

const MOODS = ['restless', 'focused', 'calm', 'upbeat', 'warm', 'social'];

const SYSTEM = `you classify a listener's current mood from their recent listening events.
return JSON matching the schema. one of six moods:

- restless — searching, can't settle. lots of skips, short listens, genre hopping.
- focused  — sustained engagement on instrumental / mid-energy / single-language. work mode.
- calm     — slow, melancholic, lyrical. evening listening. one or two artists deep.
- upbeat   — energetic, danceable, high BPM, full play-throughs.
- warm     — soft, romantic, ballads. long listens, repeats of the same emotional register.
- social   — party/dance/hip-hop, mixed languages, surface-level engagement.

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
  },
  required: ['mood', 'confidence', 'drift'],
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

classify the current mood per the schema.`;
}

export async function generateMoodInference({ events }) {
  return generateJson({
    system:  SYSTEM,
    prompt:  buildPrompt({ events }),
    schema:  SCHEMA,
    temperature: 0.3,
  });
}
