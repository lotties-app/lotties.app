import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures "Why is she crying?" from the `/dev/now?state=cry` preview: the quiet entry under Quick
 * log, then the sheet (top: red flags and the first causes; bottom: "What worked?" and the
 * disclaimer) at 320 and 390 px, light and dark, English and Portuguese; plus the night view entry
 * and sheet, and the sheet at 160 % text on 320 px. Credential-free (see cry-preview.config.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = { light: 'Light', dark: 'Dark', night: 'Night' } as const;
type Scheme = keyof typeof SCHEMES;
const LOCALES = ['en', 'pt-BR'] as const;
const WIDTHS = [320, 390] as const;
const ENTRY = /^(Why is she crying\?|Por que ela está chorando\?)$/;

async function open(page: Page, scheme: Scheme) {
  await page.goto('/dev/now?state=cry');
  await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
  await page.getByRole('button', { name: ENTRY }).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700); // fonts and live queries settle
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Opens the sheet and captures its top and its bottom (the paper scrolls inside). */
async function shootSheet(page: Page, tag: string) {
  await page.getByRole('button', { name: ENTRY }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  await page.waitForTimeout(500);
  await shoot(page, `cry-sheet-top-${tag}`);
  await page.locator('.MuiDrawer-paper').evaluate((paper) => {
    paper.scrollTop = paper.scrollHeight;
  });
  await page.waitForTimeout(300);
  await shoot(page, `cry-sheet-bottom-${tag}`);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
}

test('"Why is she crying?" entry and sheet', async ({ browser }) => {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
        locale: locale === 'en' ? 'en-US' : 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      });
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem('baby-routine.locale', value);
        } catch {
          /* ignore */
        }
      }, locale);
      const page = await context.newPage();
      for (const scheme of ['light', 'dark'] as const) {
        const tag = `${width}-${scheme}-${locale}`;
        await open(page, scheme);
        await shoot(page, `cry-now-${tag}`);
        await shootSheet(page, tag);
      }
      if (width === 390) {
        await open(page, 'night');
        await shoot(page, `cry-now-390-night-${locale}`, true);
        await shootSheet(page, `390-night-${locale}`);
      }
      if (width === 320 && locale === 'en') {
        await open(page, 'light');
        await page.addStyleTag({
          content: 'html { font-size: 160% !important; }',
        });
        await page.waitForTimeout(300);
        await shootSheet(page, '320-light-en-text160');
      }
      await context.close();
    }
  }
});
