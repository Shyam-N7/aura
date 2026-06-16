import { useEffect, useRef, useState } from 'react';
import { MorphingAlbumArt } from '../../../components/album/MorphingAlbumArt';
import { ProgressRibbon } from '../../../components/player/ProgressRibbon';
import { SimulatedAudioPlayer } from '../../../audio/SimulatedAudioPlayer';
import { fmtTime } from '../../../utils/fmtTime';
import { cleanTitle } from '../../../utils/title';
import { PLAYER_TRACKS } from '../showcaseData';

// Spotlight: the player's signature pieces — the REAL MorphingAlbumArt hero and
// ProgressRibbon scrubber — driven by a SimulatedAudioPlayer so play / pause /
// seek and the ticking progress are genuinely live, with no real audio. (The
// full MobilePlayer is skipped here: its heart button hits the likes API and its
// menus open app-only sheets — neither belongs on the logged-out landing.)
export function PlayerSpotlight() {
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = new SimulatedAudioPlayer();
  const player = playerRef.current;
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const track = PLAYER_TRACKS[idx];

  useEffect(() => {
    // Subscribe first, then load — the sim's load() emits 'progress' 0, which
    // resets the bar through the subscriber (no direct setState in the effect).
    const offP = player.on('progress', (p) => setProgress(p));
    const offPlay = player.on('play', () => setPlaying(true));
    const offPause = player.on('pause', () => setPlaying(false));
    const offEnded = player.on('ended', () => { setPlaying(false); setProgress(0); });
    player.load(track);
    return () => { offP(); offPlay(); offPause(); offEnded(); };
  }, [player, track]);

  useEffect(() => () => player.destroy(), [player]);

  const toggle = () => { if (playing) player.pause(); else player.play(); };
  const go = (d) => { player.pause(); setIdx((i) => (i + d + PLAYER_TRACKS.length) % PLAYER_TRACKS.length); };

  const elapsed = fmtTime(progress * track.durationSec);
  const remaining = fmtTime(track.durationSec * (1 - progress));

  return (
    <div className="lp-player">
      <div className="lp-player__cover">
        <MorphingAlbumArt track={track} size={280} radius={12} />
      </div>
      <div className="lp-player__meta" key={track.id}>
        <div className="lp-player__title">{cleanTitle(track.title)}</div>
        <div className="lp-player__artist">{track.artist}</div>
      </div>
      <div className="lp-player__scrub">
        <ProgressRibbon progress={progress} accent="var(--color-accent)" dim="var(--color-line)"
          playing={playing} seed={track.id} onSeek={(p) => player.seek(p)} height={40} />
        <div className="lp-player__time">
          <span>{elapsed}</span>
          <span>-{remaining}</span>
        </div>
      </div>
      <div className="lp-player__transport">
        <button onClick={() => go(-1)} aria-label="previous" className="lp-player__nav">
          <svg width="22" height="16" viewBox="0 0 14 10" aria-hidden="true"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
        </button>
        <button onClick={toggle} aria-label={playing ? 'pause' : 'play'} className="lp-player__play">
          {playing
            ? <svg width="20" height="22" viewBox="0 0 12 14" aria-hidden="true"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
            : <svg width="20" height="22" viewBox="0 0 12 14" aria-hidden="true" style={{ transform: 'translateX(2px)' }}><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
        </button>
        <button onClick={() => go(1)} aria-label="next" className="lp-player__nav">
          <svg width="22" height="16" viewBox="0 0 14 10" aria-hidden="true"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
  );
}
