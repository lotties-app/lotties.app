// Regenerates the app icons in code/web/public from the concept B ("Day disc") art in
// docs/design/icons (edit those SVGs; there is no other generator).
//
// Usage (from code/web/):  node scripts/generate-icons.mjs
// Requires the devDependency `sharp` (npm install in code/web/).
//
// Copied as is:
//   icon.svg                  <- icon-b.svg          (light tile, any purpose)
//   favicon.svg               <- favicon-b.svg       (simplified, dark scheme via media query)
// Rendered:
//   icon-192.png, icon-512.png   any purpose, rounded tile, transparent corners
//   icon-maskable-512.png        icon-b-maskable.svg: full bleed, glyph inside the 66% safe zone
//   apple-touch-icon.png         180, opaque full bleed (iOS applies its own mask), larger glyph
//   icon-monochrome-512.png      icon-b-mono.svg inside the 66% safe zone (only alpha is used)
//   (also copies favicon.svg and favicon.png into code/keycloak-theme/src/login/art for its tab icon)
//   favicon.png (32), favicon.ico (16, 32, 48 as PNG-in-ICO), both from favicon.svg (light)
// Dark set (concept B dark tile; shown when the app scheme is dark or night, see manifest-dark):
//   icon-dark-192.png, icon-dark-512.png   icon-b-dark.svg
//   icon-maskable-dark-512.png             icon-b-maskable-dark.svg (glyph at 0.78)
//   apple-touch-icon-dark.png              180, opaque, glyph at 0.92
//   favicon-dark.png (32), favicon-dark.ico  favicon-b.svg with the dark palette forced
//   (icon-monochrome-512.png is shared: only its alpha is used)
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const artDir = join(here, '..', '..', '..', 'docs', 'design', 'icons');
const art = (name) => readFile(join(artDir, name), 'utf8');

const icon = await art('icon-b.svg');
const maskable = await art('icon-b-maskable.svg');
const mono = await art('icon-b-mono.svg');
const favicon = await art('favicon-b.svg');
const iconDark = await art('icon-b-dark.svg');
const maskableDark = await art('icon-b-maskable-dark.svg');

// favicon-b.svg switches palette with a media query that renderers do not evaluate: force it.
const LIGHT_FAVICON_STYLE = '.t{fill:#f5efe4}.d{fill:#b04c29}.n{fill:#2a251f}';
const DARK_FAVICON_STYLE = '.t{fill:#24201b}.d{fill:#e58f68}.n{fill:#f2eadc}';
if (!favicon.includes(LIGHT_FAVICON_STYLE)) throw new Error('favicon-b.svg lost its palette');
const faviconDark = favicon.replace(LIGHT_FAVICON_STYLE, DARK_FAVICON_STYLE);

// iOS rounds the corners itself and turns transparency black: use the full-bleed art with the
// glyph larger than the maskable safe zone allows.
const MASKABLE_SCALE = 'scale(0.78)';
if (!maskable.includes(MASKABLE_SCALE))
  throw new Error(`icon-b-maskable.svg lost ${MASKABLE_SCALE}`);
const appleSvg = maskable.replace(MASKABLE_SCALE, 'scale(0.92)');
if (!maskableDark.includes(MASKABLE_SCALE))
  throw new Error(`icon-b-maskable-dark.svg lost ${MASKABLE_SCALE}`);
const appleSvgDark = maskableDark.replace(MASKABLE_SCALE, 'scale(0.92)');

// Oversample the vector (density is relative to the SVG's own width/height, 96 dpi = 1x).
const svgWidth = (svg) => Number(/<svg[^>]* width="(\d+)"/.exec(svg)[1]);
const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: Math.max(72, (size / svgWidth(svg)) * 96 * 4) })
    .resize(size, size)
    .png();

async function write(name, pipeline, size) {
  await pipeline.toFile(join(publicDir, name));
  console.log(`wrote public/${name} (${size}x${size})`);
}

await copyFile(join(artDir, 'icon-b.svg'), join(publicDir, 'icon.svg'));
await copyFile(join(artDir, 'favicon-b.svg'), join(publicDir, 'favicon.svg'));
console.log('wrote public/icon.svg, public/favicon.svg');

await write('icon-192.png', render(icon, 192), 192);
await write('icon-512.png', render(icon, 512), 512);
await write('icon-maskable-512.png', render(maskable, 512), 512);
await write('apple-touch-icon.png', render(appleSvg, 180).flatten({ background: '#f5efe4' }), 180);
await write('favicon.png', render(favicon, 32), 32);

await write('icon-dark-192.png', render(iconDark, 192), 192);
await write('icon-dark-512.png', render(iconDark, 512), 512);
await write('icon-maskable-dark-512.png', render(maskableDark, 512), 512);
await write(
  'apple-touch-icon-dark.png',
  render(appleSvgDark, 180).flatten({ background: '#1b1814' }),
  180,
);
await write('favicon-dark.png', render(faviconDark, 32), 32);

// The Keycloak login theme bundles the same tab icon.
const kcArt = join(here, '..', '..', 'keycloak-theme', 'src', 'login', 'art');
await copyFile(join(artDir, 'favicon-b.svg'), join(kcArt, 'favicon.svg'));
await copyFile(join(publicDir, 'favicon.png'), join(kcArt, 'favicon.png'));
console.log('copied favicon.svg, favicon.png to code/keycloak-theme/src/login/art');

// Monochrome: 66% safe zone for the launcher's themed-icon mask, so the silhouette is scaled to 0.6.
const monoSize = Math.round(512 * 0.6);
const monoInner = await render(mono, monoSize).toBuffer();
const pad = (512 - monoSize) / 2;
await write(
  'icon-monochrome-512.png',
  sharp(monoInner).extend({
    top: Math.floor(pad),
    bottom: Math.ceil(pad),
    left: Math.floor(pad),
    right: Math.ceil(pad),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }),
  512,
);

// favicon.ico: PNG-in-ICO (supported since Vista); sharp cannot write ICO itself.
const icoSizes = [16, 32, 48];
async function writeIco(name, svg) {
  const icoPngs = await Promise.all(icoSizes.map((s) => render(svg, s).toBuffer()));
  const header = Buffer.alloc(6 + 16 * icoSizes.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  icoSizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s, e); // width
    header.writeUInt8(s, e + 1); // height
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(icoPngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += icoPngs[i].length;
  });
  await writeFile(join(publicDir, name), Buffer.concat([header, ...icoPngs]));
  console.log(`wrote public/${name} (${icoSizes.join(', ')})`);
}
await writeIco('favicon.ico', favicon);
await writeIco('favicon-dark.ico', faviconDark);
