import { useEffect, useRef } from 'react';

// Wires navigator.mediaSession so OS lock-screen, notification, Bluetooth
// headset buttons, and hardware media keys drive playback. Feature-gated:
// no-op when the API isn't available (older Safari).
//
// `setPositionState` is throttled to 1 Hz — feeding it the 30 Hz progress
// stream would saturate the API on some browsers and they'd start ignoring
// updates entirely.
export function useMediaSession({ track, playing, player, setPlaying, goNext, goPrev }) {
  // Latest callbacks captured in a ref so the action handlers (registered
  // once) always call the freshest setPlaying / goNext / goPrev.
  const cb = useRef({ setPlaying, goNext, goPrev, player });
  cb.current = { setPlaying, goNext, goPrev, player };

  // Metadata update + an initial positionState push on track change.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      // Reset the OS scrubber so it doesn't keep showing the previous track's
      // duration. No-arg setPositionState() clears the state per spec.
      try { navigator.mediaSession.setPositionState(); } catch { /* unsupported in this UA */ }
      return;
    }
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title:  track.title  || '',
      artist: track.artist || '',
      album:  track.album  || '',
      artwork: track.imageUrl
        ? [{ src: track.imageUrl, sizes: '500x500', type: 'image/jpeg' }]
        : [],
    });
    const dur = player.getDurationSec();
    if (dur && Number.isFinite(dur)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          position: Math.min(dur, dur * player.getProgress()),
          playbackRate: 1,
        });
      } catch { /* some browsers throw on invalid state */ }
    }
    // We intentionally depend on the destructured track fields rather than the
    // whole track object so a new reference with identical contents doesn't
    // rewrite metadata every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.title, track?.artist, track?.album, track?.imageUrl, player]);

  // Mirror play/pause state into the OS UI.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!track) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing, track]);

  // Action handlers registered once. Refs keep them current.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play:           () => cb.current.setPlaying(true),
      pause:          () => cb.current.setPlaying(false),
      previoustrack:  () => cb.current.goPrev(),
      nexttrack:      () => cb.current.goNext(),
      seekbackward:   (d) => {
        const dur = cb.current.player.getDurationSec();
        if (!dur) return;
        const s = d?.seekOffset ?? 10;
        cb.current.player.seek(Math.max(0, cb.current.player.getProgress() - s / dur));
      },
      seekforward:    (d) => {
        const dur = cb.current.player.getDurationSec();
        if (!dur) return;
        const s = d?.seekOffset ?? 10;
        cb.current.player.seek(Math.min(1, cb.current.player.getProgress() + s / dur));
      },
      seekto:         (d) => {
        const dur = cb.current.player.getDurationSec();
        if (!dur || d?.seekTime == null) return;
        cb.current.player.seek(d.seekTime / dur);
      },
    };
    for (const [name, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(name, fn); } catch { /* unsupported in this UA */ }
    }
    return () => {
      for (const name of Object.keys(handlers)) {
        try { ms.setActionHandler(name, null); } catch { /* ignore */ }
      }
    };
  }, []);

  // 1 Hz position tick while playing so the OS scrubber stays in sync.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!playing || !track) return;
    const tick = () => {
      const dur = player.getDurationSec();
      if (!dur || !Number.isFinite(dur)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          position: Math.min(dur, dur * player.getProgress()),
          playbackRate: 1,
        });
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // Track id is enough — the tick reads the latest player state anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, track?.id, player]);
}
