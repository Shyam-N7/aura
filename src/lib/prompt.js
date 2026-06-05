// Promise-returning prompt bus. One dialog at a time; new prompts replace any
// previous unresolved one (auto-resolving the old one with null).
//
//   import { prompt } from '../lib/prompt';
//   const name = await prompt({ title: 'name?', placeholder: 'untitled' });
//   if (name) save(name);
//
// Resolves with the *trimmed* input string on submit. Resolves with `null` on
// cancel / escape / backdrop / empty-after-trim.

const subscribers = new Set();
let counter = 0;
let pending = null;

export function prompt(opts) {
  if (pending) { pending.resolve(null); pending = null; }
  return new Promise((resolve) => {
    const event = {
      id:           ++counter,
      title:        opts.title       ?? 'enter a value',
      body:         opts.body        ?? null,
      placeholder:  opts.placeholder ?? '',
      defaultValue: opts.defaultValue ?? '',
      submitLabel:  opts.submitLabel ?? 'ok',
      cancelLabel:  opts.cancelLabel ?? 'cancel',
      resolve,
    };
    pending = event;
    for (const cb of subscribers) cb(event);
  });
}

export function subscribePrompt(cb) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function consumePromptPending(value) {
  if (!pending) return;
  // value is null for cancel, or the (already-trimmed) string for submit.
  pending.resolve(value);
  pending = null;
  for (const cb of subscribers) cb(null);
}
