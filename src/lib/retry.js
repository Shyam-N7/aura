// Retry an async fn with abort-aware exponential backoff. Does NOT retry an
// aborted call or a 4xx response — a 401/404 is a definitive answer, not a blip
// (auth failures are handled by the session re-check in lib/auth, so we never
// hammer them here). Errors should carry a numeric `.status` for the 4xx guard.
export async function withRetry(fn, { retries = 2, baseDelay = 400, signal } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      const status = err?.status;
      const is4xx = typeof status === 'number' && status >= 400 && status < 500;
      if (is4xx || attempt >= retries) throw err;
      attempt += 1;
      await new Promise((resolve, reject) => {
        const id = setTimeout(resolve, baseDelay * 2 ** (attempt - 1));
        signal?.addEventListener('abort', () => {
          clearTimeout(id);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  }
}
