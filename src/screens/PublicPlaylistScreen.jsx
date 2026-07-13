import { useEffect, useRef, useState } from 'react';
import { MonoLabel, BreathingDot } from '../components/primitives';
import { AlbumArt } from '../components/album/AlbumArt';
import { AuraLoader } from '../components/feedback/AuraLoader';
import { BackToTop } from '../components/BackToTop';
import { getPublicPlaylist, savePlaylist, unsavePlaylist } from '../api/playlists';
import { fmtTime, fmtRuntime } from '../utils/fmtTime';
import { relTime } from '../utils/relTime';
import { cleanTitle } from '../utils/title';
import { setMeta } from '../lib/meta';
import { toast } from '../lib/toast';
import { stashPostAuthPath } from '../lib/routes';
import './PublicPlaylistScreen.css';

// Public, view-only playlist page. Rendered by main.jsx's top-level view machine
// for /p/:publicId — BEFORE the auth gate — so a shared link opens for anyone in
// any browser, signed in or out. This is AURA's #1 organic-growth surface (a
// friend shares the link; a signed-out stranger opens it on a phone), so it's
// styled as an immersive landing-sibling, not the plain in-app list: a blurred
// album-art hero + a persistent glass CTA that converts. Read-only — the public
// API returns no stream URLs; a signed-in "Play in AURA" hands off to the app
// (which resolves URLs + plays), and a signed-out "Sign up free" returns here
// after signup (the stash), where the same play handoff is then available.
export function PublicPlaylistScreen({ publicId, isAuthed, onNavigate }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useRef(null);   // the page IS the scroll container (for BackToTop)

  useEffect(() => {
    const ctl = new AbortController();
    getPublicPlaylist(publicId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [publicId]);

  // Per-playlist tab title + client-side OG (the non-crawler fallback; crawlers
  // get the server-injected tags — see server/app.js injectPlaylistOg).
  useEffect(() => {
    if (status !== 'ok') return;
    const name = hit.data.name;
    const by = hit.data.ownerName ? ` · a playlist by ${hit.data.ownerName}` : '';
    setMeta({
      title: `${name} · AURA`,
      description: `${name}${by} on AURA.`,
      og: { title: `${name} · AURA`, description: `${name}${by} on AURA.`, url: window.location.href },
    });
  }, [status, hit.data]);

  const tracks = hit.data?.tracks ?? [];
  const updatedAt = hit.data?.updatedAt;
  const saveCount = (hit.data?.saveCount ?? 0) + (saved ? 1 : 0);
  const hasCover = !!hit.data?.coverImageUrl;

  // Signed-in visitors can keep a public playlist in their library without
  // editing it. (Owners can't save their own — the server no-ops that.)
  const toggleSave = async () => {
    if (saveBusy || !hit.data?.id) return;
    setSaveBusy(true);
    const next = !saved;
    setSaved(next);
    try {
      const res = next ? await savePlaylist(hit.data.id) : await unsavePlaylist(hit.data.id);
      if (next && res?.own) { setSaved(false); toast('This is already your playlist.'); }
      else toast(next ? 'Saved to your library.' : 'Removed from your library.');
    } catch (err) {
      setSaved(!next);
      toast(`Couldn’t update — ${err.message}`);
    } finally {
      setSaveBusy(false);
    }
  };
  // Give the cover a clean radial disc if it has no artwork (the inherited
  // --p0/--p1/--p2 palette on .aura-pub colours it), so a missing image never
  // renders the bare initials monogram.
  const cover = { imageUrl: hit.data?.coverImageUrl, title: hit.data?.name, cover: 'circle' };
  const ownerInitial = (hit.data?.ownerName?.trim()?.[0] || 'A').toUpperCase();
  const runtime = fmtRuntime(tracks.reduce((s, t) => s + (t.durationSec || 0), 0));

  // Signed-out → sign up, but stash THIS page so they land back here (now signed
  // in, with "Play in AURA" live) instead of being dropped at the app home.
  const signUp = () => {
    stashPostAuthPath('/p/' + encodeURIComponent(publicId));
    onNavigate('/auth?mode=signup');
  };
  // Signed-in → hand the app this playlist to OPEN as a read-only in-app view
  // (they browse + choose to play; editing needs the separate collaborate invite).
  // App.jsx's ?open= boot effect fetches it and opens the shared-playlist screen.
  const openInApp = () => onNavigate('/?open=' + encodeURIComponent(publicId));

  return (
    <div ref={scrollRef} className="aura-pub">
      <button type="button" onClick={() => onNavigate('/')} className="aura-pub__brand" aria-label="AURA home">
        <MonoLabel className="text-ink-soft">AURA</MonoLabel>
      </button>

      {status === 'loading' && (
        <div className="aura-pub__state">
          <div className="aura-pub__backdrop-fallback" aria-hidden="true"/>
          <div className="aura-pub__state-inner"><AuraLoader label="Loading playlist"/></div>
        </div>
      )}

      {status === 'error' && (
        <div className="aura-pub__state">
          <div className="aura-pub__backdrop-fallback" aria-hidden="true"/>
          <div className="aura-pub__state-inner">
            <h1 className="aura-pub__title">This playlist isn’t available.</h1>
            <p className="aura-pub__state-sub">The link may be private now, or it doesn’t exist.</p>
            <button type="button" onClick={() => onNavigate('/')} className="aura-pub__cta mt-6">Go to AURA</button>
          </div>
        </div>
      )}

      {status === 'ok' && (
        <>
          {/* ── HERO — full-bleed blurred cover + scrim, centred content ── */}
          <header className="aura-pub__hero">
            <div className="aura-pub__backdrop" aria-hidden="true">
              {hasCover
                ? <AlbumArt track={cover} size={420} radius={0} style={{ '--album-shadow': 'none' }}/>
                : <div className="aura-pub__backdrop-fallback"/>}
            </div>
            <div className="aura-pub__scrim" aria-hidden="true"/>

            <div className="aura-pub__hero-inner">
              <div className="aura-pub__cover aura-pub--fx" style={{ '--d': '0ms' }}>
                <AlbumArt track={cover} size={200} radius={14}/>
              </div>

              <MonoLabel className="aura-pub__eyebrow aura-pub--fx text-ink-faint" size={10} style={{ '--d': '70ms' }}>
                shared playlist
              </MonoLabel>

              <h1 className="aura-pub__title aura-pub--fx" style={{ '--d': '130ms' }}>
                {hit.data.name}
              </h1>

              <div className="aura-pub__owner aura-pub--fx" style={{ '--d': '190ms' }}>
                <span className="aura-pub__avatar" aria-hidden="true">{ownerInitial}</span>
                <span>{hit.data.ownerName ? <>shared by <strong>{hit.data.ownerName}</strong></> : 'on AURA'}</span>
              </div>

              {tracks.length > 0 && (
                <MonoLabel className="aura-pub__meta aura-pub--fx text-ink-soft" size={10} numeric style={{ '--d': '230ms' }}>
                  {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · {runtime}
                  {updatedAt ? ` · updated ${relTime(updatedAt)}` : ''}
                  {saveCount > 0 ? ` · saved by ${saveCount}` : ''}
                </MonoLabel>
              )}

              {isAuthed && (
                <button type="button" onClick={toggleSave} disabled={saveBusy}
                  className={`aura-pub__save aura-pub--fx${saved ? ' aura-pub__save--on' : ''}`} style={{ '--d': '260ms' }}>
                  {saved ? '✓ saved to your library' : '+ save to your library'}
                </button>
              )}

              <div className="aura-pub__pulse aura-pub--fx" style={{ '--d': '290ms' }}>
                <BreathingDot color="var(--color-accent)" size={6}/>
                <MonoLabel className="text-ink-faint" size={9}>on aura</MonoLabel>
              </div>
            </div>
          </header>

          {/* ── TRACKLIST ── */}
          <section className="aura-pub__list">
            {tracks.length === 0 && (
              <p className="aura-pub__empty">This playlist has no tracks yet.</p>
            )}
            {tracks.map((t, i) => (
              <div key={t.id} className="aura-pub__row aura-pub--rise" style={{ '--d': `${Math.min(i, 12) * 40}ms` }}>
                <div className="aura-pub__idx">{String(i + 1).padStart(2, '0')}</div>
                <AlbumArt track={t} size={52} radius={6}/>
                <div className="aura-pub__row-main">
                  <div className="aura-pub__row-title">{cleanTitle(t.title)}</div>
                  <MonoLabel className="aura-pub__row-meta text-ink-soft" size={9.5}>
                    {(t.artist ?? '').toLowerCase()}{t.language ? ` · ${t.language}` : ''}
                  </MonoLabel>
                </div>
                <MonoLabel className="aura-pub__row-dur text-ink-faint" size={10} numeric>{fmtTime(t.durationSec)}</MonoLabel>
              </div>
            ))}
          </section>

          {/* ── STICKY GLASS CTA — persists over the list while scrolling ── */}
          <div className="aura-pub__bar">
            <div className="aura-pub__bar-inner">
              <div className="aura-pub__bar-copy">
                <span className="aura-pub__bar-lead">{isAuthed ? 'Open this in AURA' : 'Sign up free to play'}</span>
                {!isAuthed && <span className="aura-pub__bar-sub">radio that reads your mood</span>}
              </div>
              {isAuthed
                ? <button type="button" onClick={openInApp} className="aura-pub__cta">Open in AURA</button>
                : <button type="button" onClick={signUp} className="aura-pub__cta">Sign up free</button>}
            </div>
          </div>
        </>
      )}

      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}
