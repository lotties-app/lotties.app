import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the Now screen in every scenario of the `/dev/now` preview: light, dark and night
 * schemes, English and Portuguese, a phone (390x844) and a desktop window (1280x800), plus the
 * trays, the Why sheet and the toast. Credential-free (see now-preview.config.ts).
 *
 * Narrow it with NOW_STATES=awake,nap NOW_VIEWPORTS=mobile NOW_SCHEMES=dark NOW_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const STATES = ['empty', 'learning', 'awake', 'nap', 'night', 'waking', 'nursing', 'forgotten', 'catchup', 'viewer'];
const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
type Scheme = (typeof SCHEMES)[number];

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

const SCHEME_LABEL: Record<Scheme, string> = { light: 'Light', dark: 'Dark', night: 'Night' };

async function open(page: Page, state: string, scheme: Scheme): Promise<void> {
  await page.goto(`/dev/now?state=${state}`);
  await page.getByRole('radio', { name: SCHEME_LABEL[scheme] }).click();
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(700); // fonts and live queries settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `now-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Now screen in every scenario, scheme, language and viewport', async ({ browser }) => {
  const states = pick(process.env.NOW_STATES, STATES);
  const viewports = pick(process.env.NOW_VIEWPORTS, Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]);
  const schemes = pick(process.env.NOW_SCHEMES, SCHEMES);
  const locales = pick(process.env.NOW_LOCALES, LOCALES);

  for (const locale of locales) {
    const context = await browser.newContext({
      viewport: VIEWPORTS.mobile,
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
    for (const viewport of viewports) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const scheme of schemes) {
        for (const state of states) {
          await open(page, state, scheme);
          await shoot(page, `${state}-${viewport}-${scheme}-${locale}`);
        }
      }
    }
    await context.close();
  }
});

test('Now trays, Why sheet and toast', async ({ browser }) => {
  const schemes = pick(process.env.NOW_SCHEMES, ['light', 'dark'] as const);
  const locales = pick(process.env.NOW_LOCALES, LOCALES);
  for (const locale of locales) {
    const context = await browser.newContext({
      viewport: VIEWPORTS.mobile,
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
    for (const scheme of schemes) {
      const tag = `mobile-${scheme}-${locale}`;
      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(Feed|Mamada)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `tray-feed-${tag}`, false);
      await page.keyboard.press('Escape');

      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(Diaper|Fralda)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `tray-diaper-${tag}`, false);
      await page.keyboard.press('Escape');

      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(Meds|Remédios)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `tray-meds-${tag}`, false);
      await page.keyboard.press('Escape');

      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(More|Mais)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `sheet-more-${tag}`, false);
      await page.keyboard.press('Escape');

      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(Why\?|Por quê\?)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `sheet-why-${tag}`, false);
      await page.keyboard.press('Escape');

      await open(page, 'awake', scheme);
      await page.getByRole('button', { name: /^(Fell asleep|Adormeceu)$/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `toast-asleep-${tag}`, false);

      await open(page, 'nursing', scheme);
      await page.getByRole('button', { name: /^(Switch side|Trocar lado)$/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `toast-nursing-${tag}`, false);
    }
    await context.close();
  }
});
