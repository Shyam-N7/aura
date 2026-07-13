// Module-level liked-id store. One source of truth shared by every consumer.
// Components subscribe via useLikes(); calls to like/unlike are optimistic.

import { useEffect, useState } from 'react';
import { listLikedIds, likeTrack as apiLike, unlikeTrack as apiUnlike } from '../api/likes';

const likedIds = new Set();
const subscribers = new Set();
let booted = false;
let ready = false;   // the id set has loaded at least once (see useLikes consumers)

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
    ready = true;
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
  // `ready` flips true after the first successful load — consumers that filter a
  // server list through isLiked() must wait for it, or they'd render empty while
  // the set is still booting (the liked screen looked empty for exactly this).
  return { isLiked, like, unlike, ready };
}
