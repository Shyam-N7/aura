import { useEffect, useState } from 'react';
import { MOOD_BRIDGES } from '../../data';
import { MonoLabel, ICON } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { getMostPlayed, getTopArtists, getRecentlyPlayed } from '../../api/stats';
import { listPlaylists } from '../../api/playlists';
import { listAutoPlaylists } from '../../api/autoPlaylists';
import { getDiscoverHome } from '../../api/discover';
import { cleanTitle } from '../../utils/title';
import { homeCache as _cache } from '../../lib/homeCache';
import { ctxPress } from '../../lib/trackContextMenu';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import { NowPlayingBanner } from '../../components/player/NowPlayingBanner';
import { TopStrip } from './TopStrip';
import { QuickPicksOrbit } from './QuickPicksOrbit';
import { QuickPicksSpinner } from './QuickPicksSpinner';
import { SectionHeader } from './SectionHeader';
import { HeroBand } from './HeroBand';
import { BridgeCard } from './BridgeCard';
import './DesktopHome.css';

// The section-fetch cache is lib/homeCache (`_cache` here) — it survives
// unmount/remount so sections don't re-fetch + cascade-reveal on every return,
// and other screens invalidate keys they make stale (e.g. hiding a mix track).

export function DesktopHome({
  tracks, djName, currentTrackId, track, onOpenPlayer, loading = false,
  activeMode = 'everyday', modes = [], onSetMode,
  onPick, onPickLive, onPlaySequence, onOpenJournal, onOpenDna, onOpenBridges, onOpenBridge,
  onOpenCatalogPlaylist, onOpenPlaylistDetail, onOpenAuto, onOpenPlaylists, onOpenSearch,
  onOpenArtist,
  t, setTweak,
}) {
  const heroTrack = tracks[0];
  const newPicks  = tracks.slice(1, 5);
  const stations  = tracks.slice(5, 9);
  const activeLabel = modes.find(m => m.key === activeMode)?.label ?? 'Everyday';

  const [mostPlayed,     setMostPlayed]     = useState(() => _cache.mostPlayed     ?? []);
  const [topArtists,     setTopArtists]     = useState(() => _cache.topArtists     ?? []);
  const [recentlyPlayed, setRecentlyPlayed] = useState(() => _cache.recentlyPlayed ?? []);
  const [yourPlaylists,  setYourPlaylists]  = useState(() => _cache.yourPlaylists  ?? []);
  const [autoPlaylists,  setAutoPlaylists]  = useState(() => _cache.autoPlaylists  ?? []);
  // Quick picks come from what you actually listen to — most-played first, then
  // recently-played, then the featured pool only for brand-new accounts.
  const quickPicks = (
    mostPlayed.length >= 4 ? mostPlayed
      : recentlyPlayed.length >= 4 ? recentlyPlayed
        : tracks
  ).slice(0, 8);
  const [discover,       setDiscover]       = useState(() => _cache.discover ?? { trending: [], popularPlaylists: [], movieSongs: [] });
  useEffect(() => {
    const ctl = new AbortController();
    // Each fetch writes into the cache on success so remounts read it
    // synchronously above and skip the loading flash + cascade reveal.
    if (!_cache.mostPlayed)     getMostPlayed     ({ signal: ctl.signal }).then(d => { _cache.mostPlayed     = d; setMostPlayed(d);     }).catch(() => {});
    if (!_cache.topArtists)     getTopArtists     ({ signal: ctl.signal }).then(d => { _cache.topArtists     = d; setTopArtists(d);     }).catch(() => {});
    if (!_cache.recentlyPlayed) getRecentlyPlayed ({ signal: ctl.signal }).then(d => { _cache.recentlyPlayed = d; setRecentlyPlayed(d); }).catch(() => {});
    if (!_cache.yourPlaylists)  listPlaylists     ({ signal: ctl.signal }).then(d => { _cache.yourPlaylists  = d; setYourPlaylists(d);  }).catch(() => {});
    // Mixes are the one section that goes stale mid-session (hide a track,
    // cross an edition boundary) — stale-while-revalidate: the cache renders
    // instantly above, a fresh fetch runs on EVERY mount and updates in place.
    listAutoPlaylists({ signal: ctl.signal }).then(d => { _cache.autoPlaylists = d; setAutoPlaylists(d); }).catch(() => {});
    if (!_cache.discover)       getDiscoverHome   ({ signal: ctl.signal }).then(d => { _cache.discover       = d; setDiscover(d);       }).catch(() => {});
    return () => ctl.abort();
  }, []);

  const scrollRef = useScrollMemory('home');   // cache renders synchronously on remount

  // Daypart mixes surface on Home only inside their own window (the playlists
  // screen always shows the full suite); everything else always shows.
  const hour = new Date().getHours();
  const visibleAuto = autoPlaylists.filter(a =>
    a.mixKey === 'morning' ? (hour >= 5 && hour < 12)
      : a.mixKey === 'night' ? (hour >= 20 || hour < 4)
        : true);

  return (
    <div ref={scrollRef} className="aura-dh">
      <TopStrip djName={djName} onOpenSearch={onOpenSearch} t={t} setTweak={setTweak}
        activeMode={activeMode} modes={modes} onSetMode={onSetMode} loading={loading}/>

      {/* {Mode} mix — while the new pool curates (the pool lags the label by one
          fetch), a "curating your {mode} mix…" banner; then the one-tap play-all
          card. Everyday has no mix, so Quick Picks stays the top there. */}
      {activeMode !== 'everyday' && loading && (
        <section className="aura-dh__modemix">
          <div className="aura-dh__modemix-curating" role="status">
            <span className="aura-dh__modemix-curating-dot" aria-hidden="true"/>
            curating your {activeLabel.toLowerCase()} mix…
          </div>
        </section>
      )}
      {activeMode !== 'everyday' && !loading && tracks.length > 0 && (
        <section className="aura-dh__modemix">
          <button type="button" className="aura-dh__modemix-card"
            onClick={() => onPlaySequence?.(tracks, 0, `${activeLabel} mix`)}>
            <span className="aura-dh__modemix-art" aria-hidden="true">
              {tracks.slice(0, 4).map(tr => (
                <AlbumArt key={tr.id} track={tr} radius={0}
                  style={{ width: '100%', height: '100%', aspectRatio: 1 }}/>
              ))}
            </span>
            <span className="aura-dh__modemix-meta">
              <span className="aura-dh__modemix-kicker">your mix</span>
              <span className="aura-dh__modemix-title">{activeLabel} mix</span>
              <span className="aura-dh__modemix-sub">{tracks.length} songs · tap to play all</span>
            </span>
            <span className="aura-dh__modemix-play" aria-hidden="true">
              <svg width="15" height="17" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
            </span>
          </button>
        </section>
      )}

      {/* Now playing — a distinctive hero card that cross-fades the cover and
          flourishes the title on each change; tap to open the full player. Hidden
          until something is playing (the banner self-gates, the section too). */}
      {track && (
        <section className="aura-dh__np">
          <NowPlayingBanner track={track} variant="quick" label="now playing" onOpen={onOpenPlayer}/>
        </section>
      )}

      {/* Quick picks — an orbital ring drawn from your LISTENING (most-played,
          then recently-played, then featured for brand-new users), above the
          hero so it's the first thing to act on. */}
      {quickPicks.length > 0 && (
        <section className="aura-dh__qp">
          <SectionHeader title="Quick picks" sub="jump back into what you love" large/>
          {/* Desktop = auto-orbit; phone = spinnable fidget wheel. Both render;
              the `dh` container query shows one and hides the other (display:none
              halts the hidden one's animations). */}
          <div className="aura-dh__qp-orbit">
            <QuickPicksOrbit
              tracks={quickPicks}
              onPlay={(t) => onPickLive?.(t)}
              onShuffle={() => {
                const s = [...quickPicks];
                for (let i = s.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [s[i], s[j]] = [s[j], s[i]];
                }
                onPlaySequence?.(s, 0, 'quick picks');
              }}/>
          </div>
          <div className="aura-dh__qp-spinner">
            <QuickPicksSpinner
              tracks={quickPicks}
              currentTrackId={currentTrackId}
              onPlay={(t, el) => onPickLive?.(t, el)}/>
          </div>
        </section>
      )}

      {/* Hero banner — a simple tagline, not the brand (that lives in the top bar). */}
      <section className="aura-dh__greeting">
        <h1 className="aura-dh__mood-hero">music that gets your mood</h1>
      </section>

      {loading ? (
        <section className="aura-dh__hero-band-wrap" aria-hidden="true">
          <div className="aura-dh__skel aura-dh__skel-hero"/>
        </section>
      ) : heroTrack && (
        <section className="aura-dh__hero-band-wrap">
          <HeroBand track={heroTrack} djName={djName} onPick={() => onPick?.(heroTrack.id)}/>
        </section>
      )}

      {recentlyPlayed.length > 0 && (
        <>
          <SectionHeader title="Recently played" sub={`${recentlyPlayed.length} tracks to pick up from`} large/>
          <div className="aura-dh__memory-wrap">
            <div className="aura-dh__memory-grid">
              {recentlyPlayed.slice(0, 3).map(t => (
                <MemoryTile key={t.id} track={t} onPick={() => onPickLive?.(t)}/>
              ))}
            </div>
          </div>
        </>
      )}

      {topArtists.length > 0 && (
        <>
          <SectionHeader title="Your top artists" sub="Artists you play most" large/>
          <div className="aura-dh__artists-wrap">
            <div className="aura-dh__artists">
              {topArtists.slice(0, 8).map(a => (
                <DesktopArtistTile key={a.artist} artist={a}
                  onClick={() => onOpenArtist?.({ name: a.artist, trackId: a.sampleTrack?.id })}/>
              ))}
            </div>
          </div>
        </>
      )}

      <SectionHeader title="Mood bridges" sub="Move from one feeling to another" onMore={onOpenBridges} large/>
      <div className="aura-dh__bridges-grid">
        {MOOD_BRIDGES.slice(0, 2).map((b, i) => (
          <BridgeCard key={b.id} bridge={b} idx={i} onClick={() => onOpenBridge?.(b)}/>
        ))}
      </div>

      {(loading || stations.length > 0) && (
        <>
          <SectionHeader title="Stations" sub="One-tap playlists" large/>
          <div className="aura-dh__stations">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                <div key={`skel-${i}`} className="aura-dh__skel aura-dh__skel-station" aria-hidden="true"/>
              ))
              : stations.map(s => (
              <button key={s.id} onClick={() => onPick?.(s.id)} className="aura-dh__station">
                {s.imageUrl
                  ? <img src={s.imageUrl} alt="" loading="lazy" className="aura-dh__station-bg"/>
                  : <div className="aura-dh__station-bg aura-dh__station-bg--fallback"/>}
                <div className="aura-dh__station-tint"/>
                <div className="aura-dh__station-content">
                  <MonoLabel className="text-white/75" size={9}>Station</MonoLabel>
                  <div className="aura-dh__station-name">{cleanTitle(s.title)}</div>
                  {s.artist && <div className="aura-dh__station-artist">{s.artist}</div>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {yourPlaylists.length > 0 && (
        <>
          <SectionHeader title="Your playlists" sub="Made by you" onMore={onOpenPlaylists} large/>
          <div className="aura-dh__playlists-grid">
            {yourPlaylists.slice(0, 4).map(p => (
              <button key={p.id} onClick={() => onOpenPlaylistDetail?.(p.id)} className="aura-dh__playlist">
                {p.coverImageUrl
                  ? <img src={p.coverImageUrl} alt="" loading="lazy" className="aura-dh__playlist-cover"/>
                  : <span className="aura-dh__playlist-cover aura-dh__playlist-cover--fallback">
                      {(p.name?.[0] ?? '·').toLowerCase()}
                    </span>}
                <div>
                  <div className="aura-dh__playlist-name">{p.name}</div>
                  <MonoLabel className="text-ink-soft mt-1 block" size={9}>
                    {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
                  </MonoLabel>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {visibleAuto.length > 0 && (
        <>
          <SectionHeader title="Made for you" sub="Fresh editions from your plays — skips count" onMore={onOpenPlaylists} large/>
          <div className="aura-dh__playlists-grid">
            {visibleAuto.map(a => a.kind === 'auto-gate' ? (
              // Honest gate card — the mix doesn't exist yet, so nothing to open.
              <div key={a.id} className="aura-dh__playlist aura-dh__playlist--gate">
                <span className="aura-dh__playlist-cover aura-dh__playlist-cover--fallback">♫</span>
                <div>
                  <div className="aura-dh__playlist-name">{a.name}</div>
                  <MonoLabel className="text-ink-soft mt-1 block truncate" size={8}>
                    {a.gate?.line}
                  </MonoLabel>
                </div>
              </div>
            ) : (
              <button key={a.id} onClick={() => onOpenAuto?.(a)} className="aura-dh__playlist">
                <span className="aura-dh__playlist-coverwrap">
                  {a.coverImageUrl
                    ? <img src={a.coverImageUrl} alt="" loading="lazy" className="aura-dh__playlist-cover"/>
                    : <span className="aura-dh__playlist-cover aura-dh__playlist-cover--fallback">♫</span>}
                  {/* One-tap play without opening the detail — parity with the
                      playlists screen's rows. */}
                  <span
                    role="button" tabIndex={0} aria-label={`play ${a.name}`}
                    onClick={(e) => { e.stopPropagation(); onPlaySequence?.(a.tracks, 0, a.name); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlaySequence?.(a.tracks, 0, a.name); } }}
                    className="aura-dh__playlist-play">
                    <svg width="12" height="12" viewBox="0 0 13 13"><path d="M3 2 L11 6.5 L3 11 Z" fill="currentColor"/></svg>
                  </span>
                </span>
                <div>
                  <div className="aura-dh__playlist-name">{a.name}</div>
                  <MonoLabel className="text-ink-soft mt-1 block truncate" size={8}>
                    {(a.editionLabel ?? a.description) + (a.refreshing ? ' · refreshing…' : '')}
                  </MonoLabel>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {(loading || newPicks.length > 0) && (
        <>
          <SectionHeader title="New for you" sub="Fresh this week" large/>
          <div className="aura-dh__new-picks">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                <div key={`skel-${i}`} className="aura-dh__pick aura-dh__pick--skel" aria-hidden="true">
                  <span className="aura-dh__skel aura-dh__skel-pick-art"/>
                  <span className="aura-dh__skel aura-dh__skel-pick-line"/>
                </div>
              ))
              : newPicks.map(t => (
              <button key={t.id} onClick={() => onPick?.(t.id)} {...ctxPress(t)} className="aura-dh__pick">
                <span className="aura-dh__pick-art">
                  <AlbumArt track={t} radius={6}
                    style={{ width: '100%', height: 'auto', aspectRatio: 1 }}/>
                  <span className="aura-dh__pick-play">
                    <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
                  </span>
                </span>
                <div>
                  <div className="aura-dh__pick-title">{cleanTitle(t.title)}</div>
                  <MonoLabel className="text-ink-soft mt-1 block truncate" size={8}>
                    {(t.artist ?? '').toLowerCase()}
                  </MonoLabel>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {(mostPlayed.length > 0 || topArtists.length > 0) && (
        <>
          <SectionHeader title="About you" sub="A summary of your listening" large/>
          <div className="aura-dh__about-grid">
            <button onClick={onOpenJournal} className="aura-dh__about-card">
              <div className="flex items-center gap-2.5">
                <span className="text-accent">{ICON.journal}</span>
                <MonoLabel className="text-ink-faint" size={9}>Listening journal</MonoLabel>
              </div>
              <div className="aura-dh__about-headline">Today&apos;s story</div>
              <div className="aura-dh__about-body">
                A short daily summary of what you&apos;ve been listening to.
              </div>
              <div className="mt-auto flex items-center justify-between">
                <MonoLabel className="text-ink-faint" size={9}>Updated daily</MonoLabel>
                <MonoLabel className="text-accent" size={9}>Read &rarr;</MonoLabel>
              </div>
            </button>
            <button onClick={onOpenDna} className="aura-dh__about-card">
              <div className="flex items-center gap-2.5">
                <span className="text-accent">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 2 Q8 8 3 14 M13 2 Q8 8 13 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </span>
                <MonoLabel className="text-ink-faint" size={9}>Your music DNA</MonoLabel>
              </div>
              <div className="aura-dh__about-headline" style={{ fontSize: 22 }}>
                {topArtists.length ? `${topArtists.length} artists · ${mostPlayed.length} tracks` : 'Building your profile…'}
              </div>
              <div className="mt-auto flex items-center justify-between">
                <MonoLabel className="text-ink-faint" size={9}>Updated daily</MonoLabel>
                <MonoLabel className="text-accent" size={9}>View &rarr;</MonoLabel>
              </div>
            </button>
          </div>
        </>
      )}

      {discover.popularPlaylists.length > 0 && (
        <>
          <SectionHeader title="Popular playlists" sub="Trending now" large/>
          <div className="aura-dh__playlists-grid">
            {discover.popularPlaylists.slice(0, 4).map(p => (
              <button key={p.id} onClick={() => onOpenCatalogPlaylist?.(p.id)} className="aura-dh__playlist">
                {p.coverImageUrl
                  ? <img src={p.coverImageUrl} alt="" loading="lazy" className="aura-dh__playlist-cover"/>
                  : <span className="aura-dh__playlist-cover aura-dh__playlist-cover--fallback">
                      {(p.name?.[0] ?? '·').toLowerCase()}
                    </span>}
                <div>
                  <div className="aura-dh__playlist-name">{p.name}</div>
                  {p.subtitle && (
                    <MonoLabel className="text-ink-soft mt-1 block truncate" size={8}>
                      {p.subtitle.toLowerCase()}
                    </MonoLabel>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}

function DesktopArtistTile({ artist, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = artist.sampleTrack?.imageUrl && !imgFailed;
  const initials = (artist.artist ?? '·')
    .split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toLowerCase() || '·';
  return (
    <button onClick={onClick} className="aura-dh__artist">
      {showImage
        ? <img src={artist.sampleTrack.imageUrl} alt="" loading="lazy"
            onError={() => setImgFailed(true)} className="aura-dh__artist-img"/>
        : <span className="aura-dh__artist-img aura-dh__artist-img--fallback">{initials}</span>}
      <div className="aura-dh__artist-name">{(artist.artist ?? '').toLowerCase()}</div>
      <MonoLabel className="text-ink-faint" size={8.5}>
        {artist.playCount} {artist.playCount === 1 ? 'play' : 'plays'}
      </MonoLabel>
    </button>
  );
}

function MemoryTile({ track, onPick }) {
  return (
    <button onClick={onPick} className="aura-dh__memory">
      <div className="aura-dh__memory-art">
        <AlbumArt track={track} size={80} radius={6}/>
        <span className="aura-dh__memory-play">
          <svg width="10" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
        </span>
      </div>
      <div className="aura-dh__memory-body-col">
        <div className="aura-dh__memory-title">{cleanTitle(track.title)}</div>
        <MonoLabel className="text-ink-faint mt-1 block truncate" size={9}>
          {track.artist ?? ''}{track.language ? ` · ${track.language}` : ''}
        </MonoLabel>
        {track.album && (
          <MonoLabel className="text-ink-faint mt-auto block truncate" size={8.5}>
            From {track.album}
          </MonoLabel>
        )}
      </div>
    </button>
  );
}
