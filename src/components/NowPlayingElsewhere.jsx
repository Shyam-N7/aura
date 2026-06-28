import { useState } from 'react';
import './NowPlayingElsewhere.css';

const keyOf = (d) => `${d?.deviceLabel}|${d?.track?.id}`;

// Passive, dismissible "you're also playing on another device" note. Awareness
// only — it never pauses or controls local playback. Shows the most-recent other
// device; dismiss is per device+track so a new song re-surfaces it.
export function NowPlayingElsewhere({ devices }) {
  const [dismissed, setDismissed] = useState(null);
  const d = devices?.[0];
  if (!d || dismissed === keyOf(d)) return null;
  const title = d.track?.title;
  return (
    <div className="aura-npe" role="status">
      <span className="aura-npe__dot" aria-hidden="true" />
      <span className="aura-npe__text">
        Playing{title ? ` “${title}”` : ''} on {d.deviceLabel || 'another device'}
      </span>
      <button type="button" className="aura-npe__x" aria-label="Dismiss" onClick={() => setDismissed(keyOf(d))}>×</button>
    </div>
  );
}
