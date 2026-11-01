import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the More sheet (full list, scrolled, hovered bar, a search), the Day timeline and the
 * event sheet in every scheme at 390 and 1280 px wide (see scrollbar.config.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const PHASE = process.env.SCROLLBAR_PHASE ?? 'after';
const SCHEMES = ['dark', 'light', 'night'] as const;
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

async function contextFor(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo',
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('baby-routine.locale', 'en');
    } catch {
      /* ignore */
    }
  });
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('main, [role="dialog"], h1, h2, p').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(900); // fonts, live queries and the seed settle
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `scrollbar-${PHASE}-${name}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
}

/** The element of `root` that scrolls vertically (the sheet paper, the dialog content). */
async function scrollerBox(page: Page, selector: string) {
  return page.locator(selector).last().evaluate((node) => {
    const el = [node, ...node.querySelectorAll('*')].find(
      (e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible',
    );
    if (!el) return null;
    el.scrollTo({ top: el.scrollHeight / 3 });
    const r = el.getBoundingClientRect();
    return { right: r.right, top: r.top, height: r.height };
  });
}

test('themed scrollbars in sheets, dialogs and long pages', async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    const context = await contextFor(browser, viewport);
    const page = await context.newPage();
    for (const scheme of SCHEMES) {
      const tag = `${viewport.name}-${scheme}`;
      // Today: "Add event" opens the More sheet (on a past day it opens the event sheet).
      await open(page, `/dev/day?state=moretypes&offset=0&scheme=${scheme}`);
      await page
        .getByRole('button', { name: /^Add event$/ })
        .first()
        .click();
      await page.waitForTimeout(700);
      await shoot(page, `more-${tag}`);
      const box = await scrollerBox(page, '[role="dialog"]');
      await page.waitForTimeout(300);
      await shoot(page, `more-scrolled-${tag}`);
      if (box) {
        await page.mouse.move(box.right - 4, box.top + box.height / 2);
        await page.waitForTimeout(300);
        await shoot(page, `more-hover-${tag}`);
      }
      const search = page.getByRole('searchbox', { name: 'Search' });
      if (await search.count()) {
        await search.fill('ba');
        await page.waitForTimeout(300);
        await shoot(page, `more-search-${tag}`);
      }

      await open(page, `/dev/day?state=moretypes&offset=1&scheme=${scheme}`);
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      await shoot(page, `day-${tag}`);

      await open(page, `/dev/sheet?state=temperature&scheme=${scheme}`);
      await scrollerBox(page, '[role="dialog"]');
      await page.waitForTimeout(300);
      await shoot(page, `dialog-${tag}`);
    }
    await context.close();
  }
});
