import { useEffect, useState } from 'react';
import { MonoLabel } from '../components/primitives';
import { AlbumArt } from '../components/album/AlbumArt';
import { AuraLoader } from '../components/feedback/AuraLoader';
import { getPublicPlaylist } from '../api/playlists';
import { fmtTime, fmtRuntime } from '../utils/fmtTime';
import { cleanTitle } from '../utils/title';
import { setMeta } from '../lib/meta';
import { clearPostAuthPath } from '../lib/routes';
import './PublicPlaylistScreen.css';

// Public, view-only playlist page. Rendered by main.jsx's top-level view machine
// for /p/:publicId — BEFORE the auth gate — so a shared link opens for anyone in
// any browser, signed in or out. Read-only: no playback for visitors (the public
// API returns no stream URLs); the CTA invites them into AURA.
export function PublicPlaylistScreen({ publicId, isAuthed, onNavigate }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

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
  // get server-injected tags once that ships — see plan 2c).
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

  const signUp = () => { clearPostAuthPath(); onNavigate('/auth?mode=signup'); };

  return (
    <div className="absolute inset-0 bg-bg text-ink overflow-y-auto">
      <div className="max-w-[720px] mx-auto px-6 pt-8 pb-24">
        <button type="button" onClick={() => onNavigate('/')} className="aura-pub__brand" aria-label="AURA home">
          <MonoLabel className="text-ink-soft">AURA</MonoLabel>
        </button>

        {status === 'loading' && (
          <div className="mt-16"><AuraLoader label="Loading playlist"/></div>
        )}

        {status === 'error' && (
          <div className="mt-16 text-center">
            <h1 className="font-serif text-[28px] text-ink">This playlist isn’t available.</h1>
            <p className="mt-3 text-ink-soft text-[14px]">
              The link may be private now, or it doesn’t exist.
            </p>
            <button type="button" onClick={() => onNavigate('/')} className="aura-pub__cta mt-8">
              Go to AURA
            </button>
          </div>
        )}

        {status === 'ok' && (
          <>
            <div className="flex items-end gap-5 mt-8">
              <div className="shrink-0">
                <AlbumArt track={{ imageUrl: hit.data.coverImageUrl, title: hit.data.name }} size={140} radius={8}/>
              </div>
              <div className="min-w-0">
                <MonoLabel className="text-ink-faint" size={9}>shared playlist</MonoLabel>
                <h1 className="font-serif text-[40px] leading-[1.05] tracking-[-0.02em] text-ink mt-1.5 break-words">
                  {hit.data.name}
                </h1>
                <div className="text-ink-soft text-[13px] mt-2">
                  {hit.data.ownerName ? `by ${hit.data.ownerName}` : 'on AURA'}
                  {tracks.length > 0 && (
                    <> · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · {fmtRuntime(tracks.reduce((s, t) => s + (t.durationSec || 0), 0))}</>
                  )}
                </div>
              </div>
            </div>

            <div className="aura-pub__banner mt-7">
              <span className="text-ink-soft text-[13px]">
                {isAuthed ? 'Open this in AURA to play it.' : 'Sign up free to play these on AURA — radio that reads your mood.'}
              </span>
              {isAuthed
                ? <button type="button" onClick={() => onNavigate('/')} className="aura-pub__cta">Open AURA</button>
                : <button type="button" onClick={signUp} className="aura-pub__cta">Sign up free</button>}
            </div>

            <div className="mt-8">
              {tracks.length === 0 && (
                <p className="text-ink-soft text-[14px]">This playlist has no tracks yet.</p>
              )}
              {tracks.map((t, i) => (
                <div key={t.id} className="aura-pub__row">
                  <div className="aura-pub__idx">{String(i + 1).padStart(2, '0')}</div>
                  <AlbumArt track={t} size={46} radius={4}/>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-ink text-[14px]">{cleanTitle(t.title)}</div>
                    <MonoLabel className="text-ink-soft mt-1 block truncate" size={9.5}>
                      {(t.artist ?? '').toLowerCase()} · {t.language ?? ''}
                    </MonoLabel>
                  </div>
                  <MonoLabel className="text-ink-faint shrink-0 ml-3" size={10} numeric>{fmtTime(t.durationSec)}</MonoLabel>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
