import { useEffect, useState } from 'react';
import { subscribe } from '../lib/toast';
import './Toast.css';

// Renders the most recent toast; auto-clears ~1.6s after its keyed animation
// finishes. New events replace the current toast (last-write-wins).
export function Toast() {
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    return subscribe((event) => {
      setCurrent(event);
    });
  }, []);

  useEffect(() => {
    if (!current) return;
    // 360ms in + 1240ms hold + 320ms out + small buffer
    const id = setTimeout(() => setCurrent(c => (c?.id === current.id ? null : c)), 2000);
    return () => clearTimeout(id);
  }, [current]);

  if (!current) return null;
  // key on id so re-firing the same message replays the animation
  return <div key={current.id} className="aura-toast">{current.message}</div>;
}
