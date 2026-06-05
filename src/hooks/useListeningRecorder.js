import { useEffect, useRef } from 'react';
import { postEvent } from '../api/events';

// Subscribes to the audio player and posts listening events to the backend.
// Records:
//   - 'play'  whenever a new track starts playing
//   - 'skip'  whenever the active track changes while another was still mid-play
//   - 'end'   when the player emits 'ended' on the current track
//   - 'seek'  is intentionally not recorded yet (would be high-frequency)
//   - 'pause' is recorded once per pause event
//
// Mood/language are snapshotted into refs so the player-event callbacks always
// see the current values without re-binding subscriptions on every change.
export function useListeningRecorder({ player, track, mood, language }) {
  const ctxRef = useRef({ track, mood, language, playedOnce: false });
  ctxRef.current.track    = track;
  ctxRef.current.mood     = mood;
  ctxRef.current.language = language;

  // Track id changes → emit a skip for the previous track if it had been
  // playing, then arm the new track for its first 'play' event.
  const prevIdRef = useRef(null);
  useEffect(() => {
    const prevId = prevIdRef.current;
    if (prevId && prevId !== track?.id && ctxRef.current.playedOnce) {
      postEvent(prevId, 'skip', { mood: ctxRef.current.mood, language: ctxRef.current.language });
    }
    prevIdRef.current = track?.id ?? null;
    ctxRef.current.playedOnce = false;
  }, [track?.id]);

  useEffect(() => {
    if (!player) return undefined;
    const offPlay = player.on('play', () => {
      const c = ctxRef.current;
      if (!c.track?.id) return;
      if (!c.playedOnce) {
        c.playedOnce = true;
        postEvent(c.track.id, 'play', {
          position_sec: player.getProgress?.() * (c.track.durationSec ?? 0) || 0,
          mood: c.mood, language: c.track.language ?? c.language,
        });
      }
    });
    const offPause = player.on('pause', () => {
      const c = ctxRef.current;
      if (!c.track?.id || !c.playedOnce) return;
      postEvent(c.track.id, 'pause', {
        position_sec: player.getProgress?.() * (c.track.durationSec ?? 0) || 0,
        mood: c.mood, language: c.track.language ?? c.language,
      });
    });
    const offEnded = player.on('ended', () => {
      const c = ctxRef.current;
      if (!c.track?.id) return;
      postEvent(c.track.id, 'end', {
        position_sec: c.track.durationSec ?? null,
        mood: c.mood, language: c.track.language ?? c.language,
      });
      c.playedOnce = false;
    });
    return () => { offPlay(); offPause(); offEnded(); };
  }, [player]);
}
