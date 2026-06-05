// Tiny pub-sub for ephemeral toasts. One toast at a time; calling toast() again
// replaces whatever's currently showing.
//
//   import { toast } from '../lib/toast';
//   toast('liked.');

const subscribers = new Set();
let counter = 0;

export function toast(message) {
  if (!message) return;
  const event = { id: ++counter, message };
  for (const cb of subscribers) cb(event);
}

export function subscribe(cb) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
