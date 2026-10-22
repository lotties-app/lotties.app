import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The day rhythm ring and the ruler (see ring.config.ts): every state of `/dev/ring` in light,
 * dark and night, English and Portuguese, at 360, 390 and 430 px wide and at 100, 130 and 160 %
 * root font size; plus the real Now screen with the ring at 11:11. Each shot is also measured:
 * no horizontal scroll, the ring inside the viewport, hour labels inside the ring's box and clear
 * of each other and of the "now" dot, the middle text inside the inner circle. Findings go to
 * docs/design/screenshots/ring-layout.json and fail the run.
 *
 * Narrow it with RING_STATES=ahead,busy RING_WIDTHS=360 RING_SCALES=160 RING_SCHEMES=dark
 * RING_LOCALES=pt-BR RING_VIEWS=ring.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const STATES = ['ahead', 'inside', 'asleep', 'night', 'empty', 'busy'] as const;
const WIDTHS = ['360', '390', '430'] as const;
const SCALES = ['100', '130', '160'] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const VIEWS = ['ring', 'ruler'] as const;

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
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
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

/** Layout problems of the ring on the page (empty when clean). */
function measure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 0.5) {
      out.push(`horizontal scroll (${document.documentElement.scrollWidth} > ${vw})`);
    }
    const ring = document.querySelector('[data-testid="day-ring"]');
    const svg = ring?.querySelector('svg[role="img"]');
    if (!ring || !svg) return out;
    const box = svg.getBoundingClientRect();
    if (box.left < -0.5 || box.right > vw + 0.5) out.push(`ring outside viewport (${box.left}-${box.right})`);
    const card = ring.closest('.MuiCard-root');
    if (card) {
      const c = card.getBoundingClientRect();
      if (box.left < c.left - 0.5 || box.right > c.right + 0.5) out.push('ring wider than its card');
    }
    const inside = (r: DOMRect) =>
      r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => ({
      text: t.textContent,
      rect: t.getBoundingClientRect(),
    }));
    const dot = svg.querySelector('[data-testid="ring-now"] circle')?.getBoundingClientRect();
    for (const [i, label] of labels.entries()) {
      if (!inside(label.rect)) out.push(`label ${label.text} outside the ring box`);
      if (dot && hit(label.rect, dot)) out.push(`label ${label.text} under the now dot`);
      for (const other of labels.slice(i + 1)) {
        if (hit(label.rect, other.rect)) out.push(`labels ${label.text} and ${other.text} overlap`);
      }
    }
    // The middle text must sit inside the inner edge of the track (radius 83 of 280).
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const inner = (83 / 280) * box.width;
    const middle = ring.querySelector('[data-testid="ring-middle"]');
    for (const child of Array.from(middle?.children ?? [])) {
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const r of Array.from(range.getClientRects())) {
        const corners = [
          [r.left, r.top],
          [r.right, r.top],
          [r.left, r.bottom],
          [r.right, r.bottom],
        ];
        if (corners.some(([x, y]) => Math.hypot(x - cx, y - cy) > inner + 0.5)) {
          out.push(`middle text "${child.textContent}" reaches the ring`);
          break;
        }
      }
    }
    return out;
  });
}

const problems: string[] = [];

test.afterAll(() => {
  fs.writeFileSync(path.join(SHOTS, 'ring-layout.json'), JSON.stringify(problems, null, 2));
});

test('ring and ruler states', async ({ browser }) => {
  for (const locale of pick(process.env.RING_LOCALES, LOCALES)) {
    for (const width of pick(process.env.RING_WIDTHS, WIDTHS)) {
      for (const view of pick(process.env.RING_VIEWS, VIEWS)) {
        await withContext(browser, Number(width), locale, view, async (page) => {
          for (const scale of pick(process.env.RING_SCALES, SCALES)) {
            for (const scheme of pick(process.env.RING_SCHEMES, SCHEMES)) {
              for (const state of pick(process.env.RING_STATES, STATES)) {
                // The ruler exists only while awake.
                if (view === 'ruler' && (state === 'asleep' || state === 'night')) continue;
                await page.goto(`/dev/ring?state=${state}&view=${view}&scale=${scale}&scheme=${scheme}`);
                await page.getByTestId('ring-card').waitFor();
                await page.waitForTimeout(250);
                const tag = `${view}-${state}-${width}-${scale}-${scheme}-${locale}`;
                await page.getByTestId('ring-card').screenshot({
                  path: path.join(SHOTS, `ring-${tag}.png`),
                  animations: 'disabled',
                });
                for (const found of await measure(page)) problems.push(`${tag}: ${found}`);
              }
            }
          }
        });
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});

test('the Now screen with the ring at 11:11', async ({ browser }) => {
  test.skip(process.env.RING_NOW === '0');
  for (const locale of pick(process.env.RING_LOCALES, LOCALES)) {
    for (const width of pick(process.env.RING_WIDTHS, WIDTHS)) {
      await withContext(browser, Number(width), locale, 'ring', async (page) => {
        const now = new Date();
        now.setHours(11, 11, 0, 0);
        await page.clock.setFixedTime(now);
        await page.goto('/dev/now?state=awake');
        await page.getByTestId('day-ring').waitFor();
        await page.waitForTimeout(600);
        const tag = `now-${width}-${locale}`;
        await page.screenshot({ path: path.join(SHOTS, `ring-${tag}.png`), fullPage: true });
        for (const found of await measure(page)) problems.push(`${tag}: ${found}`);
      });
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));
});
