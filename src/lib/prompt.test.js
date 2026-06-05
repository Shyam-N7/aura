import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prompt, subscribePrompt, consumePromptPending } from './prompt';

describe('prompt() bus', () => {
  let events;
  let unsubscribe;
  beforeEach(() => {
    events = [];
    unsubscribe = subscribePrompt((e) => events.push(e));
  });
  afterEach(() => {
    unsubscribe();
    // Clear any lingering pending state from a previous test.
    consumePromptPending(null);
  });

  it('resolves with the submitted string', async () => {
    const p = prompt({ title: 'name?', placeholder: 'untitled' });
    expect(events.at(-1)).toMatchObject({ title: 'name?', placeholder: 'untitled' });
    consumePromptPending('hello');
    await expect(p).resolves.toBe('hello');
  });

  it('resolves with null on cancel', async () => {
    const p = prompt({ title: 'name?' });
    consumePromptPending(null);
    await expect(p).resolves.toBeNull();
  });

  it('auto-resolves the previous prompt with null when a new one opens', async () => {
    const first  = prompt({ title: 'first' });
    const second = prompt({ title: 'second' });
    // first should auto-cancel; second is the active dialog
    await expect(first).resolves.toBeNull();
    consumePromptPending('done');
    await expect(second).resolves.toBe('done');
  });

  it('uses default labels when opts omit them', () => {
    prompt({ title: 'x' });
    expect(events.at(-1)).toMatchObject({ submitLabel: 'ok', cancelLabel: 'cancel' });
    consumePromptPending(null);
  });

  it('fires a null event after consumption to signal close', () => {
    prompt({ title: 'x' });
    const beforeCount = events.length;
    consumePromptPending(null);
    expect(events.length).toBe(beforeCount + 1);
    expect(events.at(-1)).toBeNull();
  });
});
