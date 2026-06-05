import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';

// Music-note-with-plus glyph. Calls the global sheet bus.
export function AddToPlaylistButton({ track, size = 22, className = '' }) {
  const onClick = (e) => {
    e.stopPropagation();
    if (track?.id) openAddToPlaylist(track);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="add to playlist"
      className={`bg-transparent border-0 p-0 cursor-pointer inline-flex items-center justify-center
                  text-ink-faint hover:text-ink-soft ${className}`}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {/* eighth note: head + stem + flag */}
        <circle cx="9" cy="16" r="2.5"/>
        <path d="M11.5 16V5l5.5 1.6"/>
        <path d="M11.5 8.6l5.5 1.6"/>
        {/* small plus, bottom-right */}
        <path d="M19 17v5M16.5 19.5h5"/>
      </svg>
    </button>
  );
}
