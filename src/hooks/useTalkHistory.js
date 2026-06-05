import { useEffect, useState } from 'react';

// Singleton talk history. State lives in module scope so any consumer (the
// DesktopTalk route, potentially the mobile overlay later) sees the same
// conversation across mounts. Mirrored to localStorage so it survives reload.
const STORAGE_KEY = 'aura.talkHistory';
const MAX_MESSAGES = 50;

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function writeStored(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_MESSAGES))); } catch { /* ignore */ }
}

let messages = readStored() ?? [];
const subscribers = new Set();
function notify() { subscribers.forEach(fn => fn(messages)); }

function setMessages(next) {
  messages = next.slice(-MAX_MESSAGES);
  writeStored(messages);
  notify();
}

export function addTalkMessage(msg) {
  setMessages([...messages, msg]);
}
export function resetTalkHistory(seed) {
  setMessages(seed ? [seed] : []);
}

export function useTalkHistory(seed) {
  const [snap, setSnap] = useState(messages);
  useEffect(() => {
    subscribers.add(setSnap);
    return () => { subscribers.delete(setSnap); };
  }, []);
  // First-ever load: drop the seeded greeting in.
  useEffect(() => {
    if (messages.length === 0 && seed) setMessages([seed]);
    // We only ever want this to run once for the very first consumer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { messages: snap, addMessage: addTalkMessage, resetMessages: () => resetTalkHistory(seed) };
}
