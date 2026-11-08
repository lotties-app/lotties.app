import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures every showcase screen (SCREENS) on a phone-sized viewport, in English and Portuguese,
 * from the `/dev/*` previews (synthetic data only). Raw PNGs go to showcase/output/raw (gitignored);
 * `build-media.mjs` turns them into the small WebP files that are committed.
 *
 * Narrow it with SHOWCASE_ONLY=now,insights SHOWCASE_LOCALES=en SHOWCASE_SCHEMES=light.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(here, 'output', 'raw');
fs.mkdirSync(RAW, { recursive: true });

export const VIEWPORT = { width: 390, height: 844 } as const;
const LOCALES = ['en', 'pt-BR'] as const;
type Locale = (typeof LOCALES)[number];
type Scheme = 'light' | 'dark';

export interface Screen {
  /** File stem, also the key used by the landing page and the README. */
  id: string;
  /** Preview route with its scenario. */
  route: string;
  /** Schemes to capture (light only unless dark adds something). */
  schemes?: Scheme[];
  /** Extra steps once the route is shown (open a sheet, scroll...). */
  prepare?: (page: Page) => Promise<void>;
}

export const SCREENS: Screen[] = [
  { id: 'now', route: '/dev/now?state=awake', schemes: ['light', 'dark'] },
  { id: 'bottle-followup', route: '/dev/now?state=bottlesleep' },
  { id: 'log-feed', route: '/dev/sheet?state=bottle' },
  { id: 'log-sleep', route: '/dev/sheet?state=sleep' },
  { id: 'log-diaper', route: '/dev/sheet?state=diaper' },
  { id: 'insights', route: '/dev/insights?state=rich' },
  { id: 'vaccines', route: '/dev/vaccines?state=timeline' },
  { id: 'sharing', route: '/dev/roles' },
  { id: 'doctor', route: '/dev/doctor-dashboard?state=summary' },
  { id: 'data-location', route: '/dev/data-location?state=hosted' },
];

const pick = (env: string | undefined, all: readonly string[]) =>
  env ? all.filter((v) => env.split(',').includes(v)) : [...all];

export async function hideToolbar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const select = document.querySelector('select[aria-label="Scenario"]');
    const bar = select?.parentElement;
    if (bar instanceof HTMLElement) bar.style.display = 'none';
  });
}

export async function openScreen(page: Page, screen: Screen, locale: Locale, scheme: Scheme) {
  // Language and scheme through the app's own storage keys (a modal sheet covers the preview toolbar).
  await page.addInitScript(
    ([l, t]) => {
      localStorage.setItem('baby-routine.locale', l);
      localStorage.setItem('baby-routine.theme', t);
    },
    [locale, scheme],
  );
  const sep = screen.route.includes('?') ? '&' : '?';
  await page.goto(`${screen.route}${sep}scheme=${scheme}`);
  await page.locator('h1, h2, p').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1200); // fonts and live queries settle
  if (screen.prepare) await screen.prepare(page);
  await hideToolbar(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const locale of pick(process.env.SHOWCASE_LOCALES, LOCALES) as Locale[]) {
  for (const screen of SCREENS.filter((s) => pick(process.env.SHOWCASE_ONLY, SCREENS.map((x) => x.id)).includes(s.id))) {
    for (const scheme of (screen.schemes ?? ['light']).filter((s) =>
      pick(process.env.SHOWCASE_SCHEMES, ['light', 'dark']).includes(s),
    )) {
      test(`${screen.id} ${scheme} ${locale}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await openScreen(page, screen, locale, scheme);
        await page.screenshot({
          path: path.join(RAW, `${screen.id}-${scheme}-${locale}.png`),
          animations: 'disabled',
        });
        await context.close();
      });
    }
  }
}
