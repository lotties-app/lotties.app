import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the wave 4c-2 polish pass in the developer-only previews (see polish.config.ts):
 * Now (several states), Day (full day, today), the event sheet (bottle, breast, sleep, edit), the
 * More sheet, the estimated nap sheet and the day ring; light, dark and night, English and
 * Portuguese, a phone (390x844), a small phone (320x568) and a desktop window (1280x800).
 *
 * Narrow it with POLISH_SET=now,day,sheet,sheets POLISH_VIEWPORTS=mobile POLISH_SCHEMES=dark
 * POLISH_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  small: { width: 320, height: 568 },
  desktop: { width: 1280, height: 800 },
} as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
type Scheme = (typeof SCHEMES)[number];
type Viewport = keyof typeof VIEWPORTS;
type Locale = (typeof LOCALES)[number];

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

const SCHEME_LABEL: Record<Scheme, string> = { light: 'Light', dark: 'Dark', night: 'Night' };

/**
 * Opens `url` in the scheme. The Now preview has its own switch to click; the Day and sheet
 * previews take `?scheme=` (a modal sheet would cover the switch).
 */
async function open(page: Page, url: string, scheme: Scheme) {
  if (url.startsWith('/dev/now')) {
    await page.goto(url);
    await page.getByRole('radio', { name: SCHEME_LABEL[scheme] }).click();
  } else {
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}scheme=${scheme}`);
  }
  await page.locator('h1, [role="dialog"]').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(800); // fonts and live queries settle
}

async function shoot(page: Page, name: string, fullPage = false) {
  await page.screenshot({
    path: path.join(SHOTS, `polish-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** One browser context per language; `run` gets a page already on that language. */
async function eachLocale(
  browser: import('@playwright/test').Browser,
  viewport: Viewport,
  locale: Locale,
  view: 'ruler' | 'ring',
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    locale: locale === 'en' ? 'en-US' : 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript(
    ([localeValue, viewValue]) => {
      try {
        window.localStorage.setItem('baby-routine.locale', localeValue);
        window.localStorage.setItem('baby-routine.now-view', viewValue);
      } catch {
        /* ignore */
      }
    },
    [locale, view],
  );
  const page = await context.newPage();
  await run(page);
  await context.close();
}

const sets = () => (process.env.POLISH_SET ?? 'now,day,sheet,sheets,overlap').split(',');
const viewports = () => pick(process.env.POLISH_VIEWPORTS, Object.keys(VIEWPORTS) as Viewport[]);
const schemes = () => pick(process.env.POLISH_SCHEMES, SCHEMES);
const locales = () => pick(process.env.POLISH_LOCALES, LOCALES);

test('Now in several states', async ({ browser }) => {
  test.skip(!sets().includes('now'));
  const states = (process.env.POLISH_NOW ?? 'awake,nap,night,nursing,forgotten,empty').split(',');
  for (const locale of locales()) {
    for (const viewport of viewports()) {
      await eachLocale(browser, viewport, locale, 'ruler', async (page) => {
        for (const scheme of schemes()) {
          for (const state of states) {
            await open(page, `/dev/now?state=${state}`, scheme);
            await shoot(page, `now-${state}-${viewport}-${scheme}-${locale}`, true);
          }
        }
      });
    }
  }
});

test('Now with the day ring', async ({ browser }) => {
  test.skip(!sets().includes('now'));
  for (const locale of locales()) {
    for (const viewport of viewports()) {
      await eachLocale(browser, viewport, locale, 'ring', async (page) => {
        for (const scheme of schemes()) {
          for (const state of ['awake', 'nap']) {
            await open(page, `/dev/now?state=${state}`, scheme);
            await shoot(page, `ring-${state}-${viewport}-${scheme}-${locale}`, true);
          }
        }
      });
    }
  }
});

test('Day: a full day and today', async ({ browser }) => {
  test.skip(!sets().includes('day'));
  for (const locale of locales()) {
    for (const viewport of viewports()) {
      await eachLocale(browser, viewport, locale, 'ruler', async (page) => {
        for (const scheme of schemes()) {
          await open(page, '/dev/day?state=full&offset=1', scheme);
          await shoot(page, `day-full-${viewport}-${scheme}-${locale}`, true);
          await open(page, '/dev/day?state=full&offset=0', scheme);
          await shoot(page, `day-today-${viewport}-${scheme}-${locale}`, true);
        }
      });
    }
  }
});

test('Event sheet', async ({ browser }) => {
  test.skip(!sets().includes('sheet'));
  const states = (process.env.POLISH_SHEET ?? 'bottle,breast,sleep,edit,medication').split(',');
  for (const locale of locales()) {
    for (const viewport of viewports()) {
      await eachLocale(browser, viewport, locale, 'ruler', async (page) => {
        for (const scheme of schemes()) {
          for (const state of states) {
            await open(page, `/dev/sheet?state=${state}`, scheme);
            await shoot(page, `sheet-${state}-${viewport}-${scheme}-${locale}`);
          }
        }
      });
    }
  }
});

test('Sheets: More, estimated nap, precise time', async ({ browser }) => {
  test.skip(!sets().includes('sheets'));
  for (const locale of locales()) {
    for (const viewport of viewports()) {
      await eachLocale(browser, viewport, locale, 'ruler', async (page) => {
        for (const scheme of schemes()) {
          const tag = `${viewport}-${scheme}-${locale}`;
          await open(page, '/dev/now?state=awake', scheme);
          await page.getByRole('button', { name: /^(Add event|Adicionar evento)$/ }).click();
          await page.waitForTimeout(500);
          await shoot(page, `more-${tag}`);
          await page.keyboard.press('Escape');

          // The night view has no nap window to open.
          if (scheme !== 'night') {
            await open(page, '/dev/now?state=awake', scheme);
            await page.getByRole('button', { name: /^(Estimated nap|Soneca estimada)/ }).click();
            await page.waitForTimeout(500);
            await shoot(page, `napsheet-${tag}`);
            await page.keyboard.press('Escape');
          }

          // The receipt toast with the drawing of what was logged.
          await open(page, '/dev/now?state=awake', scheme);
          const fell = page.getByRole('button', { name: /^(Fell asleep|Adormeceu)$/ });
          await fell.click();
          await page.waitForTimeout(500);
          await shoot(page, `toast-${tag}`);

          await open(page, '/dev/sheet?state=breast', scheme);
          await page.getByRole('button', { name: /^(More precise|Mais preciso)/ }).first().click();
          await page.waitForTimeout(300);
          await shoot(page, `sheet-precise-${tag}`);
        }
      });
    }
  }
});

/**
 * Overlap check of the event sheet: the blocks of the scrolling body (method, amount, bottle
 * content, note ...) must not intersect each other, and the Save button must stay inside the
 * viewport. Writes the findings to docs/design/screenshots/polish-overlap.json and fails on any.
 */
test('Event sheet blocks never overlap and Save stays in view', async ({ browser }) => {
  test.skip(!sets().includes('overlap'));
  const states = ['bottle', 'breast', 'solid', 'diaper', 'sleep', 'medication', 'belly', 'edit', 'running'];
  const problems: string[] = [];
  for (const locale of locales()) {
    for (const viewport of ['mobile', 'small'] as const) {
      await eachLocale(browser, viewport, locale, 'ruler', async (page) => {
        for (const state of states) {
          await open(page, `/dev/sheet?state=${state}`, 'light');
          // Open every folded part: the most content the sheet can hold.
          for (const name of [/^(More precise|Mais preciso)/, /^(Today|Hoje|Yesterday|Ontem)/]) {
            for (const button of await page.getByRole('button', { name }).all()) {
              if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
            }
          }
          await page.waitForTimeout(300);
          const found = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            const body = dialog
              ? Array.from(dialog.querySelectorAll<HTMLElement>('div')).find(
                  (el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > 0,
                )
              : null;
            if (!body) return ['no scrolling body found'];
            const blocks = Array.from(body.children) as HTMLElement[];
            const rects = blocks
              .map((el) => ({ el, rect: el.getBoundingClientRect() }))
              .filter(({ rect }) => rect.height > 0);
            const out: string[] = [];
            for (let i = 0; i < rects.length; i += 1) {
              for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i].rect;
                const b = rects[j].rect;
                if (a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5) {
                  out.push(`block ${i} overlaps block ${j} (${a.bottom} > ${b.top})`);
                }
              }
            }
            // Nested blocks of one row (fields with their own children) must not stick out sideways.
            for (const { el, rect } of rects) {
              if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto') {
                out.push(`block is wider than its column (${rect.width})`);
              }
            }
            const save = Array.from(document.querySelectorAll('button')).find((b) =>
              /^(Save|Salvar)/.test(b.textContent ?? ''),
            );
            const view = window.innerHeight;
            if (!save) out.push('no Save button');
            else {
              const r = save.getBoundingClientRect();
              if (r.top < 0 || r.bottom > view) out.push(`Save outside the viewport (${r.top}-${r.bottom} of ${view})`);
            }
            return out;
          });
          for (const message of found) problems.push(`${viewport} ${locale} ${state}: ${message}`);
        }
      });
    }
  }
  fs.writeFileSync(path.join(SHOTS, 'polish-overlap.json'), JSON.stringify(problems, null, 2));
  if (problems.length > 0) throw new Error(problems.join(', '));
});
