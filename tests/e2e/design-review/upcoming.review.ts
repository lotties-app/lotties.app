import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The "next up" layer (see upcoming.config.ts): `/dev/ring?state=afternoon&upcoming=...` at 320
 * and 390 px, light and dark (night once at 320), English and Portuguese, ring and ruler: a busy
 * afternoon with every layer on (feed, diaper, belly pain, poop and medicine markers), the same
 * with the default layers, little history (faint, low confidence), nothing at all, a marker
 * selected and the list expanded. Each shot is measured: no horizontal scroll, no two markers
 * drawn on top of each other, no ring marker over the middle text. Findings go to
 * docs/design/screenshots/upcoming-layout.json and fail the run.
 *
 * Narrow it with UPCOMING_CASES=busy UPCOMING_WIDTHS=320 UPCOMING_SCHEMES=dark
 * UPCOMING_LOCALES=en UPCOMING_VIEWS=ring.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = ['320', '390'] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const VIEWS = ['ring', 'ruler'] as const;
const ALL_LAYERS = ['sleep', 'feeds', 'diapers', 'patterns', 'medicine'];

interface Case {
  upcoming: 'busy' | 'low' | 'none';
  layers: string[] | null;
  /** Select this marker (`rhythm-mark-upcoming`, the first) and open the list. */
  select?: boolean;
}

const CASES: Record<string, Case> = {
  busy: { upcoming: 'busy', layers: ALL_LAYERS },
  default: { upcoming: 'busy', layers: null },
  selected: { upcoming: 'busy', layers: ALL_LAYERS, select: true },
  low: { upcoming: 'low', layers: null },
  none: { upcoming: 'none', layers: null },
};

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function withContext(
  browser: Browser,
  width: number,
  locale: string,
  view: string,
  layers: string[] | null,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: { width, height: 1100 },
    deviceScaleFactor: 2,
    locale: locale === 'en' ? 'en-US' : 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript(
    ([localeValue, viewValue, layersValue]) => {
      try {
        window.localStorage.setItem('baby-routine.locale', localeValue);
        window.localStorage.setItem('baby-routine.now-view', viewValue);
        window.localStorage.setItem('baby-routine.now-ring-open', 'open');
        if (layersValue) window.localStorage.setItem('baby-routine.now-layers', layersValue);
        else window.localStorage.removeItem('baby-routine.now-layers');
      } catch {
        /* ignore */
      }
    },
    [locale, view, layers ? JSON.stringify(layers) : ''],
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
    // The drawn stamps: the ring's circles (first circle of each marker group) and the ruler's.
    const stamps = [
      ...Array.from(document.querySelectorAll('[data-testid^="ring-upcoming-"]'))
        .filter((g) => g.getAttribute('data-testid') !== 'ring-upcoming-window')
        .map((g) => g.querySelector('circle'))
        .filter((c): c is SVGCircleElement => c !== null),
      ...Array.from(document.querySelectorAll('[data-testid^="ruler-upcoming-"] [data-stamp]')),
    ].map((el) => el.getBoundingClientRect());
    for (let i = 0; i < stamps.length; i += 1) {
      for (let j = i + 1; j < stamps.length; j += 1) {
        const a = stamps[i];
        const b = stamps[j];
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        if (overlap) out.push(`markers ${i} and ${j} overlap`);
      }
    }
    const middle = document.querySelector('[data-testid="ring-middle"]');
    if (middle) {
      const texts = Array.from(middle.querySelectorAll('p, span')).map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      });
      for (const stamp of stamps) {
        for (const text of texts) {
          const overlap =
            Math.min(stamp.right, text.right) - Math.max(stamp.left, text.left) > 1 &&
            Math.min(stamp.bottom, text.bottom) - Math.max(stamp.top, text.top) > 1;
          if (overlap && text.width > 0) out.push('a marker covers the middle text');
        }
      }
    }
    return out;
  });
}

const problems: string[] = [];

test.afterAll(() => {
  fs.writeFileSync(path.join(SHOTS, 'upcoming-layout.json'), JSON.stringify(problems, null, 2));
});

test('next up on the ring and the ruler', async ({ browser }) => {
  const cases = pick(process.env.UPCOMING_CASES, Object.keys(CASES));
  for (const locale of pick(process.env.UPCOMING_LOCALES, LOCALES)) {
    for (const width of pick(process.env.UPCOMING_WIDTHS, WIDTHS)) {
      for (const view of pick(process.env.UPCOMING_VIEWS, VIEWS)) {
        for (const name of cases) {
          const setup = CASES[name];
          await withContext(browser, Number(width), locale, view, setup.layers, async (page) => {
            for (const scheme of pick(process.env.UPCOMING_SCHEMES, SCHEMES)) {
              if (scheme === 'night' && width !== '320') continue;
              await page.goto(
                `/dev/ring?state=afternoon&view=${view}&scheme=${scheme}&upcoming=${setup.upcoming}`,
              );
              await page.getByTestId('ring-card').waitFor();
              await page.waitForTimeout(200);
              if (setup.select) {
                const showAll = page.getByRole('button', { name: /^(Show all|Ver tudo)/ });
                if ((await showAll.count()) > 0) await showAll.click();
                const mark = page
                  .locator('[data-testid="rhythm-mark-upcoming"], [data-testid="ruler-upcoming-feed"]')
                  .first();
                if ((await mark.count()) === 0) {
                  problems.push(`${name}-${view}: no marker to select`);
                } else {
                  await mark.dispatchEvent('click');
                  await page.waitForTimeout(250);
                }
              }
              const tag = `${view}-${name}-${width}-${scheme}-${locale}`;
              await page.getByTestId('ring-card').screenshot({
                path: path.join(SHOTS, `upcoming-${tag}.png`),
                animations: 'disabled',
              });
              for (const found of await measure(page)) problems.push(`${tag}: ${found}`);
            }
          });
        }
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
