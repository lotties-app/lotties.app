// Regenerates the launcher icons and splash screens of the Android and iOS projects from the concept B
// ("Day disc") art in docs/design/icons (edit those SVGs; there is no other source).
//
// Usage (from code/mobile/):  node scripts/generate-native-assets.mjs
// Uses `sharp`, a devDependency of code/web (resolved from there: code/mobile has no image dependency).
//
// Android (android/app/src/main/res):
//   mipmap-*/ic_launcher.png            legacy launcher icon (48 dp), the rounded light tile
//   mipmap-*/ic_launcher_round.png      legacy round icon, the same art cut to a circle
//   mipmap-*/ic_launcher_foreground.png adaptive icon layer (108 dp): the glyph only, transparent
//   mipmap-*/ic_launcher_monochrome.png adaptive themed icon (Android 13+), alpha only
//   drawable*/splash.png                pre-Android 12 launch image: warm paper colour + the glyph
//   (Android 12+ builds the splash from values/styles.xml: background colour + ic_launcher_foreground, with a
//   dark variant in values-night/; see docs/design/12-mobile-capacitor.md section 10)
// iOS (ios/App/App/Assets.xcassets):
//   AppIcon.appiconset/AppIcon-512@2x.png  1024 px, opaque, no corners (iOS applies its own mask)
//   Splash.imageset/splash-{light,dark}-2732.png  2732 px square, colour + the glyph, light and dark
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const artDir = join(mobile, '..', '..', 'docs', 'design', 'icons');
const sharp = createRequire(join(mobile, '..', 'web', 'package.json'))('sharp');
const art = (name) => readFile(join(artDir, name), 'utf8');

const LIGHT = '#f5efe4';
const DARK = '#1b1814';
const res = join(mobile, 'android', 'app', 'src', 'main', 'res');
const xcassets = join(mobile, 'ios', 'App', 'App', 'Assets.xcassets');

const maskable = await art('icon-b-maskable.svg');
const maskableDark = await art('icon-b-maskable-dark.svg');
const icon = await art('icon-b.svg');
const mono = await art('icon-b-mono.svg');

// The maskable art is a full-bleed tile plus the glyph scaled to 0.78. Dropping the tile path leaves the glyph.
const TILE = /<path d="M0 0H1024V1024H0Z" fill="url\(#(?:blm|bdm)-tile\)"\/>/;
const glyphOnly = (svg) => {
  if (!TILE.test(svg)) throw new Error('maskable art lost its tile path');
  return svg.replace(TILE, '');
};
const lightGlyph = glyphOnly(maskable);
const darkGlyph = glyphOnly(maskableDark);

const render = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png();
const write = async (file, image) => {
  await mkdir(dirname(file), { recursive: true });
  await image.toFile(file);
};
const circle = (size) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`,
  );

// --- Android launcher icons -------------------------------------------------------------------
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${density}`);
  const legacy = Math.round(48 * scale);
  const layer = Math.round(108 * scale);
  await write(join(dir, 'ic_launcher.png'), render(icon, legacy));
  await write(
    join(dir, 'ic_launcher_round.png'),
    render(maskable, legacy).composite([{ input: circle(legacy), blend: 'dest-in' }]),
  );
  await write(join(dir, 'ic_launcher_foreground.png'), render(lightGlyph, layer));
  // Same box as the foreground: the glyph sits inside the 66 dp safe circle at 0.6 of the layer.
  const monoSize = Math.round(layer * 0.6);
  await write(
    join(dir, 'ic_launcher_monochrome.png'),
    sharp(await render(mono, monoSize).toBuffer()).extend({
      top: Math.floor((layer - monoSize) / 2),
      bottom: Math.ceil((layer - monoSize) / 2),
      left: Math.floor((layer - monoSize) / 2),
      right: Math.ceil((layer - monoSize) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }),
  );
}

// --- Splash images ----------------------------------------------------------------------------
const hex = (color) => ({
  r: parseInt(color.slice(1, 3), 16),
  g: parseInt(color.slice(3, 5), 16),
  b: parseInt(color.slice(5, 7), 16),
  alpha: 1,
});
/** A `width` x `height` image of `color` with the glyph centred, `glyphFraction` of the short side. */
async function splash(svg, color, width, height, glyphFraction) {
  const glyph = Math.round(Math.min(width, height) * glyphFraction);
  return sharp({ create: { width, height, channels: 4, background: hex(color) } })
    .composite([{ input: await render(svg, glyph).toBuffer() }])
    .png();
}

// Pre-Android 12 launch images keep the sizes the template shipped.
const ANDROID_SPLASH = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [width, height]] of Object.entries(ANDROID_SPLASH)) {
  await write(join(res, dir, 'splash.png'), await splash(lightGlyph, LIGHT, width, height, 0.4));
}

// --- iOS ---------------------------------------------------------------------------------------
await write(
  join(xcassets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'),
  render(maskable, 1024).flatten({ background: LIGHT }),
);
const splashSet = join(xcassets, 'Splash.imageset');
for (const old of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await rm(join(splashSet, old), { force: true });
}
await write(join(splashSet, 'splash-light-2732.png'), await splash(lightGlyph, LIGHT, 2732, 2732, 0.3));
await write(join(splashSet, 'splash-dark-2732.png'), await splash(darkGlyph, DARK, 2732, 2732, 0.3));
const entry = (scale, filename, dark) => ({
  idiom: 'universal',
  filename,
  scale,
  ...(dark ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}),
});
const images = ['1x', '2x', '3x'].flatMap((scale) => [
  entry(scale, 'splash-light-2732.png', false),
  entry(scale, 'splash-dark-2732.png', true),
]);
await writeFile(
  join(splashSet, 'Contents.json'),
  `${JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2)}\n`,
);

console.log('Native icons and splash images regenerated from docs/design/icons.');
