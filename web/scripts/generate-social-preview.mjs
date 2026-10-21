// Renders the repository social preview: docs/design/social-preview.png (1200x630).
// The app icon (concept B), the name in Fraunces and the tagline on the linen background.
//
// Usage (from web/):  node scripts/generate-social-preview.mjs
// Needs web/node_modules (Fraunces font) and e2e/node_modules (Playwright with Chromium:
// `npm --prefix web install`, `npm --prefix e2e install`, `cd e2e && npx playwright install chromium`).
// GitHub: Settings > General > Social preview > upload the PNG (it cannot be set from a file).
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { chromium } = await import(
  pathToFileURL(join(root, 'e2e', 'node_modules', 'playwright', 'index.mjs')).href
);

const icon = (await readFile(join(root, 'docs', 'design', 'icons', 'icon-b.svg'), 'utf8')).replace(
  /<svg /,
  '<svg class="icon" ',
);
const font = await readFile(
  join(
    root,
    'web',
    'node_modules',
    '@fontsource-variable',
    'fraunces',
    'files',
    'fraunces-latin-wght-normal.woff2',
  ),
);

// Linen tokens (docs/design/TOKENS.md): background #f5efe4, text #2a251f, muted #6a6054, accent #a8482a.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces'; font-weight: 100 900;
  src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #f5efe4; color: #2a251f; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: 64px; font-family: 'Fraunces', Georgia, serif; }
body::before { content: ''; position: absolute; left: 60px; top: 40px; width: 620px; height: 620px;
  background: radial-gradient(closest-side, rgba(202,85,45,.13), transparent); }
.icon { width: 264px; height: 264px; flex: none; position: relative;
  filter: drop-shadow(0 18px 28px rgba(106,96,84,.28)); }
.text { position: relative; }
h1 { font-size: 112px; font-weight: 600; line-height: 1.05; letter-spacing: -0.015em; }
p { margin-top: 18px; font-size: 44px; font-weight: 400; line-height: 1.2; color: #6a6054; }
.rule { width: 96px; height: 6px; border-radius: 3px; background: #a8482a; margin-top: 28px; }
</style></head><body>
${icon}
<div class="text"><h1>Baby Routine</h1><div class="rule"></div><p>Track your baby's day, together</p></div>
</body></html>`;

const out = join(root, 'docs', 'design', 'social-preview.png');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
