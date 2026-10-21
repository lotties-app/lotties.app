import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, navTo, newReviewContext, openShell, readState, shot, startKeeper, stopKeeper, type Combo } from './lib';

test.beforeAll(async ({ browser }) => startKeeper(browser));
test.afterAll(async () => stopKeeper());

const combo: Combo = { viewport: 'mobile', theme: 'dark', locale: 'en' };

/** Rendered text smaller than 12px (DESIGN.md: never below 12px), SVG text measured after scaling. */
async function smallText(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = (walker.currentNode.textContent ?? '').trim();
      const el = walker.currentNode.parentElement;
      if (!text || !el || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let px = parseFloat(getComputedStyle(el).fontSize);
      const svg = el.closest('svg');
      if (svg && el instanceof SVGElement) {
        const vb = svg.viewBox.baseVal;
        if (vb && vb.width) px = px * (svg.getBoundingClientRect().width / vb.width);
      }
      if (px < 11.95) out[`${px.toFixed(1)}px`] = (out[`${px.toFixed(1)}px`] ? out[`${px.toFixed(1)}px`] + ' | ' : '') + text.slice(0, 24);
    }
    return out;
  });
}

/** Tabs through the page; reports focused elements hidden behind the fixed bottom navigation. */
async function focusObscured(page: Page, tabs: number) {
  const hits: unknown[] = [];
  await page.mouse.click(2, 200);
  for (let i = 0; i < tabs; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const nav = document.querySelector('nav');
      if (!el || !nav || nav.contains(el)) return null;
      const r = el.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      const fab = document.querySelector('nav button[aria-haspopup="dialog"]')?.getBoundingClientRect();
      const top = Math.min(n.top, fab?.top ?? n.top);
      const hidden = Math.max(0, Math.min(r.bottom, window.innerHeight) - top);
      return hidden > 0
        ? { name: (el.getAttribute('aria-label') || el.innerText).trim().slice(0, 30), hiddenPx: Math.round(hidden), height: Math.round(r.height) }
        : null;
    });
    if (info) hits.push(info);
  }
  return hits;
}

test('extra measurements (mobile dark en)', async ({ browser }) => {
  const { babyId } = readState();
  const context = await newReviewContext(browser, combo, { babyId });
  const page = await context.newPage();
  await openShell(page, combo);
  await expect(page.getByRole('button', { name: 'Log Diaper' })).toBeVisible();
  await page.waitForTimeout(2000);
  const results: Record<string, unknown> = {};
  results.smallTextHome = await smallText(page);
  results.focusObscuredHome = await focusObscured(page, 22);
  await shot(page, combo, 'focus-obscured-home', { noAxe: true });
  await navTo(page, '/timeline');
  await page.waitForTimeout(1200);
  results.smallTextTimeline = await smallText(page);
  results.focusObscuredTimeline = await focusObscured(page, 20);
  await shot(page, combo, 'focus-obscured-timeline', { noAxe: true });
  await navTo(page, '/growth');
  await page.waitForTimeout(1500);
  results.smallTextGrowth = await smallText(page);
  await navTo(page, '/settings');
  await page.waitForTimeout(800);
  results.smallTextSettings = await smallText(page);
  // Accessible names of the sheets (Drawer on phones).
  await navTo(page, '/');
  await page.getByRole('button', { name: 'Log Diaper' }).click();
  results.sheetDialogName = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? { label: d.getAttribute('aria-label'), labelledby: d.getAttribute('aria-labelledby') } : null;
  });
  fs.writeFileSync(path.join(OUT_DIR, 'extra.json'), JSON.stringify(results, null, 2));
  await context.close();
});
