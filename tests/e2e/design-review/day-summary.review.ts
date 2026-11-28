import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The Insights page with its new tab bar and the Day tab (`/dev/day-summary`, synthetic data):
 * at 360 px in Portuguese and English, light and dark, plus 320 px with text at 160 %. Full-page
 * shots of the Day tab (today and yesterday) and of the unchanged Insights tab. Logs, per shot,
 * any text that overflows its box and whether the page scrolls sideways.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES: Record<string, RegExp> = {
  light: /^(Light|Claro)$/,
  dark: /^(Dark|Escuro)$/,
  night: /^(Night|Noite)$/,
};
const SHOTS_TO_TAKE = [
  { width: 360, scheme: 'light', percent: 100 },
  { width: 360, scheme: 'dark', percent: 100 },
  { width: 360, scheme: 'night', percent: 100 },
  { width: 320, scheme: 'light', percent: 160 },
];

async function report(page: Page, label: string) {
  const result = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    overflow: [...document.querySelectorAll('main p, main h1, main h2, main h3, main button')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent),
  }));
  console.log(label, JSON.stringify(result));
}

async function shoot(page: Page, stem: string) {
  // The bottom navigation is fixed: hidden so the full-page shot shows every card.
  await page.evaluate(() => {
    document.querySelectorAll('nav').forEach((nav) => {
      let el: HTMLElement | null = nav as HTMLElement;
      while (el && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
      if (el) el.style.display = 'none';
    });
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
  await report(page, stem);
  await page.screenshot({
    path: path.join(SHOTS, `${stem}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

for (const locale of ['pt-BR', 'en']) {
  test(`Day summary ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      locale: locale === 'en' ? 'en-US' : 'pt-BR',
      // The preview follows the real clock: DAY_SUMMARY_TZ picks a zone where it is daytime.
      timezoneId: process.env.DAY_SUMMARY_TZ ?? 'America/Sao_Paulo',
    });
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem('baby-routine.locale', value);
      } catch {
        /* ignore */
      }
    }, locale);
    const page = await context.newPage();
    for (const { width, scheme, percent } of SHOTS_TO_TAKE) {
      if (locale === 'en' && (scheme === 'night' || percent !== 100)) continue;
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/dev/day-summary?state=rich');
      await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
      await page.locator('h1').first().waitFor({ state: 'attached' });
      await page.waitForTimeout(800);
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = `${value}%`;
        const bar = document.querySelector('select[aria-label="Scenario"]')?.parentElement;
        if (bar instanceof HTMLElement) bar.style.display = 'none';
      }, percent);
      const suffix = `${locale}-w${width}-${scheme}-t${percent}`;
      await shoot(page, `day-summary-insights-${suffix}`);
      await page.getByRole('tab').nth(1).click();
      await page.getByRole('group').first().waitFor();
      await page.waitForTimeout(400);
      await shoot(page, `day-summary-today-${suffix}`);
      if (scheme === 'light' && percent === 100) {
        await page.getByRole('group').first().getByRole('button').first().click();
        await page.waitForTimeout(400);
        await shoot(page, `day-summary-yesterday-${suffix}`);
      }
    }
    await context.close();
  });
}
