import { useEffect, useRef, useState } from 'react';
import { subscribePrompt, consumePromptPending } from '../lib/prompt';
import './PromptDialog.css';

// Outer subscribes to the bus; inner remounts on each new event via key so
// the input value, focus, and listeners reset cleanly without a setState
// inside an effect.
export function PromptDialog() {
  const [event, setEvent] = useState(null);
  useEffect(() => subscribePrompt(setEvent), []);
  if (!event) return null;
  return <PromptDialogBody event={event} key={event.id}/>;
}

function PromptDialogBody({ event }) {
  const [value, setValue] = useState(event.defaultValue ?? '');
  const inputRef = useRef(null);

  // Autofocus on mount; requestAnimationFrame so the input is in the DOM first.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape cancels. Backdrop click also cancels (handler below).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') consumePromptPending(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;
  const submit = () => { if (canSubmit) consumePromptPending(trimmed); };
  const cancel = () => consumePromptPending(null);

  return (
    <>
      <div className="aura-prompt-backdrop" onClick={cancel}/>
      <div className={`aura-prompt ${event.variant === 'glass' ? 'aura-prompt--glass' : ''}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="aura-prompt__title">{event.title}</div>
        {event.body && <div className="aura-prompt__body">{event.body}</div>}
        <form
          className="aura-prompt__form"
          onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            ref={inputRef}
            type="text"
            className="aura-prompt__input"
            placeholder={event.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck="false"/>
        </form>
        <div className="aura-prompt__actions">
          <button type="button" onClick={cancel}
            className="aura-prompt__btn aura-prompt__btn--cancel">
            {event.cancelLabel}
          </button>
          <button type="button" onClick={submit}
            disabled={!canSubmit}
            className="aura-prompt__btn aura-prompt__btn--submit">
            {event.submitLabel}
          </button>
        </div>
      </div>
    </>
  );
}
