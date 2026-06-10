import { useState, useEffect } from 'react';
import { MonoLabel, BreathingDot } from '../components/primitives';
import { formatLongStamp, partOfDay } from '../hooks/useNow';
import './SensingScreen.css';

export function SensingScreen({ djName, mood, onReady }) {
  // Snapshot the stamp + time-of-day at mount so the scripted intro doesn't
  // rewind if the minute rolls over mid-animation, and the copy matches the
  // actual hour (morning / afternoon / evening / night), not a fixed word.
  const [intro] = useState(() => {
    const d = new Date();
    return { stamp: formatLongStamp(d), part: partOfDay(d) };
  });
  const lines = [
    { t: 200,  text: intro.stamp },
    { t: 1100, text: 'Reading the moment' },
    { t: 2000, text: `Matching tracks to your ${intro.part}` },
    { t: 2900, text: 'Almost there' },
  ];
  const [shown, setShown] = useState(0);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    const tt = lines.map((l, i) => setTimeout(() => setShown(i + 1), l.t));
    const r = setTimeout(() => setReveal(true), 3700);
    const d = setTimeout(onReady, 5900);
    return () => { tt.forEach(clearTimeout); clearTimeout(r); clearTimeout(d); };
    // One-shot mount effect — lines/onReady are stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0 bg-bg text-ink flex flex-col pt-[72px] pb-10 px-8">
      <span className="inline-flex items-center gap-2">
        <span className="aura-sensing-dot-wrap">
          <span className="aura-sensing-dot-ring"/>
          <span className="aura-sensing-dot-ring aura-sensing-dot-ring--late"/>
          <BreathingDot color="var(--color-accent)"/>
        </span>
        <MonoLabel className="text-ink-soft">{djName} · sensing</MonoLabel>
      </span>
      <div className="flex-1 flex items-center justify-center relative">
        <div className="aura-sensing-breath-ring absolute w-[260px] h-[260px] rounded-full animate-aura-breathe"/>
        <div className="absolute w-40 h-40 rounded-full border border-accent/50 animate-[aura-breathe_3.6s_ease-in-out_infinite_0.5s]"/>
        <div className="w-3.5 h-3.5 rounded-full bg-accent shadow-[0_0_32px_var(--color-accent)] animate-aura-soft"/>
      </div>
      <div className="flex flex-col gap-2 min-h-[110px]">
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className="font-sans text-[14px] text-ink-soft animate-aura-line-in">
            {l.text}
          </div>
        ))}
      </div>
      <div className="mt-7 min-h-[110px]">
        <MonoLabel className="text-ink-faint" size={9}>Your mood</MonoLabel>
        <div
          className={`aura-sensing-mood ${reveal ? 'aura-sensing-mood--revealed' : ''} font-serif italic text-[68px] leading-none tracking-[-0.02em] mt-1.5 text-ink`}
        >{mood}.</div>
        <div
          className={`aura-sensing-tagline ${reveal ? 'aura-sensing-tagline--revealed' : ''} mt-3.5 font-sans text-[13px] text-ink-faint`}
        >Setting up your home…</div>
      </div>
    </div>
  );
}
