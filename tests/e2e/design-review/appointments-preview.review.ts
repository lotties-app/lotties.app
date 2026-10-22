import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the appointment screens (`/dev/appointments`): the month calendar with several
 * appointments and the agenda, a chosen day, the new and edit sheets, the detail of an upcoming
 * one and of a passed one ("Did it happen?"), the Now card, the Day strip, and the Caregiver's
 * read-only screen and detail, in light, dark and night, English and Portuguese, on a phone
 * (390x844), plus the month and the Day strip on a small phone (320x568). Credential-free (see
 * appointments-preview.config.ts).
 *
 * Narrow it with APPOINTMENTS_SCHEMES=dark APPOINTMENTS_LOCALES=en APPOINTMENTS_STATES=month,sheet.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
/** Full-page screens, then the sheets (shot as the viewport, where the sheet sits). */
const PAGES = ['month', 'day', 'now', 'daystrip', 'caregiver', 'empty'] as const;
const SHEETS = ['sheet', 'edit', 'detail', 'ask', 'caregiverDetail'] as const;

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
  await page.goto(`/dev/appointments?state=${state}&scheme=${scheme}`);
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

test('The appointment pages', async ({ browser }) => {
  for (const locale of pick(process.env.APPOINTMENTS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.APPOINTMENTS_SCHEMES, SCHEMES)) {
      for (const state of pick(process.env.APPOINTMENTS_STATES, PAGES)) {
        await open(page, state, scheme);
        await shoot(page, `appointments-${state}-${scheme}-${locale}`);
      }
    }
    await context.close();
  }
});

test('The appointment sheets', async ({ browser }) => {
  for (const locale of pick(process.env.APPOINTMENTS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.APPOINTMENTS_SCHEMES, SCHEMES)) {
      for (const state of pick(process.env.APPOINTMENTS_STATES, SHEETS)) {
        await open(page, state, scheme);
        await shoot(page, `appointments-${state}-${scheme}-${locale}`, false);
        const dialog = page.getByRole('dialog');
        // The rest of a long sheet: scroll its paper to the end.
        await dialog.evaluate((element) => {
          const paper = element.querySelector('.MuiDrawer-paper') ?? element;
          paper.scrollTop = paper.scrollHeight;
        });
        await page.waitForTimeout(300);
        await shoot(page, `appointments-${state}-end-${scheme}-${locale}`, false);
      }
    }
    await context.close();
  }
});

test('Small phone', async ({ browser }) => {
  for (const locale of pick(process.env.APPOINTMENTS_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale, 320, 568);
    const page = await context.newPage();
    for (const state of pick(process.env.APPOINTMENTS_STATES, ['month', 'daystrip'] as const)) {
      await open(page, state, 'light');
      await shoot(page, `appointments-${state}-small-light-${locale}`);
    }
    await context.close();
  }
});

/**
 * The Day header with the calendar button (`?state=daystrip`): the month label stays on one line,
 * unclipped and without overlap, at 360, 390 and 430 px, light and dark, English and Portuguese,
 * at 100 % and 130 % text. Shots: appointments-dayheader-{width}-{text}-{scheme}-{locale}.png.
 */
test('Day header widths', async ({ browser }) => {
  const problems: string[] = [];
  for (const locale of pick(process.env.APPOINTMENTS_LOCALES, LOCALES)) {
    for (const width of [360, 390, 430]) {
      const context = await contextFor(browser, locale, width, 700);
      const page = await context.newPage();
      for (const scheme of pick(process.env.APPOINTMENTS_SCHEMES, ['light', 'dark'] as const)) {
        for (const text of [100, 130]) {
          await open(page, 'daystrip', scheme);
          if (text !== 100) {
            await page.addStyleTag({ content: `html { font-size: ${text}% !important; }` });
            await page.waitForTimeout(400);
          }
          const check = await page.evaluate(() => {
            const button = document.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
            const shown = Array.from(
              button?.querySelectorAll<HTMLElement>('.month-long, .month-short') ?? [],
            ).find((span) => getComputedStyle(span).display !== 'none');
            if (!button || !shown) return { ok: false, why: 'label not found' };
            const lineHeight = parseFloat(getComputedStyle(shown).lineHeight);
            const row = button.parentElement!.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            const siblings = Array.from(button.parentElement!.children).map((child) =>
              child.getBoundingClientRect(),
            );
            const overlap = siblings.some(
              (rect, index) => index > 0 && rect.left < siblings[index - 1]!.right - 0.5,
            );
            return {
              ok:
                shown.getBoundingClientRect().height <= lineHeight * 1.5 &&
                shown.scrollWidth <= shown.clientWidth + 1 &&
                row.height <= 48 &&
                box.width > 0 &&
                !overlap,
              why: `${shown.textContent} h=${shown.getBoundingClientRect().height} lh=${lineHeight} sw=${shown.scrollWidth} cw=${shown.clientWidth} row=${row.height} overlap=${overlap}`,
            };
          });
          if (!check.ok) problems.push(`${width}px ${text}% ${scheme} ${locale}: ${check.why}`);
          await page.screenshot({
            path: file(`appointments-dayheader-${width}-${text}-${scheme}-${locale}`),
            clip: { x: 0, y: 0, width, height: 260 },
            animations: 'disabled',
          });
        }
      }
      await context.close();
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
