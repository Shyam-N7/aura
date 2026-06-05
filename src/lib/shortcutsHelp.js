// Tiny bus for the keyboard-shortcuts help overlay. `?` opens it; the
// overlay component subscribes.

const subscribers = new Set();
let open = false;

function notify() {
  for (const cb of subscribers) cb(open);
}

export function openShortcutsHelp()  { if (!open) { open = true;  notify(); } }
export function closeShortcutsHelp() { if (open)  { open = false; notify(); } }
export function toggleShortcutsHelp() { open = !open; notify(); }

export function subscribeShortcutsHelp(cb) {
  subscribers.add(cb);
  cb(open);
  return () => { subscribers.delete(cb); };
}
