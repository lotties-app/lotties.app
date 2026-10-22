import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the Day screen (`/dev/day`) and the event sheet (`/dev/sheet`): light, dark and night
 * schemes, English and Portuguese, a phone (390x844) and a desktop window (1280x800), plus the
 * filter sheet, the date sheet, the type menu, validation errors and the discard bar. Credential-
 * free (see day-preview.config.ts).
 *
 * Narrow it with DAY_VIEWPORTS=mobile DAY_SCHEMES=dark DAY_LOCALES=en DAY_ONLY=day|sheet.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } } as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const SHEET_STATES = [
  'bottle',
  'breast',
  'solid',
  'diaper',
  'sleep',
  'medication',
  'belly',
  'edit',
  'running',
  'finish',
  'bottlestop',
];

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

async function contextFor(browser: import('@playwright/test').Browser, locale: string) {
  const context = await browser.newContext({
    viewport: VIEWPORTS.mobile,
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
    path: path.join(SHOTS, `${name}.png`),
    fullPage,
    animations: 'disabled',
    caret: 'hide',
  });
}

test('Day in every scenario, scheme, language and viewport', async ({ browser }) => {
  if (process.env.DAY_ONLY === 'sheet') return;
  const viewports = pick(process.env.DAY_VIEWPORTS, Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]);
  const schemes = pick(process.env.DAY_SCHEMES, SCHEMES);
  const locales = pick(process.env.DAY_LOCALES, LOCALES);
  const views: [string, string][] = [
    ['yesterday', 'state=full&offset=1'],
    ['today', 'state=full&offset=0'],
    ['empty', 'state=empty&offset=0'],
    ['viewer', 'state=viewer&offset=1'],
  ];
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const viewport of viewports) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const scheme of schemes) {
        for (const [name, query] of views) {
          await open(page, `/dev/day?${query}&scheme=${scheme}`);
          await shoot(page, `day-${name}-${viewport}-${scheme}-${locale}`);
        }
      }
    }
    await context.close();
  }
});

test('Day sheets: filter, date, add', async ({ browser }) => {
  if (process.env.DAY_ONLY === 'sheet') return;
  const schemes = pick(process.env.DAY_SCHEMES, ['light', 'dark'] as const);
  const locales = pick(process.env.DAY_LOCALES, LOCALES);
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of schemes) {
      const tag = `mobile-${scheme}-${locale}`;
      await open(page, `/dev/day?state=full&offset=1&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Filter|Filtrar)/ }).click();
      await page.waitForTimeout(500);
      await page.getByRole('checkbox').nth(1).click();
      await shoot(page, `day-filter-${tag}`, false);
      await page.getByRole('button', { name: /^(Done|Pronto)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `day-filtered-${tag}`);

      await open(page, `/dev/day?state=full&offset=1&scheme=${scheme}`);
      await page.getByRole('button', { name: /(Choose a date|Escolher uma data)/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `day-date-${tag}`, false);

      await open(page, `/dev/day?state=empty&offset=0&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Add event|Adicionar evento)$/ }).first().click();
      await page.waitForTimeout(500);
      await shoot(page, `day-add-${tag}`, false);

      await open(page, `/dev/day?state=full&offset=0&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Edit|Editar) / }).first().click();
      await page.waitForTimeout(600);
      await shoot(page, `day-edit-${tag}`, false);
    }
    await context.close();
  }
});

test('Event sheet in every scenario, scheme, language and viewport', async ({ browser }) => {
  if (process.env.DAY_ONLY === 'day') return;
  const viewports = pick(process.env.DAY_VIEWPORTS, Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]);
  const schemes = pick(process.env.DAY_SCHEMES, SCHEMES);
  const locales = pick(process.env.DAY_LOCALES, LOCALES);
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const viewport of viewports) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const scheme of schemes) {
        // The full matrix on the phone; the desktop dialog only in two scenarios.
        const states = viewport === 'mobile' ? SHEET_STATES : ['bottle', 'edit'];
        for (const state of states) {
          await open(page, `/dev/sheet?state=${state}&scheme=${scheme}`);
          await shoot(page, `sheet-${state}-${viewport}-${scheme}-${locale}`, false);
        }
      }
    }
    await context.close();
  }
});

test('Event sheet interactions: breast, errors, switching, discard', async ({ browser }) => {
  if (process.env.DAY_ONLY === 'day') return;
  const schemes = pick(process.env.DAY_SCHEMES, ['light', 'dark'] as const);
  const locales = pick(process.env.DAY_LOCALES, LOCALES);
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of schemes) {
      const tag = `mobile-${scheme}-${locale}`;

      await open(page, `/dev/sheet?state=breast&scheme=${scheme}`);
      const body = page.locator('[role="dialog"] >> nth=0');
      await body.evaluate((el) => el.querySelector('[data-field-key="method"]')?.scrollIntoView());
      await shoot(page, `sheet-breast-fields-${tag}`, false);

      await open(page, `/dev/sheet?state=diaper&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Save|Salvar)$/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `sheet-errors-${tag}`, false);

      await open(page, `/dev/sheet?state=bottle&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Feeding|Alimentação)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `sheet-typemenu-${tag}`, false);
      await page.getByRole('menuitem', { name: /^(Diaper|Fralda)$/ }).click();
      await page.waitForTimeout(500);
      await shoot(page, `sheet-switched-${tag}`, false);

      await open(page, `/dev/sheet?state=bottle&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(Now|Agora)$/ }).first().click();
      await page.getByRole('button', { name: /^(5 min|há 5 min)/i }).first().click();
      await page.getByRole('button', { name: /^(Close|Fechar)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `sheet-discard-${tag}`, false);

      await open(page, `/dev/sheet?state=edit&scheme=${scheme}`);
      await page.getByRole('button', { name: /^(More actions|Mais ações)$/ }).click();
      await page.waitForTimeout(400);
      await shoot(page, `sheet-overflow-${tag}`, false);
      await page.getByRole('menuitem', { name: /^(Delete|Excluir)$/ }).click();
      await page.waitForTimeout(700);
      await shoot(page, `sheet-deleted-${tag}`, false);
    }
    await context.close();
  }
});
