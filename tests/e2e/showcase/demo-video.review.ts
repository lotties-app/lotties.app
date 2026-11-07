import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Records the demo video (one per language) from the `/dev/*` previews: synthetic data only.
 * Raw WebM files go to showcase/output/video (gitignored); `build-media.mjs` encodes the MP4/WebM
 * and the poster that are committed. A short tour: Now, a quick diaper log (one tap on Wet), the bottle follow-up,
 * Insights, vaccines, sharing with a caregiver and the doctor's view.
 *
 * Narrow it with SHOWCASE_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'output', 'video');
fs.mkdirSync(OUT, { recursive: true });

const LOCALES = ['en', 'pt-BR'] as const;
type Locale = (typeof LOCALES)[number];
const TEXT: Record<Locale, { diaper: RegExp; wet: RegExp; chip: RegExp }> = {
  en: { diaper: /^Diaper/, wet: /Wet/, chip: /60 ml/ },
  'pt-BR': { diaper: /^Fralda/, wet: /Xixi/, chip: /60 ml/ },
};

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Smooth scroll: a fixed pixel step per frame, so the video shows a steady drag. */
async function scrollBy(page: Page, distance: number, ms: number): Promise<void> {
  await page.evaluate(
    ([d, t]) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        let done = 0;
        const step = (now: number) => {
          const target = Math.min(1, (now - start) / t) * d;
          window.scrollBy(0, target - done);
          done = target;
          if (now - start < t) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [distance, ms] as const,
  );
}

/** Another preview route without a page reload (no blank flash in the video). */
async function go(page: Page, route: string): Promise<void> {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(page, 900);
}

const HIDE_TOOLBAR = 'div:has(> select[aria-label="Scenario"]) { display: none !important; }';
const ROUTES = [
  '/dev/now?state=awake',
  '/dev/now?state=bottlesleep',
  '/dev/insights?state=rich',
  '/dev/vaccines?state=timeline',
  '/dev/roles',
  '/dev/doctor-dashboard?state=summary',
];

/** Visits every route once without recording, so the dev server has compiled them all (no loading skeletons in the video). */
async function warmUp(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForTimeout(2500);
  }
  await context.close();
}

for (const locale of LOCALES.filter((l) =>
  process.env.SHOWCASE_LOCALES ? process.env.SHOWCASE_LOCALES.split(',').includes(l) : true,
)) {
  test(`demo video ${locale}`, async ({ browser }) => {
    const t = TEXT[locale];
    await warmUp(browser);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale,
      recordVideo: { dir: path.join(OUT, `tmp-${locale}`), size: { width: 390, height: 844 } },
    });
    await context.addInitScript(
      ([l, css]) => {
        localStorage.setItem('baby-routine.locale', l);
        localStorage.setItem('baby-routine.theme', 'light');
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = css;
          document.head.append(style);
        });
      },
      [locale, HIDE_TOOLBAR],
    );
    const page = await context.newPage();
    await page.goto('/dev/now?state=awake');
    await page.getByRole('region', { name: /Current state|Estado atual/ }).waitFor();
    await pause(page, 800);

    // 1. Now: what is happening and what is next.
    await pause(page, 1500);
    await scrollBy(page, 420, 2500);
    await pause(page, 1200);
    await scrollBy(page, -420, 1500);
    await pause(page, 600);

    // 2. Quick log: a diaper in two taps.
    await page.getByRole('button', { name: t.diaper }).first().click();
    await pause(page, 1200);
    await page.getByRole('dialog').getByRole('button', { name: t.wet }).first().click();
    await pause(page, 2000);

    // 3. The bottle follow-up after she fell asleep.
    await go(page, '/dev/now?state=bottlesleep');
    await pause(page, 2200);
    await page.getByText(t.chip).first().click();
    await pause(page, 1800);

    // 4. Insights.
    await go(page, '/dev/insights?state=rich');
    await pause(page, 1500);
    await scrollBy(page, 900, 4000);
    await pause(page, 800);

    // 5. Vaccines.
    await go(page, '/dev/vaccines?state=timeline');
    await pause(page, 1500);
    await scrollBy(page, 700, 3500);
    await pause(page, 600);

    // 6. Sharing with a caregiver.
    await go(page, '/dev/roles');
    await pause(page, 1500);
    await scrollBy(page, 350, 2500);
    await pause(page, 1000);

    // 7. The doctor's view.
    await page.goto('/dev/doctor-dashboard?state=summary');
    await pause(page, 1800);
    await scrollBy(page, 600, 3500);
    await pause(page, 1200);

    const video = page.video();
    await context.close();
    if (video) await video.saveAs(path.join(OUT, `demo-${locale}.webm`));
    fs.rmSync(path.join(OUT, `tmp-${locale}`), { recursive: true, force: true });
  });
}
