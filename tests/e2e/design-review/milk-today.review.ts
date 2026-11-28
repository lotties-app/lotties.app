import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The "Milk today" card on Now (`/dev/now?state=awake`, synthetic data): the first screen at
 * 360 px in Portuguese, light and dark, and at 320 px with text at 160 %, plus a card shot of each.
 * Logs, per shot, whether the card is fully visible without scrolling and any text that overflows.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES: Record<string, RegExp> = {
  light: /^(Light|Claro)$/,
  dark: /^(Dark|Escuro)$/,
};
const SHOTS_TO_TAKE = [
  { width: 360, scheme: 'light', percent: 100 },
  { width: 360, scheme: 'dark', percent: 100 },
  { width: 320, scheme: 'light', percent: 160 },
  { width: 320, scheme: 'dark', percent: 160 },
];

for (const locale of ['pt-BR', 'en']) {
  test(`Milk today ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      locale: locale === 'en' ? 'en-US' : 'pt-BR',
      // The preview follows the real clock: MILK_TODAY_TZ picks a zone where it is daytime.
      timezoneId: process.env.MILK_TODAY_TZ ?? 'America/Sao_Paulo',
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
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/dev/now?state=awake');
      await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
      await page.locator('h1').first().waitFor({ state: 'attached' });
      await page.waitForTimeout(800);
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = `${value}%`;
        const bar = document.querySelector('select[aria-label="Scenario"]')?.parentElement;
        if (bar instanceof HTMLElement) bar.style.display = 'none';
        window.scrollTo(0, 0);
      }, percent);
      await page.waitForTimeout(300);
      const card = page.getByRole('region', {
        name: /^(Milk today|Leite hoje)$/,
      });
      const report = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          visible: box.top >= 0 && box.bottom <= window.innerHeight,
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          overflow: [...el.querySelectorAll('dd, dt, p, h2')]
            .filter((d) => d.scrollWidth > d.clientWidth + 1)
            .map((d) => d.textContent),
          text: el.textContent,
        };
      });
      console.log(locale, width, scheme, percent, JSON.stringify(report));
      // Long values (about 1.5 l, 50 fl oz, a fractional ml total), sized as the card sizes them
      // (`numberSize` in MilkTodayCard.tsx: min(2rem, 100 / (length * 0.62) cqi)): one line each?
      const long = await card.evaluate((el) => {
        const dds = [...el.querySelectorAll('dd')] as HTMLElement[];
        const before = dds.map((d) => [d.textContent, d.style.fontSize] as const);
        const result: Record<string, boolean> = {};
        for (const value of ['50.7 fl oz', '1.480 ml', '1.234,567 ml']) {
          for (const d of dds) {
            d.textContent = value;
            d.style.fontSize = `min(2rem, ${(100 / (value.length * 0.62)).toFixed(1)}cqi)`;
          }
          result[value] = dds.some((d) => d.scrollWidth > d.clientWidth + 1);
        }
        dds.forEach((d, i) => {
          d.textContent = before[i][0];
          d.style.fontSize = before[i][1];
        });
        return result;
      });
      console.log('  long values overflow:', JSON.stringify(long));
      const stem = `milk-today-${locale}-w${width}-${scheme}-t${percent}`;
      await page.screenshot({
        path: path.join(SHOTS, `${stem}.png`),
        animations: 'disabled',
      });
      await card.screenshot({
        path: path.join(SHOTS, `${stem}-card.png`),
        animations: 'disabled',
      });
    }
    await context.close();
  });
}
