// Quick look at pages with the Vite dev server mocks (npm run dev). Not the real Keycloak flows (see dev/flows).
// Usage: node dev/preview-mocks.mjs login.ftl,register.ftl [outDir]
import { chromium } from '../../e2e/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const pages = (process.argv[2] ?? 'login.ftl').split(',');
const out = process.argv[3] ?? '../docs/design/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const scheme of ['dark', 'light'])
  for (const [w, h] of [[390, 844], [1280, 800]])
    for (const pageId of pages) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:5190/?pageId=${pageId}`);
      await page.waitForSelector('.br-card', { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/mock-${pageId.replace('.ftl', '')}-${scheme}-${w}.png`, fullPage: true });
      await ctx.close();
    }
await browser.close();
