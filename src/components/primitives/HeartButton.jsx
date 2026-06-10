import { useState } from 'react';
import { useLikes } from '../../hooks/useLikes';
import { toast } from '../../lib/toast';

const HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

export function HeartButton({ trackId, size = 22, className = '' }) {
  const { isLiked, like, unlike } = useLikes();
  const liked = isLiked(trackId);
  // Burst counter is bumped on every tap so React re-mounts the animated layer
  // (changing key restarts the keyframes from 0).
  const [burst, setBurst] = useState({ id: 0, willLike: false });

  const onClick = (e) => {
    e.stopPropagation();
    if (!trackId) return;
    const nextLiked = !liked;
    setBurst(b => ({ id: b.id + 1, willLike: nextLiked }));
    // Like/unlike are optimistic (the store flips instantly), so toast NOW rather
    // than after the network round-trip — otherwise the confirmation lags ~1s
    // behind the heart filling in. Only surface a toast change if it fails.
    if (liked) {
      toast('removed from likes.');
      unlike(trackId).catch(() => toast('couldn’t remove — try again.'));
    } else {
      toast('liked.');
      like(trackId).catch(() => toast('couldn’t like — try again.'));
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={liked ? 'unlike' : 'like'}
      style={{ width: size, height: size }}
      className={`bg-transparent border-0 p-0 cursor-pointer relative inline-flex items-center justify-center
                  ${liked ? 'text-accent' : 'text-ink-faint hover:text-ink-soft'} ${className}`}
    >
      <svg width={size} height={size} viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={HEART_PATH}/>
      </svg>

      {/* fade-up burst, restarts on every tap via key */}
      {burst.id > 0 && (
        <svg key={burst.id} width={size} height={size} viewBox="0 0 24 24"
          aria-hidden="true"
          className={`absolute inset-0 pointer-events-none animate-aura-heart-burst
                      ${burst.willLike ? 'text-accent' : 'text-ink-faint'}`}
          fill={burst.willLike ? 'currentColor' : 'none'}
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={HEART_PATH}/>
        </svg>
      )}
    </button>
  );
}
