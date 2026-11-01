import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the Insights section (`/dev/insights`): every scenario (rich 14-day baby, partial 5-day
 * baby, short 2-day baby, empty baby) in light, dark and night, English and Portuguese, on a phone
 * (390x844), plus the table view and the 7 and 30-day ranges. Credential-free (see
 * insights-preview.config.ts).
 *
 * Narrow it with INSIGHTS_SCHEMES=dark INSIGHTS_LOCALES=en INSIGHTS_STATES=rich.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const STATES = ['rich', 'partial', 'short', 'empty'] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function contextFor(browser: import('@playwright/test').Browser, locale: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1200); // fonts, live queries and the seed settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Insights in every scenario, scheme and language', async ({ browser }) => {
  const schemes = pick(process.env.INSIGHTS_SCHEMES, SCHEMES);
  const locales = pick(process.env.INSIGHTS_LOCALES, LOCALES);
  const states = pick(process.env.INSIGHTS_STATES, STATES);
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of schemes) {
      for (const state of states) {
        await open(page, `/dev/insights?state=${state}&scheme=${scheme}`);
        await shoot(page, `insights-${state}-${scheme}-${locale}`);
      }
    }
    await context.close();
  }
});

test('Insights table view and ranges', async ({ browser }) => {
  const locales = pick(process.env.INSIGHTS_LOCALES, LOCALES);
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.INSIGHTS_SCHEMES, ['light', 'dark'] as const)) {
      const tag = `${scheme}-${locale}`;
      await open(page, `/dev/insights?state=rich&scheme=${scheme}`);
      await page.getByRole('radio', { name: /^(7 days|7 dias)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `insights-range7-${tag}`);
      await page.getByRole('radio', { name: /^(30 days|30 dias)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `insights-range30-${tag}`);
      await page.getByRole('button', { name: /^(View as table|Ver como tabela)$/ }).nth(2).click();
      await page.waitForTimeout(400);
      await shoot(page, `insights-table-${tag}`);
    }
    await context.close();
  }
});

test('Insights cards one by one (no floating navigation over them)', async ({ browser }) => {
  for (const locale of pick(process.env.INSIGHTS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.INSIGHTS_SCHEMES, SCHEMES)) {
      await open(page, `/dev/insights?state=rich&scheme=${scheme}`);
      await page.addStyleTag({ content: 'nav { display: none !important; }' });
      for (const id of ['sleep', 'sleepRhythm', 'feeding', 'diapers']) {
        await page
          .locator(`section[data-insight="${id}"]`)
          .screenshot({ path: path.join(SHOTS, `insights-card-${id}-${scheme}-${locale}.png`) });
      }
    }
    await context.close();
  }
});
