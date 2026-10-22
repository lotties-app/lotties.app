import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the Day rows of the eight built-in types of the `MoreEventTypes` migration, the Add
 * sheet tiles, and the event sheets of temperature, teething and milestone, in the light and dark
 * schemes, English and Portuguese, on a phone (390x844). Credential-free (see
 * more-types-preview.config.ts).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const SHEETS = ['temperature', 'teething', 'milestone'] as const;

async function contextFor(browser: Browser, locale: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
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
  return context;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('main, [role="dialog"], h1, h2, p').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(900); // fonts, live queries and the seed settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `more-types-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Day rows, Add sheet and event sheets of the more event types', async ({ browser }) => {
  for (const locale of LOCALES) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of SCHEMES) {
      const tag = `mobile-${scheme}-${locale}`;
      await open(page, `/dev/day?state=moretypes&offset=1&scheme=${scheme}`);
      await shoot(page, `day-${tag}`);

      await page
        .getByRole('button', { name: /^(Add event|Adicionar evento)$/ })
        .first()
        .click();
      await page.waitForTimeout(600);
      await shoot(page, `add-${tag}`, false);
      const dialog = page.getByRole('dialog').last();
      await dialog.evaluate((node) => {
        const scroller = [node, ...node.querySelectorAll('*')].find(
          (el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible',
        );
        scroller?.scrollTo({ top: scroller.scrollHeight });
      });
      await page.waitForTimeout(400);
      await shoot(page, `add-end-${tag}`, false);

      for (const sheet of SHEETS) {
        await open(page, `/dev/sheet?state=${sheet}&scheme=${scheme}`);
        await shoot(page, `sheet-${sheet}-${tag}`, false);
        await shoot(page, `sheet-${sheet}-full-${tag}`);
      }
    }
    await context.close();
  }
});
