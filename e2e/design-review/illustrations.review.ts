import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the illustration gallery (`/dev/illustrations`): the whole page on the category tint
 * and on the surface, with and without glow, at 1x (real pixels at 24 px), plus each scheme panel
 * at 2x for a closer look. Credential-free (see illustrations.config.ts).
 *
 * Narrow it with ILLUSTRATIONS_BG=tint ILLUSTRATIONS_GLOW=0.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const BACKGROUNDS = ['tint', 'surface'] as const;
const GLOWS = ['0', '1'] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function open(page: Page, bg: string, glow: string): Promise<void> {
  await page.goto(`/dev/illustrations?bg=${bg}&glow=${glow}`);
  await page.getByRole('heading', { name: 'Illustrations' }).waitFor();
  await page.waitForTimeout(400);
}

for (const scale of [1, 2] as const) {
  test(`illustration gallery at ${scale}x`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1720, height: 1000 },
      deviceScaleFactor: scale,
      locale: 'en-US',
    });
    const page = await context.newPage();
    for (const bg of pick(process.env.ILLUSTRATIONS_BG, BACKGROUNDS)) {
      for (const glow of pick(process.env.ILLUSTRATIONS_GLOW, GLOWS)) {
        await open(page, bg, glow);
        const tag = `${bg}${glow === '1' ? '-glow' : ''}`;
        if (scale === 1) {
          await page.screenshot({
            path: path.join(SHOTS, `illustrations-${tag}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        } else {
          for (const scheme of SCHEMES) {
            await page
              .locator(`[data-scheme-panel="${scheme}"]`)
              .screenshot({ path: path.join(SHOTS, `illustrations-${scheme}-${tag}@2x.png`) });
          }
        }
      }
    }
    await context.close();
  });
}
