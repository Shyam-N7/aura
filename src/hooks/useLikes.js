// Module-level liked-id store. One source of truth shared by every consumer.
// Components subscribe via useLikes(); calls to like/unlike are optimistic.

import { useEffect, useState } from 'react';
import { listLikedIds, likeTrack as apiLike, unlikeTrack as apiUnlike } from '../api/likes';

const likedIds = new Set();
const subscribers = new Set();
let booted = false;

function notify() {
  for (const cb of subscribers) cb();
}

async function boot() {
  if (booted) return;
  booted = true;
  try {
    const ids = await listLikedIds();
    likedIds.clear();
    for (const id of ids) likedIds.add(id);
    notify();
  } catch (err) {
    console.warn('[likes] boot failed', err.message);
    booted = false;  // allow retry on next mount
  }
}

export async function like(id) {
  if (!id || likedIds.has(id)) return;
  likedIds.add(id); notify();
  try { await apiLike(id); }
  catch (err) {
    likedIds.delete(id); notify();
    throw err;
  }
}

export async function unlike(id) {
  if (!id || !likedIds.has(id)) return;
  likedIds.delete(id); notify();
  try { await apiUnlike(id); }
  catch (err) {
    likedIds.add(id); notify();
    throw err;
  }
}

export function isLiked(id) { return id ? likedIds.has(id) : false; }

export function useLikes() {
  const [, setN] = useState(0);
  useEffect(() => {
    boot();
    const cb = () => setN(x => x + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);
  return { isLiked, like, unlike };
}
