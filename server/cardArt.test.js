import { describe, it, expect } from 'vitest';
import { allowedArtUrl, ribbonPath, cardSvg, renderCardPng } from './cardArt.js';

describe('allowedArtUrl — the compositor is public, so only aura-hosted art', () => {
  it('allows the catalog CDN over https', () => {
    expect(allowedArtUrl('https://c.saavncdn.com/795/AM-500x500.jpg')).toBe(true);
  });
  it('rejects http, foreign hosts, junk and oversized urls', () => {
    expect(allowedArtUrl('http://c.saavncdn.com/x.jpg')).toBe(false);
    expect(allowedArtUrl('https://evil.example/x.jpg')).toBe(false);
    expect(allowedArtUrl('not a url')).toBe(false);
    expect(allowedArtUrl(null)).toBe(false);
    expect(allowedArtUrl(`https://c.saavncdn.com/${'a'.repeat(1000)}.jpg`)).toBe(false);
  });
});

describe('ribbonPath — every card gets its own deterministic wave', () => {
  it('is byte-identical for the same seed (edge-cacheable)', () => {
    expect(ribbonPath('track-123')).toBe(ribbonPath('track-123'));
  });
  it('differs across seeds (each card its own wave)', () => {
    expect(ribbonPath('track-123')).not.toBe(ribbonPath('track-456'));
  });
});

describe('cardSvg composition', () => {
  it('always carries the wordmark, the rings and the wave', () => {
    const svg = cardSvg({ seed: 'x' });
    expect(svg).toContain('>aura</text>');
    expect(svg).toContain('translate(872 84)');
    expect(svg).toContain('stroke-linecap="round"');
  });
  it('embeds the art full-bleed under the scrim when given', () => {
    const svg = cardSvg({
      art: { buffer: Buffer.from('fake-jpeg-bytes'), mime: 'image/jpeg' },
      seed: 'x',
    });
    expect(svg).toContain('data:image/jpeg;base64,');
    expect(svg).toContain('url(#scrim)');
  });
});

describe('renderCardPng', () => {
  it('renders a real PNG with the bundled font', () => {
    const png = renderCardPng({ seed: 'aura' });
    // PNG magic bytes — proves resvg + the bundled Hanken actually rendered.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.length).toBeGreaterThan(5000);
  });
});
