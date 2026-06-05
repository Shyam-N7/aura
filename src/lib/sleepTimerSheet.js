// Bus for opening / closing the sleep-timer picker sheet. Matches the
// addToPlaylistSheet pattern.
const subscribers = new Set();
let open = false;

function notify() { for (const cb of subscribers) cb(open); }

export function openSleepTimer()  { if (!open) { open = true;  notify(); } }
export function closeSleepTimer() { if (open)  { open = false; notify(); } }
export function subscribeSleepSheet(cb) {
  subscribers.add(cb);
  cb(open);
  return () => { subscribers.delete(cb); };
}
