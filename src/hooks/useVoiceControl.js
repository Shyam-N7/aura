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
  // A single recognition object is reused; a fast re-press (start() while the prior
  // listen is still finalizing) throws InvalidStateError. Rather than swallow it and
  // strand the new turn, we abort the prior listen, suppress its now-stale result,
  // and re-arm once it has actually ended — so a re-press reliably wins.
  const pendingRestartRef = useRef(false);
  const suppressResultRef = useRef(false);

  const ensure = useCallback(() => {
    if (!supported) return null;
    if (recRef.current) return recRef.current;
    const rec = new Ctor();
    rec.continuous = false;       // one utterance per press
    rec.interimResults = false;   // final transcript only — commands, not dictation
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (suppressResultRef.current) { suppressResultRef.current = false; return; }  // stale: superseded by a re-press
      const text = e?.results?.[0]?.[0]?.transcript ?? '';
      if (text) onResultRef.current?.(text.trim());
    };
    rec.onend = () => {
      setListening(false);
      if (pendingRestartRef.current) {
        pendingRestartRef.current = false;
        try { rec.start(); setListening(true); }   // re-arm for the re-press that couldn't start earlier
        catch { /* ignore */ }
      }
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return rec;
  }, [supported, Ctor]);

  const start = useCallback(() => {
    const rec = ensure();
    if (!rec) return;
    rec.lang = langRef.current || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    try {
      rec.start();
      setListening(true);
    } catch {
      // Already finalizing a prior listen — drop its (stale) result and re-arm on end.
      suppressResultRef.current = true;
      pendingRestartRef.current = true;
      try { rec.abort(); } catch { /* ignore */ }
    }
  }, [ensure]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    pendingRestartRef.current = false;   // a release cancels any queued re-arm
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
