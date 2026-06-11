// Rasterize scripts/og-card.svg → public/og.png (1200×630) for the og:image
// social card. One-off: run `node scripts/gen-og.mjs` after editing the SVG.
// Uses @resvg/resvg-js (pure-wasm, no native build) with system fonts.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, 'og-card.svg'), 'utf8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  background: '#1a1814',
  font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();
const out = join(dir, '..', 'public', 'og.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
