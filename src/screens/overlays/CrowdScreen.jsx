import { CROWD } from '../../data';
import { MonoLabel } from '../../components/primitives';
import { fmtTime } from '../../utils/fmtTime';
import './CrowdScreen.css';

export function CrowdScreen({ track, mood, onClose }) {
  const count = CROWD.length * 31;
  return (
    <div className="absolute inset-0 bg-bg text-ink flex flex-col pt-5 animate-aura-sheet-in">
      <div className="pt-1 px-7 flex justify-between">
        <MonoLabel className="text-ink-soft">with you · right now</MonoLabel>
        <button onClick={onClose}
          className="bg-transparent border-0 text-ink-soft cursor-pointer font-sans font-medium text-[10px] tracking-[0.08em]">
          CLOSE ✕
        </button>
      </div>
      <div className="pt-[18px] px-7">
        <div className="font-serif text-[66px] leading-none tracking-[-0.02em]">{count}</div>
        <div className="mt-1.5">
          <MonoLabel className="text-ink-soft">people · listening to {track.title.toLowerCase()}</MonoLabel>
        </div>
        <MonoLabel className="text-ink-faint mt-2.5 block" size={9}>
          matched on mood ·{' '}
          <span className="font-serif italic text-xs normal-case tracking-normal">{mood}</span>
        </MonoLabel>
      </div>

      <div className="flex-1 overflow-auto px-7 pt-6 pb-7">
        {CROWD.map((p, i) => (
          <div key={i} className="flex items-center gap-3.5 py-3.5 border-b border-line">
            <div
              className="aura-crowd-avatar w-10 h-10 rounded-full flex items-center justify-center font-serif text-sm text-white italic"
              style={{ '--avatar-c0': p.palette[0], '--avatar-c1': p.palette[1] }}
            >{p.initials.toLowerCase()}</div>
            <div className="flex-1">
              <div className="font-serif text-lg leading-none">{p.name}</div>
              <MonoLabel className="text-ink-faint mt-1 block" size={9}>{p.city} · joined at {fmtTime(p.joinedSec)}</MonoLabel>
            </div>
            <div className="w-[5px] h-[5px] rounded-full bg-accent animate-aura-pulse"/>
          </div>
        ))}
      </div>
    </div>
  );
}
