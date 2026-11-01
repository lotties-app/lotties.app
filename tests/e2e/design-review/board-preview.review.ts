import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the project board (`/dev/board`): the Topics view, the other views, the filter row,
 * the item drawer (full screen on a phone, beside the list on a computer), the full add form, the
 * API keys and topics settings with a new key's one-time secret, and the reader, empty and
 * no-access states. A phone of 390 px and a computer of 1280 px, light, dark and night, English and
 * Portuguese. Credential-free (see board-preview.config.ts).
 *
 * Narrow it with BOARD_WIDTHS=390 BOARD_SCHEMES=dark BOARD_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [390, 1280] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const TASK = '11111111-0000-4000-8000-000000000001';

const pick = <T extends string | number>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(String(value))) : [...all];

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
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1200); // fonts, the fake API and the theme settle
}

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(SHOTS, `board-${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

const heightFor = (width: number) => (width >= 1000 ? 900 : 844);

test('Board list and drawer by width, scheme and language', async ({ browser }) => {
  for (const locale of pick(process.env.BOARD_LOCALES, LOCALES)) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of pick(process.env.BOARD_WIDTHS, WIDTHS)) {
      await page.setViewportSize({ width, height: heightFor(width) });
      for (const scheme of pick(process.env.BOARD_SCHEMES, SCHEMES)) {
        const tag = `${width}-${scheme}-${locale}`;
        await open(page, `/dev/board?state=admin&scheme=${scheme}`);
        await shoot(page, `topics-${tag}`);
        await open(page, `/dev/board/${TASK}?state=admin&scheme=${scheme}`);
        // The phone drawer is a fixed full-screen dialog: a viewport shot, as on the computer.
        await shoot(page, `drawer-${tag}`, false);
      }
    }
  }
});

test('Views, filters, forms and states', async ({ browser }) => {
  const schemes = pick(process.env.BOARD_SCHEMES, ['light', 'dark'] as const);
  for (const locale of pick(process.env.BOARD_LOCALES, LOCALES)) {
    const page = await (await contextFor(browser, locale)).newPage();
    for (const width of pick(process.env.BOARD_WIDTHS, WIDTHS)) {
      await page.setViewportSize({ width, height: heightFor(width) });
      for (const scheme of schemes) {
        const tag = `${width}-${scheme}-${locale}`;
        for (const view of ['mine', 'assistant', 'decisions', 'gaps', 'notes']) {
          await open(page, `/dev/board?state=admin&view=${view}&scheme=${scheme}`);
          await shoot(page, `view-${view}-${tag}`);
        }
        await open(page, `/dev/board?state=admin&status=blocked,open&scheme=${scheme}`);
        await page.getByRole('button', { name: /^(Filters|Filtros)/ }).click();
        await page.waitForTimeout(400);
        await shoot(page, `filters-${tag}`);

        await open(page, `/dev/board?state=admin&scheme=${scheme}`);
        await page.locator('#board-quick-add').fill(locale === 'en' ? 'Release checklist' : 'Lista de lançamento');
        await page.getByRole('button', { name: /^(More fields|Mais campos)$/ }).click();
        await page.waitForTimeout(500);
        await shoot(page, `create-${tag}`, false);

        await open(page, `/dev/board?state=admin&panel=keys&scheme=${scheme}`);
        await shoot(page, `keys-${tag}`, false);
        await page.getByRole('dialog').getByRole('textbox').first().fill('Claude Code (laptop)');
        await page.getByRole('button', { name: /^(Create key|Criar chave)$/ }).click();
        await page.waitForTimeout(500);
        await shoot(page, `secret-${tag}`, false);
        await page.getByRole('button', { name: /^(Done, I stored it|Pronto, guardei)$/ }).click();
        await page.waitForTimeout(300);
        // The dialog's content scrolls: its end holds "How to use a key".
        await page
          .locator('.MuiDialogContent-root')
          .evaluate((node) => node.scrollTo(0, node.scrollHeight));
        await page.waitForTimeout(200);
        await shoot(page, `keys-howto-${tag}`, false);

        await open(page, `/dev/board?state=admin&panel=topics&scheme=${scheme}`);
        await shoot(page, `topics-admin-${tag}`, false);

        for (const state of ['reader', 'empty', 'none']) {
          await open(page, `/dev/board?state=${state}&scheme=${scheme}`);
          await shoot(page, `${state}-${tag}`);
        }
      }
    }
  }
});

test('Board with large text', async ({ browser }) => {
  for (const locale of pick(process.env.BOARD_LOCALES, LOCALES)) {
    const page = await (await contextFor(browser, locale)).newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `/dev/board?state=admin&scheme=light`);
    await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
    await page.waitForTimeout(400);
    await shoot(page, `large-text-390-${locale}`);
  }
});
