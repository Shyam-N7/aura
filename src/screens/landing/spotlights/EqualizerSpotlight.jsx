import { useEffect, useRef } from 'react';
import { EqualizerControl } from '../../../components/player/Equalizer';
import { QUALITIES } from '../../../lib/audioQuality';
import { useAudioQuality } from '../../../hooks/useAudioQuality';
import { SimulatedAudioPlayer } from '../../../audio/SimulatedAudioPlayer';
import { chipPop } from '../useGsap';

// Spotlight: the REAL equalizer + audio-quality controls. The EQ popup reads /
// writes gains on a SimulatedAudioPlayer (full EQ + volume contract, no audio),
// so the 8-band curve, presets and volume are genuinely interactive. The audio
// quality pills are the same control as Settings, wired to the shared pref.
export function EqualizerSpotlight() {
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = new SimulatedAudioPlayer();
  useEffect(() => {
    const p = playerRef.current;
    return () => p?.destroy();
  }, []);
  const [quality, setQuality] = useAudioQuality();

  return (
    <div className="lp-eq lp-themes__card">
      <div className="lp-eq__row">
        <span className="lp-eq__label">equalizer</span>
        <EqualizerControl player={playerRef.current} />
      </div>
      <p className="lp-eq__hint">tap the bars to open the full 8-band equalizer, presets and volume.</p>

      <div className="lp-eq__quality">
        <span className="lp-eq__label">audio quality</span>
        <div className="lp-eq__pills">
          {QUALITIES.map((q) => (
            <button key={q.id} type="button"
              className={`lp-chip${quality === q.id ? ' is-on' : ''}`}
              aria-pressed={quality === q.id}
              onClick={(e) => { chipPop(e.currentTarget); setQuality(q.id); }}>
              {q.label}
            </button>
          ))}
        </div>
        <span className="lp-eq__caption">{QUALITIES.find((q) => q.id === quality)?.caption}</span>
      </div>
    </div>
  );
}
