import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The rhythm details (see rhythm.config.ts): `/dev/ring` per state at 320 and 390 px, light and
 * dark (and night once), English and Portuguese, with nothing selected, with a mark selected (the
 * nap window, the face of now, a projected nap, the likely wake-up) and a hover tooltip; plus the
 * real Now screen while awake and during a nap. Each shot is measured: no horizontal scroll, the
 * detail strip inside the card. Findings go to docs/design/screenshots/rhythm-layout.json and
 * fail the run.
 *
 * Narrow it with RHYTHM_STATES=ahead RHYTHM_WIDTHS=320 RHYTHM_SCHEMES=dark RHYTHM_LOCALES=en
 * RHYTHM_VIEWS=ring.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = ['320', '390'] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const VIEWS = ['ring', 'ruler'] as const;

/** Each state and the marks to select in it (`none` = the default view). */
const CASES: Record<string, readonly string[]> = {
  ahead: ['none', 'window', 'projected', 'now'],
  inside: ['none', 'now'],
  tired: ['now'],
  asleep: ['none', 'wake', 'projected'],
  busy: ['none'],
};

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function withContext(
  browser: Browser,
  width: number,
  locale: string,
  view: string,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    locale: locale === 'en' ? 'en-US' : 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript(
    ([localeValue, viewValue]) => {
      try {
        window.localStorage.setItem('baby-routine.locale', localeValue);
        window.localStorage.setItem('baby-routine.now-view', viewValue);
        window.localStorage.setItem('baby-routine.now-ring-open', 'open');
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

function measure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 0.5) {
      out.push(`horizontal scroll (${document.documentElement.scrollWidth} > ${vw})`);
    }
    const strip = document.querySelector('[data-testid="rhythm-strip"]');
    const card = strip?.closest('.MuiCard-root');
    if (strip && card) {
      const s = strip.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (s.left < c.left - 0.5 || s.right > c.right + 0.5) out.push('detail strip wider than its card');
    }
    // The head of the face of now (not the legend's) should read at about 22 to 26 px.
    for (const head of Array.from(document.querySelectorAll('[data-face-head]'))) {
      if (head.closest('[data-testid="ring-legend"]')) continue;
      const r = head.getBoundingClientRect();
      if (r.width > 0 && (r.width < 21.5 || r.width > 26.5)) out.push(`face ${Math.round(r.width)} px wide`);
    }
    return out;
  });
}

const problems: string[] = [];

test.afterAll(() => {
  fs.writeFileSync(path.join(SHOTS, 'rhythm-layout.json'), JSON.stringify(problems, null, 2));
});

test('ring and ruler details', async ({ browser }) => {
  const states = pick(process.env.RHYTHM_STATES, Object.keys(CASES));
  for (const locale of pick(process.env.RHYTHM_LOCALES, LOCALES)) {
    for (const width of pick(process.env.RHYTHM_WIDTHS, WIDTHS)) {
      for (const view of pick(process.env.RHYTHM_VIEWS, VIEWS)) {
        await withContext(browser, Number(width), locale, view, async (page) => {
          for (const scheme of pick(process.env.RHYTHM_SCHEMES, SCHEMES)) {
            // Night once per view and locale, at the narrow width.
            if (scheme === 'night' && width !== '320') continue;
            for (const state of states) {
              if (view === 'ruler' && state === 'asleep') continue;
              for (const select of CASES[state]) {
                if (view === 'ruler' && select === 'wake') continue;
                await page.goto(`/dev/ring?state=${state}&view=${view}&scheme=${scheme}`);
                await page.getByTestId('ring-card').waitFor();
                await page.waitForTimeout(200);
                if (select !== 'none') {
                  const mark = page.getByTestId(`rhythm-mark-${select}`).first();
                  if ((await mark.count()) === 0) {
                    problems.push(`${state}-${view}: no ${select} mark to select`);
                    continue;
                  }
                  // A click event on the mark itself: the middle of an arc's box is not on the arc.
                  await mark.dispatchEvent('click');
                  await page.waitForTimeout(250);
                }
                const tag = `${view}-${state}-${select}-${width}-${scheme}-${locale}`;
                await page.getByTestId('ring-card').screenshot({
                  path: path.join(SHOTS, `rhythm-${tag}.png`),
                  animations: 'disabled',
                });
                for (const found of await measure(page)) problems.push(`${tag}: ${found}`);
              }
            }
          }
          // One hover tooltip per view and locale (a pointer device), light, on the window.
          await page.goto(`/dev/ring?state=ahead&view=${view}&scheme=light`);
          await page.getByTestId('ring-card').waitFor();
          await page.getByTestId('rhythm-mark-window').first().dispatchEvent('mouseover');
          await page.getByRole('tooltip').waitFor();
          await page.screenshot({
            path: path.join(SHOTS, `rhythm-hover-${view}-${width}-${locale}.png`),
          });
        });
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});

test('the Now screen with the rhythm details', async ({ browser }) => {
  for (const locale of pick(process.env.RHYTHM_LOCALES, LOCALES)) {
    for (const [state, view] of [
      ['awake', 'ring'],
      ['awake', 'ruler'],
      ['nap', 'ring'],
    ] as const) {
      await withContext(browser, 390, locale, view, async (page) => {
        await page.goto(`/dev/now?state=${state}`);
        await page.getByTestId('rhythm-region').waitFor();
        await page.waitForTimeout(600);
        const tag = `now-${state}-${view}-390-${locale}`;
        await page.getByTestId('rhythm-region').screenshot({ path: path.join(SHOTS, `rhythm-${tag}.png`) });
        for (const found of await measure(page)) problems.push(`${tag}: ${found}`);
      });
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
