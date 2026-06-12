import { MonoLabel } from '../../components/primitives';
import { MOOD_COLOR } from './BridgeCard';

// The living itinerary: the bridge arc where every step is the actual album
// art it will play, with a one-word stage label under each rung and the
// LLM's narrative line beneath. Three states:
//   tracks    → art-filled journey (the "it already knows" moment)
//   loading   → ghost dots pulsing along the arc
//   neither   → plain interpolated dots (pre-curation preview)
// BridgeCard (shared with DesktopHome) stays untouched; this is the bridges
// screen's richer sibling, reusing its bezier + colour vocabulary.
const LOW_MOODS = ['sad', 'stressed', 'restless', 'tired', 'lonely'];
const W = 320, H = 84, BASE_Y = 32, AMP = 9, X0 = 16, X1 = W - 16;

export function BridgeItinerary({ bridge, tracks = null, narrative = '', loading = false, cta = null }) {
  const fromC = MOOD_COLOR[bridge.from] || '#7a3a1f';
  const toC   = MOOD_COLOR[bridge.to]   || '#7a3a1f';
  const dip   = LOW_MOODS.includes(bridge.from) ? 1 : -1;
  const n     = tracks?.length || bridge.steps;
  const cy1 = BASE_Y + dip * AMP, cy2 = BASE_Y - dip * AMP;
  const yAt = (tt) =>
    (1 - tt) ** 3 * BASE_Y + 3 * (1 - tt) ** 2 * tt * cy1 + 3 * (1 - tt) * tt ** 2 * cy2 + tt ** 3 * BASE_Y;

  return (
    <div className="aura-dbr-itin">
      <div className="aura-dbr-itin__moods">
        <span className="aura-dh-bridge-card__mood" style={{ color: fromC }}>{bridge.from}</span>
        <span className="aura-dh-bridge-card__mood" style={{ color: toC }}>{bridge.to}</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="aura-dbr-itin__svg">
        <defs>
          <linearGradient id={`itin-${bridge.id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor={fromC}/>
            <stop offset="100%" stopColor={toC}/>
          </linearGradient>
          {tracks?.map((t, i) => (
            <clipPath key={i} id={`itc-${bridge.id}-${i}`}>
              <circle cx={X0 + (n === 1 ? 0 : i / (n - 1)) * (X1 - X0)} cy={yAt(n === 1 ? 0 : i / (n - 1))} r="11"/>
            </clipPath>
          ))}
        </defs>
        <line x1={X0} x2={X1} y1={BASE_Y} y2={BASE_Y}
          stroke="var(--color-line)" strokeWidth="0.6" strokeDasharray="1.5 3"/>
        <path d={`M${X0} ${BASE_Y} C ${X0 + 96} ${cy1}, ${X1 - 96} ${cy2}, ${X1} ${BASE_Y}`}
          stroke={`url(#itin-${bridge.id})`} strokeWidth="1.8" fill="none" strokeLinecap="round"/>

        {Array.from({ length: n }).map((_, i) => {
          const tt = n === 1 ? 0 : i / (n - 1);
          const x = X0 + tt * (X1 - X0);
          const y = yAt(tt);
          const isEnd = i === 0 || i === n - 1;
          const col = i === 0 ? fromC
            : i === n - 1 ? toC
            : `color-mix(in oklab, ${fromC}, ${toC} ${(tt * 100).toFixed(0)}%)`;
          const track = tracks?.[i];

          if (!track) {
            return (
              <g key={i}>
                {isEnd && <circle cx={x} cy={y} r="5" fill={col} opacity="0.18"/>}
                <circle cx={x} cy={y} r={isEnd ? 3 : 2} fill={col}
                  className={loading ? 'aura-dbr-itin__ghost' : undefined}
                  style={loading ? { animationDelay: `${i * 140}ms` } : undefined}/>
              </g>
            );
          }
          return (
            <g key={i}>
              {isEnd && <circle cx={x} cy={y} r="14" fill={col} opacity="0.18"/>}
              {track.imageUrl
                ? <image href={track.imageUrl} x={x - 11} y={y - 11} width="22" height="22"
                    clipPath={`url(#itc-${bridge.id}-${i})`} preserveAspectRatio="xMidYMid slice"/>
                : <circle cx={x} cy={y} r="11" fill={col} opacity="0.5"/>}
              <circle cx={x} cy={y} r="11" fill="none" stroke={col} strokeWidth="1.1"/>
              {track.stepLabel && (
                // Edge labels anchor inward so the first/last words never spill
                // past the viewBox and get clipped (a centered "unwinding" under
                // the leftmost dot at x=16 loses its first letters otherwise).
                <text
                  x={i === 0 ? X0 - 12 : i === n - 1 ? X1 + 12 : x}
                  y={y + 21}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  className="aura-dbr-itin__label">
                  {track.stepLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {loading && (
        <MonoLabel className="text-ink-faint aura-dbr-itin__curating" size={9}>
          curating your bridge
        </MonoLabel>
      )}
      {!loading && narrative && <p className="aura-dbr-itin__narrative">{narrative}</p>}
      {!loading && cta && (
        <button type="button" className="aura-dbr-itin__cta"
          onClick={(e) => cta.onClick(e.currentTarget)}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
