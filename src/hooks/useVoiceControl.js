import { useCallback, useEffect, useRef, useState } from 'react';

// Push-to-talk wrapper around the browser Web Speech API (SpeechRecognition).
// Feature-detected: `supported` is false where the API is absent (e.g. older iOS
// Safari) so the UI can degrade honestly. start()/stop() bracket a single listen
// window (hold-to-talk); the final transcript is delivered via onResult. We read
// onResult through a ref so the caller can pass a fresh closure each render without
// re-creating the recognition object.
function getCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useVoiceControl({ onResult, lang } = {}) {
  const Ctor = getCtor();
  const supported = !!Ctor;
  const [listening, setListening] = useState(false);

  const recRef = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const langRef = useRef(lang);
  langRef.current = lang;

  const ensure = useCallback(() => {
    if (!supported) return null;
    if (recRef.current) return recRef.current;
    const rec = new Ctor();
    rec.continuous = false;       // one utterance per press
    rec.interimResults = false;   // final transcript only — commands, not dictation
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e?.results?.[0]?.[0]?.transcript ?? '';
      if (text) onResultRef.current?.(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return rec;
  }, [supported, Ctor]);

  const start = useCallback(() => {
    const rec = ensure();
    if (!rec) return;
    rec.lang = langRef.current || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    try { rec.start(); setListening(true); }
    catch { /* start() throws if already running — ignore */ }
  }, [ensure]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* ignore */ }
    setListening(false);   // eager; onend confirms
  }, []);

  // Release the mic + detach handlers on unmount so a half-open recognition can't
  // fire into an unmounted tree.
  useEffect(() => () => {
    const rec = recRef.current;
    if (!rec) return;
    rec.onresult = null; rec.onend = null; rec.onerror = null;
    try { rec.abort(); } catch { /* ignore */ }
  }, []);

  return { supported, listening, start, stop };
}
