import { useState, useEffect } from 'react';
import { MonoLabel, BreathingDot } from '../components/primitives';
import { partOfDay } from '../hooks/useNow';
import { getCurrentMood } from '../api/mood';
import { getTopArtists } from '../api/stats';
import './SensingScreen.css';

export function SensingScreen({ name, djName, mood, onReady }) {
  // Snapshot the greeting at mount so the part-of-day / name don't shift if the
  // clock rolls over mid-animation. First name only — the greeting stays short.
  const [intro] = useState(() => {
    const part = partOfDay();
    const who = (name || djName || '').trim().split(/\s+/)[0];
    return { greeting: who ? `Good ${part}, ${who}` : `Good ${part}`, part };
  });
  // Live mood (with its song-grounded reason) + a one-line listening recap. Both
  // are best-effort: the intro never waits on the network, and a new account with
  // no history simply shows the neutral fallback line — no invented copy.
  const [snapshot, setSnapshot] = useState(null);
  const [recap, setRecap] = useState(null);
  useEffect(() => {
    const ctl = new AbortController();
    getCurrentMood({ signal: ctl.signal }).then(setSnapshot).catch(() => {});
    getTopArtists({ limit: 1, days: 30, signal: ctl.signal })
      .then(list => { const top = list?.[0]?.artist; if (top) setRecap(`back on a ${top} run`); })
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  // Only trust a confident read (same threshold NavRail uses); else fall back to
  // the provided default mood and show no reason.
  const confident = snapshot?.mood && snapshot.confidence >= 0.5;
  const liveMood = confident ? snapshot.mood : mood;
  const reason   = confident ? snapshot.reason : null;

  // The recap line slots in when it's ready; until then (and for no-history
  // accounts) the time-of-day line holds its place. Recomputed each render so a
  // late recap upgrades the line in place.
  const lines = [
    { t: 200,  text: intro.greeting },
    { t: 1100, text: 'Reading the moment' },
    { t: 2000, text: recap || `Matching tracks to your ${intro.part}` },
    { t: 2900, text: 'Almost there' },
  ];
  const [shown, setShown] = useState(0);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    const tt = lines.map((l, i) => setTimeout(() => setShown(i + 1), l.t));
    const r = setTimeout(() => setReveal(true), 3700);
    const d = setTimeout(onReady, 5900);
    return () => { tt.forEach(clearTimeout); clearTimeout(r); clearTimeout(d); };
    // One-shot mount effect — line timings/onReady are stable for this component's
    // lifetime; line TEXT is read from the live render, not this closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tap (or Enter/Space) anywhere skips straight to home. The mount effect's
  // cleanup clears the pending timers when this unmounts, so onReady fires once.
  return (
    <div className="absolute inset-0 bg-bg text-ink flex flex-col pt-[72px] pb-10 px-8 cursor-pointer"
      onClick={onReady} role="button" tabIndex={0} aria-label="Skip intro"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReady(); } }}>
      <span className="inline-flex items-center gap-2">
        <span className="aura-sensing-dot-wrap">
          <span className="aura-sensing-dot-ring"/>
          <span className="aura-sensing-dot-ring aura-sensing-dot-ring--late"/>
          <BreathingDot color="var(--color-accent)"/>
        </span>
        <MonoLabel className="text-ink-soft">sensing</MonoLabel>
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
        >{liveMood}.</div>
        <div
          className={`aura-sensing-tagline ${reveal ? 'aura-sensing-tagline--revealed' : ''} mt-3.5 font-sans text-[13px] text-ink-faint`}
        >{reveal && reason ? reason : 'Setting up your home…'}</div>
      </div>
      <MonoLabel className="text-ink-faint text-center mt-4" size={9}>tap to skip</MonoLabel>
    </div>
  );
}
