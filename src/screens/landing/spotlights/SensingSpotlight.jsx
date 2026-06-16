import { useState } from 'react';
import { SensingScreen } from '../../SensingScreen';
import { SENSING_MOODS } from '../showcaseData';

// Spotlight: the REAL boot "reading your mood" sequence. SensingScreen renders
// absolute-inset, so we frame it; onReady is a no-op here (no navigation), and
// "read again" remounts it (via key) to replay, cycling moods.
export function SensingSpotlight() {
  const [run, setRun] = useState(0);
  const mood = SENSING_MOODS[run % SENSING_MOODS.length];
  return (
    <div className="lp-sensing">
      <div className="lp-sensing__frame" key={run}>
        <SensingScreen mood={mood} onReady={() => {}} />
      </div>
      <button type="button" className="lp-chip" onClick={() => setRun((r) => r + 1)}>
        read again →
      </button>
    </div>
  );
}
