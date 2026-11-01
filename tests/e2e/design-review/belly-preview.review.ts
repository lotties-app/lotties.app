import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the belly pain card on Now and its Why sheet from the `/dev/now?state=belly` preview in
 * the light and dark schemes, English and Portuguese, on a phone (390x844). Credential-free (see
 * belly-preview.config.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = { light: 'Light', dark: 'Dark' } as const;
const LOCALES = ['en', 'pt-BR'] as const;

async function open(page: Page, scheme: keyof typeof SCHEMES): Promise<void> {
  await page.goto('/dev/now?state=belly');
  await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
  await page.getByRole('region', { name: /^(Belly pain pattern|Padrão de dor de barriga)$/ }).waitFor();
  await page.waitForTimeout(700); // fonts and live queries settle
}

async function shoot(page: Page, name: string, fullPage: boolean): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `belly-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('belly pain card and Why sheet', async ({ browser }) => {
  for (const locale of LOCALES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: locale === 'en' ? 'en-US' : 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem('baby-routine.locale', value);
        window.localStorage.removeItem('baby-routine.belly-pattern-dismissed.dev-now-baby');
      } catch {
        /* ignore */
      }
    }, locale);
    const page = await context.newPage();
    for (const scheme of Object.keys(SCHEMES) as (keyof typeof SCHEMES)[]) {
      const tag = `mobile-${scheme}-${locale}`;
      await open(page, scheme);
      await page
        .getByRole('region', { name: /^(Belly pain pattern|Padrão de dor de barriga)$/ })
        .scrollIntoViewIfNeeded();
      await shoot(page, `card-${tag}`, false);
      await shoot(page, `now-${tag}`, true);

      await page
        .getByRole('region', { name: /^(Belly pain pattern|Padrão de dor de barriga)$/ })
        .getByRole('button', { name: /^(Why\?|Por quê\?)$/ })
        .click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(500);
      await shoot(page, `why-${tag}`, false);
      await page.keyboard.press('Escape');
    }
    await context.close();
  }
});
