import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the overtired card and the fussy pattern card on Now, each with its Why sheet, from the
 * `/dev/now?state=overtired|fussy` preview in the light and dark schemes, English and Portuguese,
 * on a phone (390x844). Credential-free (see witching-preview.config.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = { light: 'Light', dark: 'Dark' } as const;
const LOCALES = ['en', 'pt-BR'] as const;
const CARDS = {
  overtired: /^(Witching hour heads-up|Aviso da hora da bruxa)$/,
  fussy: /^(Fussy time pattern|Padrão de irritação)$/,
} as const;

async function open(page: Page, state: keyof typeof CARDS, scheme: keyof typeof SCHEMES) {
  await page.goto(`/dev/now?state=${state}`);
  await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
  await page.getByRole('region', { name: CARDS[state] }).waitFor();
  await page.waitForTimeout(700); // fonts and live queries settle
}

async function shoot(page: Page, name: string, fullPage: boolean): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('overtired and fussy cards and Why sheets', async ({ browser }) => {
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
        window.localStorage.removeItem('baby-routine.overtired-dismissed.dev-now-baby');
        window.localStorage.removeItem('baby-routine.fussy-pattern-dismissed.dev-now-baby');
      } catch {
        /* ignore */
      }
    }, locale);
    const page = await context.newPage();
    for (const state of Object.keys(CARDS) as (keyof typeof CARDS)[]) {
      for (const scheme of Object.keys(SCHEMES) as (keyof typeof SCHEMES)[]) {
        const tag = `mobile-${scheme}-${locale}`;
        await open(page, state, scheme);
        const card = page.getByRole('region', { name: CARDS[state] });
        await card.scrollIntoViewIfNeeded();
        await shoot(page, `${state}-card-${tag}`, false);
        await shoot(page, `${state}-now-${tag}`, true);

        await card.getByRole('button', { name: /^(Why\?|Por quê\?)$/ }).click();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(500);
        await shoot(page, `${state}-why-${tag}`, false);
        await page.keyboard.press('Escape');
      }
    }
    await context.close();
  }
});
