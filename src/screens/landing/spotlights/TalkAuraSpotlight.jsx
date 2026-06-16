import { useEffect, useRef, useState } from 'react';
import { AuraMark, MonoLabel } from '../../../components/primitives';
import { TALK_SUGGESTIONS, TALK_SCRIPT, TALK_DEFAULT_REPLY } from '../showcaseData';
import '../../../components/chat/TalkAura.css'; // .aura-thinking-dot animation

// Spotlight: the real talk-to-AURA chat, scripted. Reuses the exact bubble
// styling from TalkAura (serif-italic AURA turns, pill user turns, thinking
// dots, suggestion chips) but answers from a local script — no talk() API.
export function TalkAuraSpotlight() {
  const [messages, setMessages] = useState([
    { who: 'aura', text: "i'm reading you as calm right now. the set is built around that — but tell me how it actually feels and i'll shift it." },
  ]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);
  const timer = useRef(0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = (text) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setMessages((m) => [...m, { who: 'you', text: trimmed }]);
    setDraft('');
    setThinking(true);
    timer.current = setTimeout(() => {
      const reply = TALK_SCRIPT[trimmed.toLowerCase()] ?? TALK_DEFAULT_REPLY;
      setMessages((m) => [...m, { who: 'aura', text: reply }]);
      setThinking(false);
    }, 750);
  };

  return (
    <div className="lp-talk">
      <div className="lp-talk__head">
        <AuraMark size={22} />
        <span className="lp-talk__brand">talk to aura</span>
      </div>

      <div ref={scrollRef} className="lp-talk__msgs">
        {messages.map((m, i) => {
          const isAura = m.who === 'aura';
          const bubbleCls = isAura
            ? 'font-serif italic text-[14px] tracking-[-0.005em] p-0 bg-transparent rounded-none'
            : 'text-[15px] tracking-normal py-2 px-3 rounded-2xl bg-black/5';
          return (
            <div key={i} className={`max-w-[85%] flex flex-col gap-1 animate-aura-rise ${isAura ? 'self-start' : 'self-end'}`}>
              <MonoLabel className="text-ink-faint" size={isAura ? 11 : 9}>{isAura ? 'aura' : 'you'}</MonoLabel>
              <div className={`leading-[1.35] text-ink text-pretty ${bubbleCls}`}>{m.text}</div>
            </div>
          );
        })}
        {thinking && (
          <div className="self-start flex gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="aura-thinking-dot w-1.5 h-1.5 rounded-md bg-ink-faint"
                style={{ '--aura-thinking-delay': `${i * 0.18}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="lp-talk__chips">
        {TALK_SUGGESTIONS.map((s, i) => (
          <button key={i} type="button" onClick={() => send(s)} disabled={thinking}
            className="px-2.5 py-[5px] rounded-full cursor-pointer bg-transparent border border-ink-faint/25 text-ink-soft font-sans font-medium text-[9.5px] tracking-[0.10em] disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      <form className="lp-talk__form" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="tell aura how it feels…"
          className="flex-1 bg-transparent border-0 outline-none text-ink py-2.5 px-3 font-serif italic text-lg" />
        <button type="submit" disabled={thinking || !draft.trim()}
          className="w-10 h-10 rounded-full border-0 cursor-pointer bg-accent text-bg flex items-center justify-center disabled:opacity-50">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M1 7 L13 7 M8 2 L13 7 L8 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
