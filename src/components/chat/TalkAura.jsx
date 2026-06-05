import { useState, useRef, useEffect } from 'react';
import { MonoLabel } from '../primitives';
import { talk } from '../../api/talk';
import './TalkAura.css';

const SUGGESTIONS = [
  'take me somewhere quieter',
  'i need to focus',
  'something with more weight',
  'play tamil indie',
];

export function TalkAura({ djName, mood, onClose, onPickSequence }) {
  const [messages, setMessages] = useState([
    { who: 'aura', text: `i'm reading you as ${mood} right now. the set is built around that — but tell me how it actually feels and i'll shift it.` },
  ]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const nextHistory = [...messages, { who: 'you', text: trimmed }];
    setMessages(nextHistory);
    setDraft('');
    setThinking(true);
    try {
      const { reply, tracks } = await talk({
        message: trimmed,
        history: nextHistory,
        context: { mood },
      });
      setMessages(m => [...m, { who: 'aura', text: reply, tracks: tracks?.length ? tracks : null }]);
    } catch (err) {
      setMessages(m => [...m, { who: 'aura', text: `couldn’t reach the dj — ${err.message}`, error: true }]);
    } finally {
      setThinking(false);
    }
  };

  const playSet = (tracks) => {
    if (!tracks?.length) return;
    onPickSequence?.(tracks, 0, 'Suggested for you');
    onClose();
  };

  return (
    <div className="absolute inset-0 z-30 text-ink flex flex-col pt-[54px] animate-aura-rise
                    bg-[rgb(255_250_242/0.96)] dark:bg-[rgb(10_9_8/0.94)]
                    backdrop-blur-[40px]">
      <div className="px-[22px] py-2 pb-4 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-[10px] bg-accent shadow-[0_0_12px_var(--color-accent)] animate-[aura-soft_1.6s_ease-in-out_infinite]"/>
          <MonoLabel className="text-ink-soft">{djName} · listening</MonoLabel>
        </div>
        <button onClick={onClose}
          className="bg-transparent border-0 text-ink-soft cursor-pointer font-sans font-medium text-[10px] tracking-[0.08em]
                     px-2.5 py-1 rounded-full transition-colors duration-150
                     hover:bg-[rgb(0_0_0/0.05)] hover:text-ink dark:hover:bg-white/[0.06]">
          CLOSE ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto px-[22px] pt-2 pb-3 flex flex-col gap-3.5">
        {messages.map((m, i) => {
          const isAura = m.who === 'aura';
          const bubbleCls = isAura
            ? 'font-serif italic text-[21px] tracking-[-0.005em] p-0 bg-transparent rounded-none'
            : 'text-[15px] tracking-normal py-2 px-3 rounded-2xl bg-black/5 dark:bg-white/[0.08]';
          return (
            <div key={i}
              className={`max-w-[85%] flex flex-col gap-1 animate-aura-rise ${isAura ? 'self-start' : 'self-end'}`}>
              <MonoLabel className="text-ink-faint" size={9}>
                {isAura ? djName : 'you'}
              </MonoLabel>
              <div className={`leading-[1.35] ${m.error ? 'text-ink-soft' : 'text-ink'} text-pretty ${bubbleCls}`}>{m.text}</div>
              {m.tracks && (
                <button onClick={() => playSet(m.tracks)}
                  className="mt-1.5 self-start flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full cursor-pointer
                             bg-transparent border border-accent text-ink hover:bg-accent/10 transition-colors">
                  <span className="w-[22px] h-[22px] rounded-full bg-accent inline-flex items-center justify-center text-bg">
                    <svg width="7" height="9" viewBox="0 0 7 9"><path d="M0 0 L7 4.5 L0 9 Z" fill="currentColor"/></svg>
                  </span>
                  <span className="font-sans font-medium text-[9.5px] tracking-[0.08em] uppercase">
                    {m.tracks.length === 1 ? 'play song' : `play set · ${m.tracks.length}`}
                  </span>
                </button>
              )}
            </div>
          );
        })}
        {thinking && (
          <div className="self-start flex gap-1 py-1">
            {[0,1,2].map(i => (
              <span key={i}
                className="aura-thinking-dot w-1.5 h-1.5 rounded-md bg-ink-faint"
                style={{ '--aura-thinking-delay': `${i * 0.18}s` }}/>
            ))}
          </div>
        )}
      </div>

      <div className="pt-1 px-[22px] pb-2 flex gap-1.5 flex-wrap">
        {SUGGESTIONS.map((s, i) => (
          <button key={i} onClick={() => send(s)} disabled={thinking}
            className="px-2.5 py-[5px] rounded-full cursor-pointer
                       bg-transparent border border-ink-faint/25 text-ink-soft
                       font-sans font-medium text-[9.5px] tracking-[0.10em]
                       disabled:opacity-50 disabled:cursor-default">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="pt-2.5 px-3.5 pb-7 flex gap-2 items-center border-t border-ink-faint/15">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`tell ${djName.toLowerCase()} how it feels…`}
          className="flex-1 bg-transparent border-0 outline-none text-ink py-2.5 px-3
                     font-serif italic text-lg"
        />
        <button type="submit" disabled={thinking || !draft.trim()}
          className="w-10 h-10 rounded-full border-0 cursor-pointer bg-accent text-bg flex items-center justify-center
                     disabled:opacity-50 disabled:cursor-default">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M1 7 L13 7 M8 2 L13 7 L8 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </form>
    </div>
  );
}
