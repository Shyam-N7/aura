import { useEffect, useRef, useState } from 'react';
import { previewLink, startImport, cancelImport } from '../api/ytImport';
import { useImportJob, progressOf } from '../hooks/useImportJob';
import { COPY, copyForCode, isRetryable } from '../lib/ytImportCopy';
import { YouTubeReviewScreen } from './YouTubeReviewScreen';
import { confirm } from '../lib/confirm';
import './YouTubeImportScreen.css';

// Paste a YouTube link, get an AURA playlist.
//
// Four states in ONE screen rather than four screens, because they are one
// continuous action and the user should never feel handed off:
//
//   paste ──preview──▶ confirm ──start──▶ progress ──▶ done ──▶ (review)
//
// Every string comes from ../lib/ytImportCopy. There are deliberately no
// literals below: that file is tested against the server's own source, so a new
// error code cannot reach a user as "something went wrong".

const PLACEHOLDER_ROWS = 6;

export function YouTubeImportScreen({ onClose, onOpenPlaylist }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const { job, setJob, error: pollError, stop, live } = useImportJob(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Clearing the previous verdict belongs to the EDIT, not to the effect that
  // fetches the next one. Doing it in the effect body is a cascading render
  // (react-hooks/set-state-in-effect) and it is also the wrong cause: what
  // invalidates the old answer is the user changing the link.
  const changeUrl = (next) => {
    setUrl(next);
    setPreview(null);
    setLinkError(null);
  };

  // Check the link as it is pasted. Debounced because a paste fires input
  // events per chunk in some browsers, and because a user typing a URL by hand
  // would otherwise be checked on every keystroke — this endpoint is free
  // server-side but the flicker is not free to read.
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) return undefined;

    const ctl = new AbortController();
    const t = setTimeout(() => {
      setChecking(true);
      previewLink(trimmed, { signal: ctl.signal })
        .then(setPreview)
        .catch(err => { if (err.name !== 'AbortError') setLinkError(err); })
        .finally(() => setChecking(false));
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [url]);

  const begin = async () => {
    setStarting(true);
    try {
      setJob(await startImport(url.trim()));
    } catch (err) {
      setLinkError(err);
    } finally {
      setStarting(false);
    }
  };

  const abandon = async () => {
    const ok = await confirm({
      title: COPY.cancel.confirm,
      body: COPY.cancel.body,
      confirmLabel: COPY.cancel.stop,
      danger: true,
    });
    if (!ok) return;
    stop();
    try { await cancelImport(job.id); } catch { /* already finished — nothing to undo */ }
    onClose?.();
  };

  const open = () => {
    if (job?.playlistId) onOpenPlaylist?.(job.playlistId);
    else onClose?.();
  };

  if (reviewing && job) {
    return (
      <YouTubeReviewScreen
        job={job}
        onDone={(updated) => { if (updated) setJob(updated); setReviewing(false); }}
        onOpenPlaylist={onOpenPlaylist}
      />
    );
  }

  const phase = !job ? (preview ? 'confirm' : 'paste')
    : live ? 'progress'
    : job.status === 'failed' ? 'failed'
    : 'done';

  return (
    <div className="absolute inset-0 bg-bg text-ink pt-5 overflow-auto pb-24 animate-aura-sheet-in">
      <div className="pt-1 px-7 flex justify-between items-center">
        <span className="aura-pl-eyebrow">{COPY.entry.label}</span>
        <button onClick={live ? abandon : onClose} className="aura-pl-back">
          {live ? COPY.cancel.action : COPY.confirm.cancel}
        </button>
      </div>

      <div className="pt-[18px] px-7">
        <div className="font-serif text-[38px] leading-none tracking-[-0.02em]">
          From<br/><em className="italic">YouTube.</em>
        </div>
      </div>

      <div className="pt-7 px-[22px] flex flex-col gap-3">
        {phase === 'paste' && (
          <PasteState
            url={url} setUrl={changeUrl} inputRef={inputRef}
            checking={checking} linkError={linkError}
          />
        )}

        {phase === 'confirm' && (
          <ConfirmState
            preview={preview} starting={starting} linkError={linkError}
            onBack={() => changeUrl('')}
            onStart={begin}
          />
        )}

        {phase === 'progress' && <ProgressState job={job} pollError={pollError}/>}

        {phase === 'failed' && (
          <FailedState
            job={job}
            onRetry={() => { setJob(null); changeUrl(''); }}
            onClose={onClose}
          />
        )}

        {phase === 'done' && (
          <DoneState
            job={job}
            onReview={() => setReviewing(true)}
            onOpen={open}
            onLater={onClose}
          />
        )}
      </div>
    </div>
  );
}

function PasteState({ url, setUrl, inputRef, checking, linkError }) {
  const err = linkError && copyForCode(linkError.code, linkError.message);
  return (
    <>
      <div className="aura-yt-paste">
        <input
          ref={inputRef}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={COPY.paste.placeholder}
          className="aura-yt-input"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <p className="aura-yt-hint">{COPY.entry.hint}</p>
      {checking && <p className="aura-yt-status">{COPY.paste.checking}</p>}
      {err && (
        <div className="aura-yt-note aura-yt-note--warn">
          <div className="aura-yt-note__title">{err.title}</div>
          {err.body && <div className="aura-yt-note__body">{err.body}</div>}
        </div>
      )}
      {/* Empty rows standing in for the songs about to arrive. Not decoration:
          it makes the shape of the result legible before anything is fetched,
          so the progress state that follows isn't a surprise layout. */}
      <div className="aura-yt-ghosts" aria-hidden="true">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
          <div key={i} className="aura-yt-ghost" style={{ opacity: 1 - i * 0.14 }}/>
        ))}
      </div>
    </>
  );
}

