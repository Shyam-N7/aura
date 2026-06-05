import { useEffect, useRef } from 'react';
import { like, unlike, isLiked } from './useLikes';
import { requestSearchFocus } from '../lib/searchFocus';
import { toggleShortcutsHelp, closeShortcutsHelp } from '../lib/shortcutsHelp';

const VOLUME_STEP = 0.05;
const SEEK_STEP_SEC = 10;

// Desktop-only global keyboard shortcuts. Bails out when typing in an input
// or when the hook is disabled (non-desktop breakpoint). Reads the latest
// callbacks through a ref so handlers don't need re-binding every render.
export function useKeyboardShortcuts({ enabled, playing, setPlaying, goNext, goPrev, player, track, onFocusSearch, onCycleRepeat, onShuffle }) {
  const cb = useRef({ enabled, playing, setPlaying, goNext, goPrev, player, track, onFocusSearch, onCycleRepeat, onShuffle });
  cb.current = { enabled, playing, setPlaying, goNext, goPrev, player, track, onFocusSearch, onCycleRepeat, onShuffle };

  useEffect(() => {
    const onKey = (e) => {
      if (!cb.current.enabled) return;

      // Don't hijack typing — and don't steal arrow/space from focused
      // sliders/buttons (they have native semantics). Esc always passes
      // through so overlays can close.
      const target = e.target;
      const tag = target?.tagName;
      const isTextField = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      const isRange    = tag === 'INPUT' && target.type === 'range';
      const isSlider   = isRange || target?.getAttribute?.('role') === 'slider';
      const isButton   = tag === 'BUTTON';
      if (isTextField || isSlider || isButton) {
        if (e.key !== 'Escape') return;
      }

      const { playing, setPlaying, goNext, goPrev, player, track, onFocusSearch } = cb.current;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          setPlaying(!playing);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) { goPrev(); }
          else seekBy(player, -SEEK_STEP_SEC);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) { goNext(); }
          else seekBy(player, +SEEK_STEP_SEC);
          return;
        case 'ArrowUp':
          e.preventDefault();
          stepVolume(player, +VOLUME_STEP);
          return;
        case 'ArrowDown':
          e.preventDefault();
          stepVolume(player, -VOLUME_STEP);
          return;
        case 'l':
        case 'L':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (!track?.id) return;
          if (isLiked(track.id)) unlike(track.id).catch(() => {});
          else like(track.id).catch(() => {});
          return;
        case 'm':
        case 'M':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (!player) return;
          player.setMuted(!player.isMuted());
          return;
        case 'r':
        case 'R':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          cb.current.onCycleRepeat?.();
          return;
        case 's':
        case 'S':
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          cb.current.onShuffle?.();
          return;
        case '/':
          if (e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (onFocusSearch) onFocusSearch();
          else requestSearchFocus();
          return;
        case '?':
          e.preventDefault();
          toggleShortcutsHelp();
          return;
        case 'Escape':
          closeShortcutsHelp();
          return;
        default:
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

function seekBy(player, deltaSec) {
  if (!player) return;
  const dur = player.getDurationSec();
  if (!dur) return;
  const next = Math.max(0, Math.min(1, player.getProgress() + deltaSec / dur));
  player.seek(next);
}
function stepVolume(player, delta) {
  if (!player) return;
  const next = Math.max(0, Math.min(1, player.getVolume() + delta));
  player.setVolume(next);
  if (player.isMuted() && next > 0) player.setMuted(false);
}
