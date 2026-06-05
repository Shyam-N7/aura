import { useEffect, useState } from 'react';
import { subscribeConfirm, consumePending } from '../lib/confirm';
import './ConfirmDialog.css';

export function ConfirmDialog() {
  const [event, setEvent] = useState(null);

  useEffect(() => subscribeConfirm(setEvent), []);

  useEffect(() => {
    if (!event) return;
    const onKey = (e) => {
      if (e.key === 'Escape') consumePending(false);
      else if (e.key === 'Enter') consumePending(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [event]);

  if (!event) return null;

  return (
    <>
      <div className="aura-confirm-backdrop" onClick={() => consumePending(false)}/>
      <div className="aura-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="aura-confirm__title">{event.title}</div>
        {event.body && <div className="aura-confirm__body">{event.body}</div>}
        <div className="aura-confirm__actions">
          <button onClick={() => consumePending(false)}
            className="aura-confirm__btn aura-confirm__btn--cancel">
            {event.cancelLabel}
          </button>
          <button onClick={() => consumePending(true)}
            autoFocus
            className={`aura-confirm__btn ${event.danger ? 'aura-confirm__btn--danger' : 'aura-confirm__btn--confirm'}`}>
            {event.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
