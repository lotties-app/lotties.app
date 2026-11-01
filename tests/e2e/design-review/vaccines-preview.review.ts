import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the vaccine screens (`/dev/vaccines`): the schedule timeline, the private-clinic view,
 * the "About this baby" block of a premature baby, the Now card, the printable vaccination card,
 * the read-only Caregiver page and the missing birth date; then the record sheet, the edit sheet
 * and the sources, in light and dark, English and Portuguese, on a phone (390x844), plus the page
 * and the record sheet on a small phone (320x568). Credential-free (see vaccines-preview.config.ts).
 *
 * Narrow it with VACCINES_SCHEMES=dark VACCINES_LOCALES=en VACCINES_STATES=timeline,record.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
/** Full-page screens, then the sheets (shot as the viewport, where the sheet sits). */
const PAGES = ['timeline', 'private', 'profile', 'now', 'card', 'caregiver', 'empty'] as const;
const SHEETS = ['record', 'edit', 'sources'] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function contextFor(browser: Browser, locale: string, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
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
  await page.goto(`/dev/vaccines?state=${state}&scheme=${scheme}`);
  await page.locator('select[aria-label="Scenario"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500); // fonts, live queries, the lazy date field and the seed settle
}

const file = (name: string) => path.join(SHOTS, `${name}.png`);

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: file(name),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('The vaccine pages', async ({ browser }) => {
  for (const locale of pick(process.env.VACCINES_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.VACCINES_SCHEMES, SCHEMES)) {
      for (const state of pick(process.env.VACCINES_STATES, PAGES)) {
        await open(page, state, scheme);
        await shoot(page, `vaccines-${state}-${scheme}-${locale}`);
      }
    }
    await context.close();
  }
});

test('The vaccine sheets', async ({ browser }) => {
  for (const locale of pick(process.env.VACCINES_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.VACCINES_SCHEMES, SCHEMES)) {
      for (const state of pick(process.env.VACCINES_STATES, SHEETS)) {
        await open(page, state, scheme);
        await shoot(page, `vaccines-${state}-${scheme}-${locale}`, false);
        const dialog = page.getByRole('dialog');
        // The rest of a long sheet: scroll its paper to the end.
        await dialog.evaluate((element) => {
          const paper = element.querySelector('.MuiDrawer-paper') ?? element;
          paper.scrollTop = paper.scrollHeight;
        });
        await page.waitForTimeout(300);
        await shoot(page, `vaccines-${state}-end-${scheme}-${locale}`, false);
      }
    }
    await context.close();
  }
});

test('Small phone', async ({ browser }) => {
  for (const locale of pick(process.env.VACCINES_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale, 320, 568);
    const page = await context.newPage();
    for (const state of pick(process.env.VACCINES_STATES, ['timeline', 'card', 'record'] as const)) {
      await open(page, state, 'light');
      await shoot(page, `vaccines-${state}-small-light-${locale}`, state !== 'record');
    }
    await context.close();
  }
});

/** The printed card: the app's header and bottom bar are hidden, the table is ruled black on white. */
test('The printed card', async ({ browser }) => {
  for (const locale of pick(process.env.VACCINES_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale, 794, 1123);
    const page = await context.newPage();
    await open(page, 'card', 'dark');
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    await shoot(page, `vaccines-card-print-${locale}`, false);
    await context.close();
  }
});
