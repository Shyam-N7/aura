import { MonoLabel } from '../../components/primitives';

const MOOD_COLOR = {
  // where you are
  sad: '#5a6b9a', stressed: '#a85a5a', restless: '#c2603a', tired: '#7a6f8a', lonely: '#5a7a8a',
  // where you want to be
  happy: '#d8956a', calm: '#5a8a72', focused: '#6e85a3', energized: '#c47554', social: '#a8556a',
};

export function BridgeCard({ bridge, idx, onClick }) {
  const fromC = MOOD_COLOR[bridge.from] || bridge.accent;
  const toC   = MOOD_COLOR[bridge.to]   || bridge.accent;
  const dip   = ['sad', 'stressed', 'restless', 'tired', 'lonely'].includes(bridge.from) ? 1 : -1;
  return (
    <button onClick={onClick} className="aura-dh-bridge-card">
      <div className="flex justify-between items-center">
        <MonoLabel className="text-ink-faint" size={9}>path · {String(idx+1).padStart(2,'0')}</MonoLabel>
        <MonoLabel className="text-ink-soft" size={9}>{bridge.steps} tracks · {bridge.ETA}</MonoLabel>
      </div>
      <div className="flex justify-between items-baseline mt-1">
        <div className="aura-dh-bridge-card__mood" style={{ color: fromC }}>{bridge.from}</div>
        <div className="aura-dh-bridge-card__mood" style={{ color: toC }}>{bridge.to}</div>
      </div>
      <svg viewBox="0 0 320 30" className="w-full h-9 mt-1 block">
        <defs>
          <linearGradient id={`arc-dh-${bridge.id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor={fromC}/>
            <stop offset="100%" stopColor={toC}/>
          </linearGradient>
        </defs>
        <line x1="4" x2="316" y1="15" y2="15" stroke="var(--color-line)" strokeWidth="0.6" strokeDasharray="1.5 3"/>
        <path d={`M4 15 C 100 ${15 + dip*8}, 220 ${15 - dip*8}, 316 15`}
          stroke={`url(#arc-dh-${bridge.id})`} strokeWidth="1.8" fill="none" strokeLinecap="round"/>
        {Array.from({ length: bridge.steps }).map((_, i) => {
          const tt = i / (bridge.steps - 1);
          const x = 4 + tt * 312;
          const cy1 = 15 + dip*8, cy2 = 15 - dip*8;
          const y = (1-tt)**3 * 15 + 3*(1-tt)**2*tt*cy1 + 3*(1-tt)*tt**2*cy2 + tt**3 * 15;
          const isEnd = i === 0 || i === bridge.steps - 1;
          const col = i === 0 ? fromC : (i === bridge.steps - 1 ? toC : `color-mix(in oklab, ${fromC}, ${toC} ${(tt*100).toFixed(0)}%)`);
          return (
            <g key={i}>
              {isEnd && <circle cx={x} cy={y} r="5" fill={col} opacity="0.18"/>}
              <circle cx={x} cy={y} r={isEnd ? 3 : 2} fill={col}/>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between mt-2 pt-3 border-t border-line">
        <MonoLabel className="text-ink-soft" size={9}>gradual · 1 song per step</MonoLabel>
        <span className="text-accent font-sans font-medium text-[9.5px] tracking-[0.08em] uppercase">begin →</span>
      </div>
    </button>
  );
}
