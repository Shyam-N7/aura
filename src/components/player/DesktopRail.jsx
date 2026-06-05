import { useState } from 'react';
import { MonoLabel, HeartButton, ICON } from '../primitives';
import { AlbumArt } from '../album/AlbumArt';
import { MorphingAlbumArt } from '../album/MorphingAlbumArt';
import { ProgressRibbon } from './ProgressRibbon';
import { RailExtras } from './RailExtras';
import { RailPlaylistSheet } from './RailPlaylistSheet';
import { VolumeSlider } from './VolumeSlider';
import { RepeatIcon, ShuffleIcon } from './PlayerControlIcons';
import { openSleepTimer } from '../../lib/sleepTimerSheet';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import './DesktopRail.css';

// Persistent right rail at desktop+ — NowPlaying on top, RailExtras (related
// songs) below. The + button slides a rail-scoped sheet up from the bottom
// for add-to-playlist (same visual treatment as the mobile sheet but contained
// inside the rail's 420px width).
export function DesktopRail({
  track, nextTrack, progress, playing, player,
  onTogglePlay, onPrev, onNext, onSeek,
  onOpenLyrics, onOpenWhy, onOpenQueue, onPickLive,
  onPlayNext, onAddToQueue,
  repeatMode = 'off', onCycleRepeat, onShuffle, shuffleActive = false,
  collapsed = false, onToggle,
  slim = false,
}) {
  // `sheetTrack` is the track the rail-scoped sheet is currently picking a
  // playlist for. Set by NowPlaying's + button (the currently-playing track)
  // OR by RailExtras' more-like-this ⋯ → add to playlist (a related track).
  const [sheetTrack, setSheetTrack] = useState(null);
  return (
    <>
      {onToggle && (
        <button onClick={onToggle}
          aria-label={collapsed ? 'expand player rail' : 'collapse player rail'}
          className={`aura-desktop-rail__handle ${collapsed ? 'aura-desktop-rail__handle--collapsed' : ''}`}>
          <svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true">
            <path d={collapsed ? 'M7 1 L2 7 L7 13' : 'M2 1 L7 7 L2 13'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      <aside className={`aura-desktop-rail ${collapsed ? 'aura-desktop-rail--collapsed' : ''} ${!track ? 'aura-desktop-rail--empty' : ''}`}>
        {track && (
          <>
            <NowPlaying
              track={track} nextTrack={nextTrack} progress={progress} playing={playing} player={player}
              onTogglePlay={onTogglePlay} onPrev={onPrev} onNext={onNext} onSeek={onSeek}
              onOpenLyrics={onOpenLyrics} onOpenWhy={onOpenWhy} onOpenQueue={onOpenQueue}
              onOpenAddToPlaylist={() => setSheetTrack(track)}
              repeatMode={repeatMode} onCycleRepeat={onCycleRepeat}
              onShuffle={onShuffle} shuffleActive={shuffleActive}
              collapsed={collapsed} slim={slim}/>
            {!slim && (
              <RailExtras track={track} onPickLive={onPickLive}
                onPlayNext={onPlayNext} onAddToQueue={onAddToQueue}
                onOpenRailSheet={setSheetTrack}/>
            )}
            {sheetTrack && (
              <RailPlaylistSheet track={sheetTrack} onClose={() => setSheetTrack(null)}/>
            )}
          </>
        )}
      </aside>
    </>
  );
}

export function NowPlaying({ track, nextTrack, progress, playing, player, onTogglePlay, onPrev, onNext, onSeek, onOpenLyrics, onOpenWhy, onOpenQueue, onOpenAddToPlaylist, repeatMode, onCycleRepeat, onShuffle, shuffleActive, collapsed, slim }) {
  return (
    <div className="aura-desktop-rail__now">
      <div className="flex items-center justify-between mb-4">
        <MonoLabel className="text-ink-faint" size={9}>Now Playing</MonoLabel>
        <button onClick={onOpenQueue} className="aura-desktop-rail__queue-btn">
          Queue
          <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
            <path d="M1 2 H8 M1 4.5 H6 M1 7 H7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex justify-center">
        <div onClick={onOpenLyrics} className="cursor-pointer">
          <MorphingAlbumArt track={track} size={slim ? 200 : 240} radius={6}/>
        </div>
      </div>

      <div key={track.id} className="aura-track-text text-center mt-[18px]">
        <div className="font-serif text-[26px] leading-[1.05] tracking-[-0.015em] text-ink text-pretty">
          {cleanTitle(track.title)}
        </div>
        <div className="mt-1 font-sans text-[14px] text-ink-soft">
          {track.artist}
        </div>
      </div>

      <div className="mt-3.5">
        <ProgressRibbon progress={progress} accent="var(--color-accent)" dim="var(--color-line)"
          playing={playing && !collapsed} seed={track.id} onSeek={onSeek} height={26}/>
        <div className="flex justify-between mt-0.5">
          <MonoLabel className="text-ink-faint" size={9} numeric>{fmtTime(progress * track.durationSec)}</MonoLabel>
          <MonoLabel className="text-ink-faint" size={9} numeric>-{fmtTime(track.durationSec * (1 - progress))}</MonoLabel>
        </div>
      </div>

      {/* Mode row above the main transport — icon + mono label so users see
          immediately which button does what. Faint when off, accent when on. */}
      {(onShuffle || onCycleRepeat) && (
        <div className="flex items-center justify-center gap-7 mt-3">
          {onShuffle ? (
            <button onClick={onShuffle}
              aria-label={shuffleActive ? 'Shuffle on — tap to deactivate' : 'Shuffle up-next'}
              className={`aura-desktop-rail__mode-btn ${shuffleActive ? 'aura-desktop-rail__mode-btn--on' : ''}`}>
              <ShuffleIcon/>
              <MonoLabel className="text-current" size={9}>Shuffle</MonoLabel>
            </button>
          ) : <span/>}
          {onCycleRepeat ? (
            <button onClick={onCycleRepeat}
              aria-label={`Repeat: ${repeatMode}`}
              className={`aura-desktop-rail__mode-btn ${repeatMode !== 'off' ? 'aura-desktop-rail__mode-btn--on' : ''}`}>
              <RepeatIcon mode={repeatMode}/>
              <MonoLabel className="text-current" size={9}>
                Repeat{repeatMode === 'all' ? ' · All' : repeatMode === 'one' ? ' · 1' : ''}
              </MonoLabel>
            </button>
          ) : <span/>}
        </div>
      )}

      <div className="flex items-center justify-center gap-5 mt-2.5">
        <HeartButton trackId={track.id} size={20}/>
        <button onClick={onPrev} className="aura-desktop-rail__ctrl aura-desktop-rail__ctrl--sm">
          <svg width="14" height="10" viewBox="0 0 14 10"><path d="M14 0 L5 5 L14 10 Z M3 0 H1 V10 H3 Z" fill="currentColor"/></svg>
        </button>
        <button onClick={onTogglePlay} className="aura-desktop-rail__ctrl aura-desktop-rail__ctrl--play">
          {playing
            ? <svg width="12" height="14" viewBox="0 0 12 14"><rect x="0" width="4" height="14" fill="currentColor"/><rect x="8" width="4" height="14" fill="currentColor"/></svg>
            : <svg width="12" height="14" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>}
        </button>
        <button onClick={onNext} className="aura-desktop-rail__ctrl aura-desktop-rail__ctrl--sm">
          <svg width="14" height="10" viewBox="0 0 14 10"><path d="M0 0 L9 5 L0 10 Z M11 0 H13 V10 H11 Z" fill="currentColor"/></svg>
        </button>
        <button onClick={onOpenAddToPlaylist} aria-label="add to playlist" className="aura-desktop-rail__add">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6 H13 M3 10 H10 M3 14 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <circle cx="15" cy="14" r="3.6" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M15 12.4 V15.6 M13.4 14 H16.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {player && (
        // pr-9 (= 36 px = icon-button 28 + gap 8) shrinks the centering area
        // from the right so the slider *track* — not the (icon + gap + slider)
        // bundle — aligns with the play disc above. Without this the slider
        // sits 18 px right of centre and reads as misplaced.
        <div className="flex justify-center mt-2 pr-9">
          <VolumeSlider player={player}/>
        </div>
      )}

      {!slim && (
        <div className="aura-desktop-rail__mini-actions">
          <button onClick={onOpenWhy} className="aura-desktop-rail__mini-action">
            <span className="text-accent inline-flex">{ICON.why}</span>
            <span>Why This</span>
          </button>
          <button onClick={onOpenLyrics} className="aura-desktop-rail__mini-action">
            <span className="text-accent inline-flex">{ICON.lyrics}</span>
            <span>Lyrics</span>
          </button>
          <button onClick={openSleepTimer} className="aura-desktop-rail__mini-action">
            <span className="text-accent inline-flex">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7 4 V7 L9 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </span>
            <span>Sleep</span>
          </button>
        </div>
      )}

      {nextTrack && (
        <div onClick={onOpenQueue} className="aura-desktop-rail__upnext">
          <AlbumArt track={nextTrack} size={36} radius={3}/>
          <div className="flex-1 min-w-0">
            <MonoLabel className="text-ink-faint" size={9}>Up next</MonoLabel>
            <div className="font-serif text-[15px] leading-[1.1] mt-0.5 truncate text-ink">
              {cleanTitle(nextTrack.title)}
            </div>
          </div>
          <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
            <path d="M2 1 L6 4.5 L2 8" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-ink-soft"/>
          </svg>
        </div>
      )}
    </div>
  );
}

