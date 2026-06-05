// Promise-returning confirm bus. One dialog at a time; new confirms replace
// any previous unresolved dialog (auto-rejecting the old one).
//
//   import { confirm } from '../lib/confirm';
//   if (await confirm({ title: 'delete?', danger: true })) { ... }

const subscribers = new Set();
let counter = 0;
let pending = null;

export function confirm(opts) {
  // Resolve any in-flight dialog as cancelled so we don't leak promises.
  if (pending) { pending.resolve(false); pending = null; }
  return new Promise((resolve) => {
    const event = {
      id:           ++counter,
      title:        opts.title ?? 'are you sure?',
      body:         opts.body ?? null,
      confirmLabel: opts.confirmLabel ?? 'confirm',
      cancelLabel:  opts.cancelLabel ?? 'cancel',
      danger:       !!opts.danger,
      resolve,
    };
    pending = event;
    for (const cb of subscribers) cb(event);
  });
}

export function subscribeConfirm(cb) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function consumePending(answer) {
  if (!pending) return;
  pending.resolve(answer);
  pending = null;
  for (const cb of subscribers) cb(null);
}
