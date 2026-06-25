import { useEffect, useRef, useState } from 'react';
import { subscribePrompt, consumePromptPending } from '../lib/prompt';
import { AuraLoader } from './feedback/AuraLoader';
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
  // True while an async onSubmit is in flight — the dialog stays open showing a
  // loader instead of the form, and can't be cancelled out from under the work.
  const [busy, setBusy]   = useState(false);
  const inputRef = useRef(null);

  // Autofocus on mount; requestAnimationFrame so the input is in the DOM first.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape cancels — but not while a submit is in flight. Backdrop click too.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) consumePromptPending(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;
  const cancel = () => { if (!busy) consumePromptPending(null); };
  const submit = async () => {
    if (!canSubmit || busy) return;
    // With an async onSubmit, hold the dialog open + show the loader until the
    // caller's work resolves, then close. Otherwise resolve immediately as before.
    if (event.onSubmit) {
      setBusy(true);
      try { await event.onSubmit(trimmed); }
      catch { /* the handler owns its own error feedback (toast) */ }
      consumePromptPending(trimmed);
      return;
    }
    consumePromptPending(trimmed);
  };

  const busyLabel = typeof event.busyLabel === 'function'
    ? event.busyLabel(trimmed)
    : (event.busyLabel ?? 'working…');

  return (
    <>
      <div className="aura-prompt-backdrop" onClick={cancel}/>
      <div className={`aura-prompt ${event.variant === 'glass' ? 'aura-prompt--glass' : ''}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="aura-prompt__title">{event.title}</div>
        {event.body && <div className="aura-prompt__body">{event.body}</div>}
        {busy ? (
          <AuraLoader label={busyLabel}/>
        ) : (
          <>
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
          </>
        )}
      </div>
    </>
  );
}
