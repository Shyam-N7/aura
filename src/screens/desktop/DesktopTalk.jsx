import { useEffect, useRef, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { NowPlayingBanner } from '../../components/player/NowPlayingBanner';
import { talk } from '../../api/talk';
import { useTalkHistory } from '../../hooks/useTalkHistory';
import './DesktopTalk.css';

const SUGGESTIONS = [
  'Take me somewhere quieter',
  'I need to focus',
  'Something with more weight',
  'Play Tamil indie',
  'Lift me out of this mood',
  'Play something nostalgic',
];

export function DesktopTalk({ djName = 'aura', mood, track, onOpenPlayer, onPickSequence }) {
  const seed = { who: 'aura', text: `I’m reading you as ${mood}. Tell me how it actually feels.` };
  const { messages, addMessage, resetMessages } = useTalkHistory(seed);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const youMsg = { who: 'you', text: trimmed };
    addMessage(youMsg);
    const nextHistory = [...messages, youMsg];
    setDraft('');
    setThinking(true);
    try {
      const { reply, tracks, action, suggestions } = await talk({ message: trimmed, history: nextHistory, context: { mood } });
      const intentCount = (typeof action?.count === 'number' && action.count > 0) ? action.count : tracks?.length ?? 0;
      addMessage({ who: 'aura', text: reply, tracks: tracks?.length ? tracks : null, intentCount, suggestions: suggestions?.length ? suggestions : undefined });
    } catch (err) {
      addMessage({ who: 'aura', text: `Couldn’t reach the DJ — ${err.message}`, error: true });
    } finally {
      setThinking(false);
    }
  };

  const playSet = (tracks) => {
    if (!tracks?.length) return;
    onPickSequence?.(tracks, 0, 'Suggested for you');
  };

  const dj = djName;

  // Chips follow the conversation: latest aura turn with suggestions wins,
  // static list covers the first turn and error turns.
  const latest = [...messages].reverse().find(m => m.who === 'aura' && m.suggestions?.length);
  const chips = latest?.suggestions ?? SUGGESTIONS;

  return (
    <div ref={scrollRef} className="aura-dtk">
      <div className="aura-dtk__header">
        <div className="flex items-center justify-between">
          <MonoLabel className="text-ink-faint" size={10}>Talk · Always-on · {dj} listening</MonoLabel>
          {messages.length > 1 && (
            <button type="button" onClick={resetMessages} className="aura-dtk__clear">
              Clear
            </button>
          )}
        </div>
        <h1 className="aura-dtk__hero">
          Talk to <em>{dj}.</em>
        </h1>
        <p className="aura-dtk__sub">
          Tell me what you want to hear, how you feel, or where to take you next.
        </p>
        <NowPlayingBanner track={track} variant="talk-desktop" label="now playing" onOpen={onOpenPlayer}/>
      </div>

      <div className="aura-dtk__scroll">
        {messages.map((m, i) => {
          const isAura = m.who === 'aura';
          return (
            <div key={i} className={`aura-dtk__msg ${isAura ? 'aura-dtk__msg--aura' : 'aura-dtk__msg--you'}`}>
              <MonoLabel className="text-ink-faint mb-1.5 block" size={9}>{isAura ? dj : 'you'}</MonoLabel>
              <div className={isAura ? 'aura-dtk__bubble-aura' : 'aura-dtk__bubble-you'}>
                {m.text}
              </div>
              {m.tracks && (
                <button onClick={() => playSet(m.tracks)} className="aura-dtk__playset">
                  <span className="aura-dtk__playset-dot">
                    <svg width="8" height="10" viewBox="0 0 7 9"><path d="M0 0 L7 4.5 L0 9 Z" fill="currentColor"/></svg>
                  </span>
                  {(m.intentCount ?? m.tracks.length) === 1 ? 'Play song' : `Play set · ${m.tracks.length}`}
                </button>
              )}
            </div>
          );
        })}
        {thinking && (
          <div className="aura-dtk__thinking">
            {[0,1,2].map(i => (
              <span key={i} className="aura-thinking-dot w-1.5 h-1.5 rounded-md bg-ink-faint"
                style={{ '--aura-thinking-delay': `${i*0.18}s` }}/>
            ))}
          </div>
        )}
      </div>

      <div className="aura-dtk__compose">
        <div className="aura-dtk__suggestions">
          {chips.map((s, i) => (
            <button key={i} onClick={() => send(s)} disabled={thinking} className="aura-dtk__chip">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="aura-dtk__form">
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={`Tell ${dj} how it feels…`} className="aura-dtk__input"/>
          <button type="submit" disabled={thinking || !draft.trim()} aria-label="send" className="aura-dtk__send">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M1 7 L13 7 M8 2 L13 7 L8 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
