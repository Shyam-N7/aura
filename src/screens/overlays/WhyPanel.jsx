import { useEffect, useState } from 'react';
import { MonoLabel, CircularDial } from '../../components/primitives';
import { getWhy } from '../../api/why';
import './WhyPanel.css';

export function WhyPanel({ track, mood, djName, onClose }) {
  const [hit, setHit] = useState({ key: null, data: null, error: null });
  const key = `${track.id}|${mood ?? 'any'}`;
  const status = hit.key === key
    ? (hit.error ? 'error' : hit.data ? 'ok' : 'loading')
    : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getWhy({ trackId: track.id, mood, signal: ctl.signal })
      .then(data => setHit({ key, data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ key, data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [track.id, mood, key]);

  return (
    <div className="absolute inset-0 z-[50] bg-bg text-ink flex flex-col px-7 pt-5 pb-[30px] overflow-auto animate-aura-sheet-in">
      <div className="flex justify-between items-center">
        <MonoLabel className="text-ink-soft">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-2 animate-aura-pulse"/>
          {djName} · reasoning
        </MonoLabel>
        <button onClick={onClose} className="aura-why-close">
          CLOSE ✕
        </button>
      </div>

      {status === 'loading' && <LoadingSkeleton/>}

      {status === 'error' && (
        <div className="mt-10">
          <MonoLabel className="text-ink-faint" size={9}>couldn’t reason</MonoLabel>
          <div className="mt-3 font-serif italic text-[20px] text-ink-soft text-pretty">
            {hit.error}
          </div>
          {hit.error?.includes('GEMINI_API_KEY') && (
            <MonoLabel className="text-ink-faint mt-3 block" size={9}>
              add GEMINI_API_KEY=… to .env.local, then restart the server
            </MonoLabel>
          )}
        </div>
      )}

      {status === 'ok' && hit.data && <Reason r={hit.data}/>}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="h-4 w-24 rounded bg-line animate-pulse"/>
      <div className="h-9 w-3/4 rounded bg-line animate-pulse"/>
      <div className="h-9 w-1/2 rounded bg-line animate-pulse"/>
      <div className="h-3 w-full rounded bg-line animate-pulse mt-2"/>
      <div className="h-3 w-5/6 rounded bg-line animate-pulse"/>
      <div className="h-px w-full bg-line mt-6"/>
      {[1,2,3].map(i => (
        <div key={i} className="h-3 w-2/3 rounded bg-line animate-pulse"/>
      ))}
    </div>
  );
}

function Reason({ r }) {
  return (
    <>
      <div className="mt-6">
        <MonoLabel className="text-ink-faint" size={9}>why · this song</MonoLabel>
        <div className="font-serif text-4xl leading-[1.05] tracking-[-0.02em] mt-2.5 text-pretty">
          {r.headline}
        </div>
        <div className="mt-4 font-serif text-[17px] leading-[1.5] text-ink-soft text-pretty">
          {r.body}
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3.5">
        <MonoLabel className="text-ink-faint" size={9}>matched on</MonoLabel>
        {(r.dimensions ?? []).map((d, i) => (
          <div key={i} className="pt-2.5 border-t border-line">
            <div className="flex justify-between items-baseline">
              <span className="font-serif text-[19px]">{d.label}</span>
              <MonoLabel className="text-ink-faint" size={10}>{(d.strength * 100 | 0)}%</MonoLabel>
            </div>
            <div className="font-mono text-[11px] text-ink-soft mt-1">{d.value}</div>
            <div className="h-0.5 bg-line mt-2 rounded-sm overflow-hidden">
              <div className="aura-why-strength-fill" style={{ '--fill': d.strength }}/>
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-[12px]"/>

      {(r.considered?.length ?? 0) > 0 && (
        <div className="mt-[22px] pt-[18px] border-t border-line">
          <MonoLabel className="text-ink-faint" size={9}>considered · ruled out</MonoLabel>
          <div className="flex flex-col gap-3 mt-3">
            {r.considered.map((c, i) => (
              <div key={i}>
                <div className="font-serif text-[17px]">
                  {c.title} <span className="text-ink-soft italic">— {c.artist}</span>
                </div>
                <MonoLabel className="text-ink-faint mt-[3px]" size={9.5}>{c.why}</MonoLabel>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-[22px] flex justify-between items-center">
        <MonoLabel className="text-ink-faint" size={9}>confidence</MonoLabel>
        <CircularDial size={44} progress={r.confidence ?? 0}
          accent="var(--color-accent)" track="var(--color-line)">
          <span className="font-mono text-[11px] text-ink">{((r.confidence ?? 0) * 100 | 0)}</span>
        </CircularDial>
      </div>
    </>
  );
}
