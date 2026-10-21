// Regenerates the PNG icons in web/public from web/public/icon.svg.
//
// Usage (from the repo root or web/):  node web/scripts/generate-icons.mjs
// Requires the devDependency `sharp` (npm --prefix web install).
//
// Outputs:
//   icon-192.png            192x192, any purpose
//   icon-512.png            512x512, any purpose
//   icon-maskable-512.png   512x512, full-bleed background, glyph inside the 80% safe zone
//   apple-touch-icon.png    180x180 (iOS ignores transparency, background is solid)
//   favicon.png             32x32
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const source = await readFile(join(publicDir, 'icon.svg'), 'utf8');

// Maskable icons are cropped by the OS into circles/squircles, so the glyph is
// scaled to 80% around the centre (the W3C safe zone is the central 80%).
const maskableSvg = source
  .replace(
    '<rect id="bg" width="512" height="512" rx="112"',
    '<rect id="bg" width="512" height="512" rx="0"',
  )
  .replace(
    '<g id="glyph">',
    '<g id="glyph" transform="translate(256 256) scale(0.8) translate(-256 -256)">',
  );

const outputs = [
  { name: 'icon-192.png', svg: source, size: 192 },
  { name: 'icon-512.png', svg: source, size: 512 },
  { name: 'icon-maskable-512.png', svg: maskableSvg, size: 512 },
  { name: 'apple-touch-icon.png', svg: source, size: 180 },
  { name: 'favicon.png', svg: source, size: 32 },
];

for (const { name, svg, size } of outputs) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(publicDir, name));
  console.log(`wrote public/${name} (${size}x${size})`);
}
