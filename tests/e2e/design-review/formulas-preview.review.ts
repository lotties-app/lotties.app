import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the formula screens (`/dev/formulas`): Settings > Formulas (Owner and Caregiver), the
 * add sheet, a bottle of formula in the event sheet with its chips and the inline "New formula"
 * sheet with name suggestions, and the Formulas card of Insights (two formulas side by side, its
 * table, one formula with another still collecting) in light, dark and night, English and
 * Portuguese, on a phone (390x844). Credential-free (see formulas-preview.config.ts).
 *
 * Narrow it with FORMULAS_SCHEMES=dark FORMULAS_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

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

async function open(page: Page, state: string, scheme: string): Promise<void> {
  await page.goto(`/dev/formulas?state=${state}&scheme=${scheme}`);
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1500); // fonts, live queries and the seed settle
}

const file = (name: string) => path.join(SHOTS, `${name}.png`);

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: file(name), fullPage, animations: 'disabled', caret: 'hide' });
}

const en = (locale: string) => locale === 'en';

test('Settings > Formulas and the add sheet', async ({ browser }) => {
  for (const locale of pick(process.env.FORMULAS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.FORMULAS_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, 'settings', scheme);
      await shoot(page, `formulas-settings-${tag}`);
      await open(page, 'caregiver', scheme);
      await shoot(page, `formulas-settings-caregiver-${tag}`);
      await open(page, 'sheet', scheme);
      await shoot(page, `formulas-sheet-${tag}`, false);
    }
    await context.close();
  }
});

test('The bottle chips and the inline new formula sheet', async ({ browser }) => {
  for (const locale of pick(process.env.FORMULAS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.FORMULAS_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, 'chips', scheme);
      const chips = page.getByRole('radiogroup', { name: en(locale) ? /^Formula/ : /^Fórmula/ });
      await chips.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shoot(page, `formulas-chips-${tag}`, false);
      await page.getByRole('button', { name: en(locale) ? 'New formula' : 'Nova fórmula' }).click();
      await page.getByRole('textbox', { name: en(locale) ? /^Name/ : /^Nome/ }).fill('apt');
      await page.waitForTimeout(400);
      await shoot(page, `formulas-new-${tag}`, false);
    }
    await context.close();
  }
});

test('The Formulas card of Insights', async ({ browser }) => {
  for (const locale of pick(process.env.FORMULAS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.FORMULAS_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, 'insights', scheme);
      const card = page.locator('section[data-insight="formulas"]');
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: file(`formulas-card-${tag}`), animations: 'disabled' });
      await card
        .getByRole('button', { name: en(locale) ? 'View as table' : 'Ver como tabela' })
        .click();
      await page.waitForTimeout(300);
      await card.screenshot({ path: file(`formulas-card-table-${tag}`), animations: 'disabled' });
      await open(page, 'single', scheme);
      const single = page.locator('section[data-insight="formulas"]');
      await single.scrollIntoViewIfNeeded();
      await single.screenshot({
        path: file(`formulas-card-single-${tag}`),
        animations: 'disabled',
      });
    }
    await context.close();
  }
});