function ConfirmState({ preview, starting, linkError, onBack, onStart }) {
  const err = linkError && copyForCode(linkError.code, linkError.message);
  return (
    <>
      <div className="aura-yt-note">
        <div className="aura-yt-note__body">
          {/* The honest framing has to land HERE. A mix regenerates every time
              YouTube builds it, so what we take is a snapshot — said before the
              user commits, it is information; said afterwards, it is an excuse. */}
          {preview.windowed
            ? COPY.confirm.mix(preview.windowSize)
            : COPY.confirm.playlist(null)}
        </div>
      </div>
      {err && (
        <div className="aura-yt-note aura-yt-note--warn">
          <div className="aura-yt-note__title">{err.title}</div>
          {err.body && <div className="aura-yt-note__body">{err.body}</div>}
        </div>
      )}
      <div className="aura-yt-actions">
        <button onClick={onBack} className="aura-yt-btn aura-yt-btn--quiet" disabled={starting}>
          {COPY.confirm.cancel}
        </button>
        <button onClick={onStart} className="aura-yt-btn aura-yt-btn--go" disabled={starting}>
          {starting ? COPY.paste.checking : COPY.confirm.action}
        </button>
      </div>
    </>
  );
}

// How many songs the live list shows at once, and how many sit BEHIND the one
// being matched. Deliberately small: this is a window that follows the work,
// not the whole tracklist. Rendering all N rows looks right for ten seconds and
// then the frontier scrolls under the fold and the screen goes static again —
// which is the problem this exists to fix.
const WINDOW_ROWS = 8;
const WINDOW_BEHIND = 3;

// The song the server is on right now.
//
// Not an estimate. matchPhase claims items with ORDER BY position ASC LIMIT 1,
// so the queue drains strictly in order: everything above the first tier-less
// item is finished, everything below is waiting. That is a fact about the
// server's cursor, and the only reason it is honest to put a title on screen
// and say we are working on it.
function frontierIndex(items) {
  const i = items.findIndex(it => !it.tier);
  return i === -1 ? items.length : i;
}

const ROW_STATUS = {
  auto: COPY.progress.row.matched,
  review: COPY.progress.row.review,
  unmatched: COPY.progress.row.missing,
};

function ImportRow({ item, isFrontier, waiting }) {
  const status = isFrontier ? COPY.progress.row.working : ROW_STATUS[item.tier];
  const cls = [
    'aura-yt-row',
    waiting && 'aura-yt-row--waiting',
    isFrontier && 'aura-yt-row--now',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {/* YouTube's own name for it, warts and all. Swapping in the catalog's
          cleaner title once a row resolves would make rows appear to rewrite
          themselves mid-import, which reads as a glitch. */}
      <span className="aura-yt-row__title">{item.youtube?.title ?? ''}</span>
      {status && <span className="aura-yt-row__status">{status}</span>}
    </div>
  );
}

