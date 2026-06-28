import { useEffect, useRef, useState } from 'react';
import { isAuthed } from '../lib/auth';
import { sendHeartbeat, getNowPlaying } from '../lib/playback';

// Near-real-time "playing on another device" awareness. This device heartbeats its
// current track (~every 20s while playing, + on track/play-state change); it also
// polls for the user's OTHER devices that are currently playing, so the UI can show
// a passive note. Awareness only — it never interrupts local playback.
const HEARTBEAT_MS = 20_000;
const POLL_MS = 20_000;

export function usePlaybackPresence({ track, playing, progress }) {
  const [othersPlaying, setOthersPlaying] = useState([]);

  // Keep latest values in a ref so the heartbeat reads them without re-binding the
  // interval on every progress tick (~1/s).
  const ref = useRef({});
  ref.current = { track, playing, progress };
  // Only heartbeat once this device has actually played — so a cold-boot idle mount
  // (queue hydrated from localStorage, playing=false) doesn't overwrite this
  // device's real last-playback row with a progress-0 idle beat.
  const hasPlayed = useRef(false);

  const beat = (isPlayingOverride, opts) => {
    if (!isAuthed()) return;
    const { track: tk, playing: pl, progress: pr } = ref.current;
    sendHeartbeat({
      track: tk ? { id: tk.id, title: tk.title, artist: tk.artist, imageUrl: tk.imageUrl } : null,
      isPlaying: isPlayingOverride ?? (!!pl && !!tk),
      progress: pr ?? 0,
    }, opts);
  };

  // While playing: beat now + every 20s. On pause/stop: one "stopped" beat, but
  // only if we've actually played (never from a cold idle mount).
  useEffect(() => {
    if (!isAuthed()) return undefined;
    if (playing && ref.current.track) {
      hasPlayed.current = true;
      beat(true);
      const id = setInterval(() => beat(true), HEARTBEAT_MS);
      return () => clearInterval(id);
    }
    if (hasPlayed.current) beat(false);
    return undefined;
  }, [track?.id, playing]);

  // Best-effort "stopped" beat on tab hide/close — keepalive so it survives unload.
  useEffect(() => {
    const stop = () => { if (hasPlayed.current) beat(false, { keepalive: true }); };
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, []);

  // Poll the user's other devices, only while this tab is visible.
  useEffect(() => {
    if (!isAuthed()) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      const list = await getNowPlaying();
      if (!stop) setOthersPlaying(list);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  return othersPlaying;
}
