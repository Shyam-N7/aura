import { useEffect, useRef } from 'react';
import { AuraMark } from '../primitives';
import { ThemeToggle } from '../ThemeToggle';
import { AccountMenu } from './AccountMenu';
import { useSearchQuery, getSearchQuery } from '../../lib/searchQuery';
import { subscribeSearchFocus } from '../../lib/searchFocus';
import './MobileTopBar.css';

// Mobile-only top pill — mirrors MobileBottomBar's glass-pill recipe at the
// top of the viewport. Left = identity/status (AuraMark + djName + short stamp);
// right = an action trio (search · theme · account). `showAccount` is false
// during onboarding. Search only wires up when `onOpenSearch` is supplied.
//
// Morph-to-search: the pill never resizes. Two absolutely-stacked layers live
// inside it — `__bar-content` (brand + trio) and `__searchfield` (back · ⌕ ·
// input · clear) — and `.is-searching` cross-fades between them (transform +
// opacity only, so the blurred pill is never re-rasterised). The inactive layer
// is set `inert` so it leaves focus + pointer + AT entirely. `searching` is
// driven by `screen === 'search'`; the field input is the live search query
// (shared via the searchQuery store so DesktopSearch below shows results).
export function MobileTopBar({
  djName = 'aura', t, setTweak, showAccount = true,
  onOpenSearch, searching = false, onCloseSearch,
}) {
  const { query, setQuery } = useSearchQuery();
  const inputRef = useRef(null);
  const barRef = useRef(null);
  // True while a pointer is pressing a control inside the search surface (the
  // top bar or the search screen). Lets blur tell "tapped a search control"
  // (stay open) from "tapped an inert area / dismissed the keyboard" (collapse)
  // — robust across platforms where buttons don't take focus on tap.
  const surfaceTapRef = useRef(false);

  // The top bar owns the input + the focus bus on mobile. Focus SYNCHRONOUSLY
  // inside the opening tap (requestSearchFocus fires in the same gesture) so iOS
  // actually raises the keyboard — a deferred focus would be outside the gesture
  // and silently fail there. Also track surface taps for the blur logic. Only the
  // interactive instance wires up, so it never steals the buffered focus from an
  // inert onboarding bar.
  useEffect(() => {
    if (!onOpenSearch) return undefined;
    const offFocus = subscribeSearchFocus(() => inputRef.current?.focus());
    const onDown = (e) => {
      surfaceTapRef.current = !!e.target?.closest?.(
        '.aura-mobile-top button, .aura-mobile-top input, .aura-dse button, .aura-dse a, .aura-dse input',
      );
    };
    const onUp = () => { surfaceTapRef.current = false; };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      offFocus();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [onOpenSearch]);

  // `inert` removes the faded bar-content (brand + theme + account) from focus
  // order + pointer + AT during search, in one shot. Set imperatively since
  // React 18 doesn't reliably pass the `inert` JSX prop. The search field is
  // deliberately NOT inert: its input is focused synchronously in the opening
  // tap (while `searching` is still false), and an inert element can't be
  // focused — so the field uses tabIndex instead to stay out of the tab order
  // when collapsed while remaining programmatically focusable.
  useEffect(() => {
    if (barRef.current) barRef.current.inert = searching;
  }, [searching]);

  // Collapsing dismisses the keyboard.
  useEffect(() => {
    if (!searching) inputRef.current?.blur();
  }, [searching]);

  // Blur collapses ONLY when the field is empty AND the blur wasn't caused by
  // pressing a search control (a language filter, a recent/trending chip, a
  // result, back, or clear). Tapping an inert area or dismissing the keyboard
  // with an empty field collapses back to the normal bar; typed text survives.
  const onInputBlur = () => {
    if (surfaceTapRef.current) return;
    if (getSearchQuery().trim() === '') onCloseSearch?.();
  };

  // preventDefault on press keeps the input focused (no blur flicker) while the
  // click still fires.
  const clearQuery = (e) => { e.preventDefault(); setQuery(''); inputRef.current?.focus(); };

  const brandInner = (
    <>
      <AuraMark size={24}/>
      <span className="aura-mobile-top__brandtext">
        <span className="aura-mobile-top__wordmark">{djName}</span>
        <span className="aura-mobile-top__tagline">captures your mood</span>
      </span>
    </>
  );

  return (
    <div className={`aura-mobile-top ${searching ? 'is-searching' : ''}`}>
      {/* Layer 1 — the normal bar. Brand doubles as a large search tap target
          (flex-fills to the trio); the ⌕ button is the explicit affordance. */}
      <div ref={barRef} className="aura-mobile-top__bar-content">
        {onOpenSearch ? (
          <button type="button" onClick={onOpenSearch} aria-label="Search"
            className="aura-mobile-top__brand aura-mobile-top__brand--tap">
            {brandInner}
          </button>
        ) : (
          <div className="aura-mobile-top__brand">{brandInner}</div>
        )}
        <div className="aura-mobile-top__right">
          {onOpenSearch && (
            <button type="button" onClick={onOpenSearch} aria-label="Search"
              data-tour="mtop-search"
              className="aura-mobile-top__action">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10.6 10.6 L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <ThemeToggle t={t} setTweak={setTweak} className="aura-mobile-top__theme"/>
          {showAccount && <AccountMenu placement="down"/>}
        </div>
      </div>

      {/* Layer 2 — the search field. Always rendered (so it can morph + so the
          query store stays wired); inert until `.is-searching`. */}
      {onOpenSearch && (
        <div className="aura-mobile-top__searchfield" aria-hidden={!searching}>
          <button type="button" className="aura-mobile-top__sf-back" aria-label="Close search"
            tabIndex={searching ? 0 : -1} onClick={onCloseSearch}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M8 1 L3 5.5 L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="aura-mobile-top__sf-mag" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.6 10.6 L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </span>
          <input ref={inputRef} className="aura-mobile-top__sf-input"
            value={query} onChange={e => setQuery(e.target.value)} onBlur={onInputBlur}
            type="text" inputMode="search" enterKeyHint="search"
            placeholder="search a song, artist, or mood…"
            autoComplete="off" spellCheck={false} aria-label="Search"
            tabIndex={searching ? 0 : -1}/>
          {query && (
            <button type="button" className="aura-mobile-top__sf-clear" aria-label="Clear search"
              tabIndex={searching ? 0 : -1} onPointerDown={clearQuery}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
