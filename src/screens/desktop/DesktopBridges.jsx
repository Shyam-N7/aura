import { useState } from 'react';
import { MOOD_BRIDGES } from '../../data';
import { MonoLabel } from '../../components/primitives';
import { getBridge } from '../../api/bridges';
import { toast } from '../../lib/toast';
import { BridgeCard } from './BridgeCard';
import './DesktopBridges.css';

export function DesktopBridges({ onPickSequence }) {
  const [loadingId, setLoadingId] = useState(null);

  const beginBridge = async (bridge) => {
    if (loadingId) return;
    setLoadingId(bridge.id);
    try {
      const { tracks } = await getBridge({ from: bridge.from, to: bridge.to, steps: bridge.steps });
      if (!tracks?.length) { toast('Couldn’t curate that bridge.'); return; }
      onPickSequence?.(tracks, 0, `bridge · ${bridge.from} → ${bridge.to}`);
    } catch (err) {
      toast(`Couldn’t load bridge — ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="aura-dbr">
      <div className="aura-dbr__header">
        <MonoLabel className="text-ink-faint" size={10}>
          mood bridges · gradual paths between feelings
        </MonoLabel>
        <h1 className="aura-dbr__hero">
          From here<br/><em>to there.</em>
        </h1>
        <p className="aura-dbr__sub">
          Songs threaded so the mood shifts gradually. Pick a path.
        </p>
      </div>

      <div className="aura-dbr__scroll">
        <div className="aura-dbr__grid">
          {MOOD_BRIDGES.map((b, i) => (
            <div key={b.id} className={loadingId === b.id ? 'aura-dbr__loading' : ''}>
              <BridgeCard bridge={b} idx={i} onClick={() => beginBridge(b)}/>
              {loadingId === b.id && (
                <MonoLabel className="text-ink-faint mt-2 block text-center" size={9}>
                  loading bridge
                </MonoLabel>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