function ProgressState({ job, pollError }) {
  const { done, total, pct } = progressOf(job);
  const items = job.items ?? [];

  // Three stages, each read off real state. Nothing advances on a timer, so a
  // drain that stalls freezes the words and the bar together — which is the
  // truth, and the whole reason this is not a decorative loader.
  const label = job.status === 'queued'
    ? COPY.progress.starting
    : job.status === 'fetching' || total === 0
    ? COPY.progress.fetching
    : (job.counts?.matching ?? 0) <= 3 || pct >= 90
    ? COPY.progress.almostThere(done, total)
    : COPY.progress.matching(done, total);

  const at = frontierIndex(items);
  const start = Math.max(0, Math.min(at - WINDOW_BEHIND, items.length - WINDOW_ROWS));
  const shown = items.slice(start, start + WINDOW_ROWS);

  return (
    <>
      <div className="aura-yt-progress">
        <div className="aura-yt-progress__bar">
          <div className="aura-yt-progress__fill" style={{ width: `${pct}%` }}/>
        </div>
        <div className="aura-yt-progress__label">{label}</div>
      </div>

      {/* Empty until the fetch phase commits — it writes every item row in one
          transaction — so this simply isn't there for the first stage. */}
      {shown.length > 0 && (
        <div className="aura-yt-rows">
          {shown.map((item, i) => (
            <ImportRow
              key={item.id ?? start + i}
              item={item}
              isFrontier={start + i === at}
              waiting={start + i > at}
            />
          ))}
        </div>
      )}
      {/* True, and worth saying: the drain resumes on the next poll and the
          daily cron finishes whatever a closed tab left behind. Without this
          line people sit and watch. */}
      <p className="aura-yt-hint">{COPY.progress.safeToLeave}</p>
      {pollError && <p className="aura-yt-status">{COPY.progress.building}</p>}
    </>
  );
}

function FailedState({ job, onRetry, onClose }) {
  const err = copyForCode(job.error, null);
  return (
    <>
      <div className="aura-yt-note aura-yt-note--warn">
        <div className="aura-yt-note__title">{err.title}</div>
        {err.body && <div className="aura-yt-note__body">{err.body}</div>}
      </div>
      <div className="aura-yt-actions">
        <button onClick={onClose} className="aura-yt-btn aura-yt-btn--quiet">
          {COPY.done.later}
        </button>
        {/* Only where retrying can actually change the answer. A retry button on
            an exhausted daily quota is a lie the user pays for by pressing it. */}
        {isRetryable(job.error) && (
          <button onClick={onRetry} className="aura-yt-btn aura-yt-btn--go">
            {COPY.confirm.action}
          </button>
        )}
      </div>
    </>
  );
}

function DoneState({ job, onReview, onOpen, onLater }) {
  const { auto = 0, review = 0, unmatched = 0 } = job.counts ?? {};
  const nothing = auto === 0 && review === 0;
  return (
    <>
      <div className="aura-yt-summary">
        {nothing ? (
          <div className="aura-yt-summary__line">{COPY.done.nothingMatched}</div>
        ) : (
          <>
            <div className="aura-yt-summary__headline">{COPY.done.ready(auto)}</div>
            {review > 0 && <div className="aura-yt-summary__line">{COPY.done.review(review)}</div>}
            {unmatched > 0 && <div className="aura-yt-summary__line aura-yt-summary__line--soft">{COPY.done.missing(unmatched)}</div>}
            {review === 0 && unmatched === 0 && (
              <div className="aura-yt-summary__line">{COPY.done.allAuto}</div>
            )}
          </>
        )}
      </div>

      {review > 0 && <p className="aura-yt-hint">{COPY.done.reassurance}</p>}

      <div className="aura-yt-actions">
        {nothing ? (
          <button onClick={onLater} className="aura-yt-btn aura-yt-btn--go">{COPY.done.later}</button>
        ) : (
          <>
            <button onClick={onOpen} className="aura-yt-btn aura-yt-btn--quiet">{COPY.done.open}</button>
            {review > 0 && (
              <button onClick={onReview} className="aura-yt-btn aura-yt-btn--go">{COPY.done.reviewAction}</button>
            )}
          </>
        )}
      </div>
    </>
  );
}
