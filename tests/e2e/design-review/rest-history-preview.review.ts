import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the rest history (`/dev/rest-history`): 14 and 28 nights, below the minimum, no night
 * with an estimate, turned off and the error, on a phone of 360 and 390 px and a computer of
 * 1280 px, light, dark and night, English and Portuguese. Credential-free (see
 * rest-history-preview.config.ts).
 *
 * Narrow it with REST_HISTORY_WIDTHS=390 REST_HISTORY_SCHEMES=dark REST_HISTORY_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [360, 390, 1280] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const STATES = ['ok', 'belowMinimum', 'notEnoughLog', 'disabled', 'error'] as const;

const pick = <T extends string | number>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(String(value))) : [...all];

async function contextFor(browser: Browser, locale: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    locale: locale === 'en' ? 'en-US' : 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('baby-routine.locale', value);
      window.localStorage.removeItem('baby-routine.restHistoryNights');
    } catch {
      /* ignore */
    }
  }, locale);
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1200); // fonts, the fake API and the theme settle
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `rest-history-${name}.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Rest history by state, width, scheme and language', async ({ browser }) => {
  for (const locale of pick(process.env.REST_HISTORY_LOCALES, LOCALES)) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of pick(process.env.REST_HISTORY_WIDTHS, WIDTHS)) {
      await page.setViewportSize({ width, height: width >= 1000 ? 900 : 844 });
      for (const scheme of pick(process.env.REST_HISTORY_SCHEMES, SCHEMES)) {
        const tag = `${width}-${scheme}-${locale}`;
        for (const state of STATES) {
          await open(page, `/dev/rest-history?state=${state}&scheme=${scheme}`);
          await shoot(page, `${state}-${tag}`);
        }
        await open(page, `/dev/rest-history?state=ok&scheme=${scheme}`);
        await page.getByRole('radio', { name: /^28 (nights|noites)$/ }).click();
        await page.waitForTimeout(600);
        await shoot(page, `ok28-${tag}`);
        await page.getByRole('radio', { name: /^14 (nights|noites)$/ }).click();
      }
    }
  }
});
