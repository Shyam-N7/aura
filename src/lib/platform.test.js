import { describe, it, expect, afterEach, vi } from 'vitest';
import { isIOS } from './platform';

const stubNav = (nav) => vi.stubGlobal('navigator', nav);

afterEach(() => vi.unstubAllGlobals());

describe('isIOS', () => {
  it('detects iPhone / iPod / iPad by user agent', () => {
    stubNav({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
    stubNav({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) Safari', platform: 'iPad', maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
    stubNav({ userAgent: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', platform: 'iPod', maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
  });

  it('detects iPadOS 13+ masquerading as desktop Safari (MacIntel + touch)', () => {
    stubNav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
  });

  it('is false on a real Mac (no touch)', () => {
    stubNav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isIOS()).toBe(false);
  });

  it('is false on Windows and Android', () => {
    stubNav({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 });
    expect(isIOS()).toBe(false);
    stubNav({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome', platform: 'Linux armv8l', maxTouchPoints: 5 });
    expect(isIOS()).toBe(false);
  });
});
