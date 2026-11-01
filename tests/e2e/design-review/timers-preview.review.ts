import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the timer surfaces: the Now screen with a paused nap and with several timers, the
 * global mini timer bar over Now and Day (list expanded), the timer sheet (with the sleep
 * details open), the event sheet with sleep details and the Day rows with the details summary.
 * Light, dark and night schemes, English and Portuguese, 390x844 and 1280x800, and 320x568 for the
 * bar and the sheet. Credential-free (see timers-preview.config.ts).
 *
 * Narrow it with TIMERS_VIEWPORTS=mobile TIMERS_SCHEMES=dark TIMERS_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
  small: { width: 320, height: 568 },
} as const;
type Viewport = keyof typeof VIEWPORTS;
const SCHEMES = ['light', 'dark', 'night'] as const;
type Scheme = (typeof SCHEMES)[number];
const LOCALES = ['en', 'pt-BR'] as const;
const SCHEME_LABEL: Record<Scheme, string> = { light: 'Light', dark: 'Dark', night: 'Night' };

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function open(page: Page, route: string, scheme: Scheme): Promise<void> {
  if (route.startsWith('/dev/sheet')) {
    // The open sheet hides the toolbar from assistive tech: the preview takes the scheme as a parameter.
    await page.goto(`${route}&scheme=${scheme}`);
  } else {
    await page.goto(route);
    await page.getByRole('radio', { name: SCHEME_LABEL[scheme] }).click();
  }
  await page.locator('h1, h2, [data-testid="mini-timer-bar"], [role="dialog"]').first().waitFor({
    state: 'attached',
  });
  await page.waitForTimeout(800);
}

async function shoot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `timers-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('timer surfaces in every scheme, language and viewport', async ({ browser }) => {
  const viewports = pick(process.env.TIMERS_VIEWPORTS, Object.keys(VIEWPORTS) as Viewport[]);
  const schemes = pick(process.env.TIMERS_SCHEMES, SCHEMES);
  const locales = pick(process.env.TIMERS_LOCALES, LOCALES);

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
        const tag = `${viewport}-${scheme}-${locale}`;

        // Now: a paused nap with its target, and several timers.
        await open(page, '/dev/now?state=paused', scheme);
        await shoot(page, `now-paused-${tag}`, viewport !== 'small');
        await open(page, '/dev/now?state=timers', scheme);
        await shoot(page, `now-timers-${tag}`, viewport !== 'small');

        // Day: the global bar over another tab, then its list.
        await open(page, '/dev/day?state=timers', scheme);
        await shoot(page, `day-bar-${tag}`);
        const count = page.getByTestId('mini-timer-count');
        if (await count.count()) {
          await count.click();
          await page.waitForTimeout(300);
          await shoot(page, `day-bar-list-${tag}`);
        }

        // The timer sheet (not in the night view, where the bar is hidden by design).
        if (scheme !== 'night') {
          await open(page, '/dev/day?state=timers', scheme);
          await page.getByTestId('mini-timer-open').click();
          await page.waitForTimeout(500);
          await shoot(page, `sheet-${tag}`);
          await page.getByRole('button', { name: /^(Sleep details|Detalhes do sono)/ }).click();
          await page.waitForTimeout(500);
          await page.getByRole('dialog').evaluate((el) => {
            el.scrollTop = el.scrollHeight;
            el.querySelectorAll('*').forEach((child) => {
              if (child.scrollHeight > child.clientHeight + 20) child.scrollTop = child.scrollHeight;
            });
          });
          await page.waitForTimeout(300);
          await shoot(page, `sheet-details-${tag}`);
          await page.getByRole('button', { name: /^(Pause|Pausar)/ }).first().click();
          await page.waitForTimeout(500);
          await shoot(page, `sheet-paused-${tag}`);
        }
      }
    }

    // Event sheet with sleep details, Day rows with the summary (mobile and desktop).
    for (const viewport of viewports.filter((v) => v !== 'small')) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const scheme of schemes) {
        const tag = `${viewport}-${scheme}-${locale}`;
        await open(page, '/dev/sheet?state=sleepdetails', scheme);
        await page.getByRole('button', { name: /^(Sleep details|Detalhes do sono)/ }).click();
        await page.waitForTimeout(500);
        await shoot(page, `event-sheet-details-${tag}`);
        await open(page, '/dev/day?state=full&offset=1', scheme);
        await shoot(page, `day-details-${tag}`);
      }
    }
    await context.close();
  }
});
