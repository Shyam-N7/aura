// Tiny pub-sub for ephemeral toasts. One toast at a time; calling toast() again
// replaces whatever's currently showing.
//
//   import { toast } from '../lib/toast';
//   toast('liked.');

const subscribers = new Set();
let counter = 0;
// A toast fired with no host mounted yet (e.g. an SW-update notice raised on the
// pre-auth landing page, before <Toast/> in the app mounts) is held and replayed
// to the first subscriber — so the fire-and-forget bus never silently drops it.
let pending = null;

export function toast(message) {
  if (!message) return;
  const event = { id: ++counter, message };
  if (subscribers.size === 0) { pending = event; return; }
  for (const cb of subscribers) cb(event);
}

export function subscribe(cb) {
  subscribers.add(cb);
  if (pending) { cb(pending); pending = null; }
  return () => { subscribers.delete(cb); };
}
