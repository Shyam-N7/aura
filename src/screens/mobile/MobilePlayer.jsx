import { useState } from 'react';
import { MonoLabel, HeartButton } from '../../components/primitives';
import { MorphingAlbumArt } from '../../components/album/MorphingAlbumArt';
import { AlbumArt } from '../../components/album/AlbumArt';
import { ProgressRibbon } from '../../components/player/ProgressRibbon';
import { EqualizerControl } from '../../components/player/Equalizer';
import { RepeatIcon, ShuffleIcon } from '../../components/player/PlayerControlIcons';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { openSleepTimer } from '../../lib/sleepTimerSheet';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { useLikes } from '../../hooks/useLikes';
import { useHeroGestures } from './useHeroGestures';
import '../PlaylistsScreen.css';   // .aura-pl-menu / .aura-pl-menu-item — the ⋯ menu
import './MobilePlayer.css';

// Dedicated phone now-playing screen (rendered for `isMobile` only — DesktopPlayer
// serves tablet-portrait and up). A single full-viewport surface, no scrolling and
// no related-songs feed: an art-derived blurred backdrop, the cover as the hero, and
// the transport anchored in the thumb zone. Up-next / more-like-this live in the
// Queue screen now (the Up next strip opens it). The cover owns a unified gesture:
// swipe up = next, swipe down = close, double-tap = like; lyrics open from the ⋯ menu.
export function MobilePlayer({
  track, progress, playing, nextTrack, nextLoading, player, djName = 'AURA',
  onTogglePlay, onPrev, onNext, onSeek,
  repeatMode = 'off', onCycleRepeat, onShuffle, shuffleActive = false,
  onBack, openWhy, openLyrics, openQueue,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const elapsed = fmtTime(progress * track.durationSec);
  const remaining = fmtTime(track.durationSec * (1 - progress));

  // Double-tap the cover to like — always LIKES (Instagram-style, never unlikes) and
  // fires a centred heart burst (keyed so each tap restarts the animation).
  const { like } = useLikes();
  const [burst, setBurst] = useState(0);
  const heroGestures = useHeroGestures({
    onNext,
    onClose: onBack,
    onLike: () => { like(track.id).catch(() => {}); setBurst((b) => b + 1); },
  });

  return (
    <div className="aura-mp" onClick={closeMenu}>
      {/* Art-derived backdrop: the cover, scaled up and blurred, under a theme-aware
          scrim so the dusk/midnight/bloom palette still reads and text stays legible. */}
      <div className="aura-mp__backdrop" aria-hidden="true">
        <AlbumArt track={track} size={420} radius={0} style={{ '--album-shadow': 'none' }}/>
      </div>
      <div className="aura-mp__scrim" aria-hidden="true"/>

      <div className="aura-mp__content">
        <div className="aura-mp__top">
          <button onClick={onBack} aria-label="back" className="aura-mp__chip">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: 'translateX(-1px)' }}>
              <path d="M8 1 L3 5 L8 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="aura-mp__eyebrow">
            <span className="aura-mp__brand">{djName.toLowerCase()}</span>
          </div>

          <div className="aura-mp__menu-wrap" data-vaul-no-drag>
            <button type="button" aria-label="more" aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
              className="aura-mp__chip">
              <svg width="4" height="16" viewBox="0 0 4 16" aria-hidden="true">
                <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
              </svg>
            </button>
            {menuOpen && (
              <div className="aura-pl-menu aura-mp__menu" onClick={(e) => e.stopPropagation()}>
                {openWhy && <button onClick={() => { closeMenu(); openWhy(); }} className="aura-pl-menu-item">why this song</button>}
                <button onClick={() => { closeMenu(); openSleepTimer(); }} className="aura-pl-menu-item">sleep timer</button>
                {openLyrics && <button onClick={() => { closeMenu(); openLyrics(); }} className="aura-pl-menu-item">full-screen lyrics</button>}
              </div>
            )}
          </div>
        </div>

        <div className="aura-mp__hero" data-vaul-no-drag {...heroGestures}>
          <div className="aura-mp__cover">
            <div id="player-art" className="aura-mp__cover-art">
              <MorphingAlbumArt track={track} size={360} radius={10}/>
            </div>
            {/* Like pinned to the cover's top-right — OUTSIDE #player-art so the
                shared-element morph never carries it. Its own pointerdown is stopped
                so a tap on the heart doesn't reach the cover gesture handler. */}
            <span className="aura-mp__like-pin" onPointerDown={(e) => e.stopPropagation()}>
              <HeartButton trackId={track.id} size={22}/>
            </span>
            {burst > 0 && (
              <span key={burst} className="aura-mp__likeburst" aria-hidden="true">
                <svg width="92" height="92" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </span>
            )}
          </div>
        </div>

        {player && (
          <div className="aura-mp__eq" data-vaul-no-drag onClick={(e) => e.stopPropagation()}>
            <EqualizerControl player={player} compact/>
          </div>
        )}

        <div key={track.id} className="aura-mp__meta aura-track-text">
          <div className="aura-mp__title">{cleanTitle(track.title)}</div>
          <div className="aura-mp__artist">{track.artist}</div>
        </div>

        <div className="aura-mp__scrub" data-vaul-no-drag>
          <ProgressRibbon progress={progress} accent="var(--color-accent)" dim="var(--color-line)"
            playing={playing} seed={track.id} onSeek={onSeek} height={40}/>
          <div className="aura-mp__time">
            <MonoLabel className="text-ink-faint" size={11} numeric>{elapsed}</MonoLabel>
            <MonoLabel className="text-ink-faint" size={11} numeric>-{remaining}</MonoLabel>
          </div>
        </div>

        <div className="aura-mp__transport" data-vaul-no-drag>
          <button onClick={onPrev} aria-label="previous" className="aura-mp__nav">
            <svg width="26" height="19" viewBox="0 0 14 10" aria-hidden="true"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
          </button>
          <button onClick={onTogglePlay} aria-label={playing ? 'pause' : 'play'}
            className={`aura-mp__play ${playing ? 'aura-mp__play--playing' : ''}`}>
            {playing
              ? <svg width="24" height="26" viewBox="0 0 12 14" aria-hidden="true"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
              : <svg width="24" height="26" viewBox="0 0 12 14" aria-hidden="true" style={{ transform: 'translateX(2px)' }}><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
          </button>
          <button onClick={onNext} aria-label="next" className="aura-mp__nav">
            <svg width="26" height="19" viewBox="0 0 14 10" aria-hidden="true"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
          </button>
        </div>

        {(nextTrack || nextLoading) && (
          <button type="button" onClick={nextTrack ? openQueue : undefined} disabled={!nextTrack}
            data-vaul-no-drag
            className={`aura-mp__upnext ${nextTrack ? '' : 'aura-mp__upnext--loading'}`}
            aria-label={nextTrack ? `Up next: ${cleanTitle(nextTrack.title)}. Open queue.` : 'Finding the next song'}>
            {nextTrack
              ? <AlbumArt track={nextTrack} size={28} radius={5}/>
              : <span className="aura-mp__upnext-skel-art" aria-hidden="true"/>}
            <span className="aura-mp__upnext-meta">
              <MonoLabel className="text-ink-faint" size={7.5}>Up next</MonoLabel>
              <span className="aura-mp__upnext-title">{nextTrack ? cleanTitle(nextTrack.title) : 'finding next song…'}</span>
            </span>
            {nextTrack && (
              <svg className="aura-mp__upnext-chev" width="7" height="11" viewBox="0 0 7 11" aria-hidden="true">
                <path d="M1 1 L6 5.5 L1 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}

        <div className="aura-mp__actions" data-vaul-no-drag>
          {onShuffle && (
            <button onClick={onShuffle}
              aria-label={shuffleActive ? 'Shuffle on — tap to deactivate' : 'Shuffle up-next'}
              className={`aura-mp__act ${shuffleActive ? 'aura-mp__act--on' : ''}`}>
              <ShuffleIcon/>
            </button>
          )}
          <button onClick={() => openAddToPlaylist(track)} aria-label="add to playlist" className="aura-mp__act">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 6 H13 M3 10 H10 M3 14 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <circle cx="15" cy="14" r="3.6" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M15 12.4 V15.6 M13.4 14 H16.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
          {onCycleRepeat && (
            <button onClick={onCycleRepeat} aria-label={`Repeat: ${repeatMode}`}
              className={`aura-mp__act ${repeatMode !== 'off' ? 'aura-mp__act--on' : ''}`}>
              <RepeatIcon mode={repeatMode}/>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
