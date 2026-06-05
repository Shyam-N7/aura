import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom doesn't ship ResizeObserver — TweaksPanel observes it.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// jsdom's matchMedia is also missing.
vi.stubGlobal('matchMedia', (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));
