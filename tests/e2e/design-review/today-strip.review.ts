import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The Today strip of Now (stat tiles): element shots at 320, 390, 430 and 1280 px, light and dark,
 * English and Portuguese, text at 100 and 160 %. Logs, per shot, the tile heights, values that
 * overflow their box and the value heights (one line each).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [320, 390, 430, 1280];
const SCHEMES: Record<string, RegExp> = {
  light: /^(Light|Claro)$/,
  dark: /^(Dark|Escuro)$/,
};

for (const locale of ['en', 'pt-BR']) {
  test(`Today strip ${locale}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
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
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const scheme of Object.keys(SCHEMES)) {
        for (const percent of [100, 160]) {
          await page.goto('/dev/now?state=awake');
          await page.getByRole('radio', { name: SCHEMES[scheme] }).click();
          await page.locator('h1').first().waitFor({ state: 'attached' });
          await page.waitForTimeout(800);
          await page.evaluate((value) => {
            document.documentElement.style.fontSize = `${value}%`;
          }, percent);
          await page.waitForTimeout(250);
          const strip = page.locator('section:has(dl)').filter({ hasText: /^(Today|Hoje)/ }).first();
          // The preview has no night sleep: add a "Last night" tile by cloning the naps tile, with
          // the longest realistic value, so the shot shows all four tiles.
          await strip.evaluate((el, label) => {
            const dl = el.querySelector('dl');
            const first = dl?.firstElementChild;
            if (!dl || !first || el.textContent?.includes(label)) return;
            const tile = first.cloneNode(true) as HTMLElement;
            const dds = tile.querySelectorAll('dd');
            tile.querySelector('dt')!.textContent = label;
            dds[0].textContent = label.startsWith('L') ? '9h 36m' : '9h 36min';
            dds[1]?.remove();
            const spacer = document.createElement('div');
            spacer.style.minHeight = '1.3em';
            tile.append(spacer);
            dl.prepend(tile);
          }, locale === 'en' ? 'Last night' : 'Última noite');
          await strip.scrollIntoViewIfNeeded();
          const report = await strip.evaluate((el) => {
            const tiles = [...el.querySelectorAll('dl > div')];
            const values = [...el.querySelectorAll('dd')].filter((d) => d.textContent);
            return {
              tiles: tiles.map((d) => Math.round(d.getBoundingClientRect().height)),
              overflow: values
                .filter((d) => d.scrollWidth > d.clientWidth + 1)
                .map((d) => d.textContent),
              lines: values.map((d) => Math.round(d.getBoundingClientRect().height)),
              text: tiles.map((d) => d.textContent),
            };
          });
          console.log(locale, width, scheme, percent, JSON.stringify(report));
          await strip.screenshot({
            path: path.join(SHOTS, `today-strip-${locale}-w${width}-${scheme}-t${percent}.png`),
            animations: 'disabled',
          });
        }
      }
    }
    await context.close();
  });
}
