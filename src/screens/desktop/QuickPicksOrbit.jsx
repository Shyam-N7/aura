import { useState } from 'react';
import { AlbumArt } from '../../components/album/AlbumArt';
import { cleanTitle } from '../../utils/title';
import './QuickPicksOrbit.css';

// Quick picks as an orbital ring: album discs orbit a central shuffle-all hub,
// echoing the AURA concentric-rings mark. Hovering/focusing a disc lifts it and
// shows its name in the hub; the hub itself shuffles them all. Tap a disc to
// play it. The whole thing is a square that scales down on small screens.
export function QuickPicksOrbit({ tracks, onPlay, onShuffle }) {
  const [active, setActive] = useState(null);
  const n = tracks.length;
  if (!n) return null;

  return (
    <div className="aura-qpo">
      <div className="aura-qpo__ring">
        {tracks.map((t, i) => {
          // Evenly spaced around the circle, starting at the top (-90°).
          const a = (-90 + (360 / n) * i) * (Math.PI / 180);
          const x = 50 + 38 * Math.cos(a);
          const y = 50 + 38 * Math.sin(a);
          const on = active?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`aura-qpo__disc ${on ? 'is-active' : ''}`}
              style={{ left: `${x}%`, top: `${y}%`, '--i': i }}
              onMouseEnter={() => setActive(t)}
              onMouseLeave={() => setActive((cur) => (cur?.id === t.id ? null : cur))}
              onFocus={() => setActive(t)}
              onBlur={() => setActive((cur) => (cur?.id === t.id ? null : cur))}
              onClick={() => onPlay?.(t)}
              aria-label={`play ${cleanTitle(t.title)}${t.artist ? ` by ${t.artist}` : ''}`}
            >
              <span className="aura-qpo__disc-art">
                <AlbumArt track={t} radius={999} style={{ width: '100%', height: '100%' }}/>
              </span>
              <span className="aura-qpo__name">{cleanTitle(t.title)}</span>
            </button>
          );
        })}

        <button type="button" className="aura-qpo__hub" onClick={() => onShuffle?.()}
          aria-label="shuffle all quick picks">
          <span className="aura-qpo__hub-ring aura-qpo__hub-ring--a" aria-hidden="true"/>
          <span className="aura-qpo__hub-ring aura-qpo__hub-ring--b" aria-hidden="true"/>
          {active ? (
            <span className="aura-qpo__hub-now">
              <span className="aura-qpo__hub-title">{cleanTitle(active.title)}</span>
              <span className="aura-qpo__hub-artist">{(active.artist ?? '').toLowerCase()}</span>
              {active.reason && <span className="aura-qpo__hub-reason">{active.reason}</span>}
            </span>
          ) : (
            <span className="aura-qpo__hub-cta">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5 H6 L14 15 H17 M14 5 H17 M3 15 H6 L9 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 3 L17 5 L15 7 M15 13 L17 15 L15 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="aura-qpo__hub-label">shuffle all</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
