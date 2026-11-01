import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the Hub (`/dev/hub`): every role, the dock with and without the quick-add button, the
 * running-timer pill (closed and with its popover open), search, the shortcut customizer, and the
 * Updates, About and Settings pages. Phones of 320, 390 and 430 px, light, dark and night, English
 * and Portuguese, and large text (the page font scaled to 150 %). Credential-free (see
 * hub-preview.config.ts).
 *
 * Narrow it with HUB_WIDTHS=320,390 HUB_SCHEMES=dark HUB_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [320, 390, 430] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;

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
    } catch {
      /* ignore */
    }
  }, locale);
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('main, h1, h2, p, [role="search"]').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1200); // fonts, live queries and the seed settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `hub-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Hub by role, width, scheme and language', async ({ browser }) => {
  const widths = pick(process.env.HUB_WIDTHS, WIDTHS);
  const schemes = pick(process.env.HUB_SCHEMES, SCHEMES);
  const locales = pick(process.env.HUB_LOCALES, LOCALES);
  for (const locale of locales) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const scheme of schemes) {
        // The busy Owner on every combination; the other roles on the phone width only.
        const states = width === 390 ? ['owner', 'quiet', 'caregiver', 'viewer', 'doctor'] : ['owner'];
        for (const state of states) {
          await open(page, `/dev/hub?state=${state}&scheme=${scheme}`);
          await shoot(page, `${state}-${width}-${scheme}-${locale}`);
        }
      }
    }
  }
});

test('Hub with large text', async ({ browser }) => {
  const locales = pick(process.env.HUB_LOCALES, LOCALES);
  for (const locale of locales) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of pick(process.env.HUB_WIDTHS, [320, 390] as const)) {
      await page.setViewportSize({ width, height: 844 });
      await open(page, `/dev/hub?state=owner&scheme=light`);
      await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
      await page.waitForTimeout(400);
      await shoot(page, `large-text-${width}-${locale}`);
      await open(page, `/dev/hub?state=timers&scheme=light`);
      await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
      await page.waitForTimeout(400);
      await shoot(page, `large-text-timers-${width}-${locale}`, false);
    }
  }
});

test('Running-timer pill and its popover', async ({ browser }) => {
  const widths = pick(process.env.HUB_WIDTHS, WIDTHS);
  const schemes = pick(process.env.HUB_SCHEMES, ['light', 'dark'] as const);
  const locales = pick(process.env.HUB_LOCALES, LOCALES);
  for (const locale of locales) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const scheme of schemes) {
        await open(page, `/dev/hub?state=timers&scheme=${scheme}`);
        await shoot(page, `pill-${width}-${scheme}-${locale}`, false);
        await page.getByTestId('timer-pill').click();
        await page.waitForTimeout(500);
        await shoot(page, `pill-open-${width}-${scheme}-${locale}`, false);
      }
    }
  }
});

test('Search, shortcut customizer and the pages opened from the Hub', async ({ browser }) => {
  const schemes = pick(process.env.HUB_SCHEMES, ['light', 'dark'] as const);
  const locales = pick(process.env.HUB_LOCALES, LOCALES);
  for (const locale of locales) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const scheme of schemes) {
      const tag = `390-${scheme}-${locale}`;
      await open(page, `/dev/hub?state=owner&scheme=${scheme}`);
      await page.getByRole('searchbox').fill(locale === 'en' ? 'vacc' : 'vac');
      await page.waitForTimeout(300);
      await shoot(page, `search-${tag}`, false);
      await page.getByRole('searchbox').fill('zzzz');
      await page.waitForTimeout(300);
      await shoot(page, `search-none-${tag}`, false);

      await open(page, `/dev/hub?state=owner&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Customize|Personalizar)$/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `customize-${tag}`, false);

      for (const state of ['updates', 'about', 'settings']) {
        await open(page, `/dev/hub?state=${state}&scheme=${scheme}`);
        await shoot(page, `${state}-${tag}`);
      }
    }
  }
});
