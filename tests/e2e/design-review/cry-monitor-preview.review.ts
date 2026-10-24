import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the cry monitor page (`/dev/cry-monitor`) in every state (intro, consent, loading,
 * listening, denied, lost, stalled, unsupported) at 320 and 390 px, light, dark and night, English
 * and Portuguese, runs axe (WCAG 2.x A/AA, contrast included) on each and fails on any violation or
 * horizontal scroll. Credential-free (see cry-monitor-preview.config.ts).
 *
 * Narrow it with CRY_WIDTHS=390 CRY_SCHEMES=night CRY_LOCALES=en CRY_STATES=listening.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [320, 390] as const;
const SCHEMES = ['light', 'dark', 'night'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const STATES = [
  'intro',
  'consent',
  'loading',
  'listening',
  'denied',
  'lost',
  'stalled',
  'unsupported',
] as const;

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

const READY: Record<(typeof STATES)[number], string> = {
  intro: 'main button >> nth=1',
  consent: 'input[type="checkbox"]',
  loading: '[aria-busy="true"]',
  listening: '[data-testid="cry-listening"]',
  denied: '[data-testid="failure-denied"]',
  lost: '[data-testid="failure-lost"]',
  stalled: '[data-testid="failure-stalled"]',
  unsupported: '[data-testid="failure-unsupported"]',
};

async function open(page: Page, state: (typeof STATES)[number], scheme: string): Promise<void> {
  await page.goto(`/dev/cry-monitor?state=${state}&scheme=${scheme}`);
  await page.locator(READY[state]).first().waitFor({ state: 'attached' });
  await page.waitForTimeout(900); // fonts, live queries and the scheme settle
}

test('cry monitor by state, width, scheme and language, with axe', async ({ browser }) => {
  const widths = pick(process.env.CRY_WIDTHS, WIDTHS);
  const schemes = pick(process.env.CRY_SCHEMES, SCHEMES);
  const locales = pick(process.env.CRY_LOCALES, LOCALES);
  const states = pick(process.env.CRY_STATES, STATES);
  const problems: string[] = [];
  for (const locale of locales) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const scheme of schemes) {
        for (const state of states) {
          await open(page, state, scheme);
          const name = `cry-monitor-${state}-${width}-${scheme}-${locale}`;
          await page.screenshot({
            path: path.join(SHOTS, `${name}.png`),
            fullPage: state !== 'listening',
            animations: 'disabled',
            caret: 'hide',
          });
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (overflow > 1) problems.push(`${name}: horizontal scroll ${overflow}px`);
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            // The developer toolbar under the page is not part of the app.
            .exclude('main > div:last-child')
            .analyze();
          for (const violation of axe.violations) {
            problems.push(
              `${name}: ${violation.id} (${violation.nodes.length}) ${violation.nodes[0]?.target.join(' ')}`,
            );
          }
        }
      }
    }
    await context.close();
  }
  console.log(problems.length === 0 ? 'cry monitor: no axe violation' : problems.join('\n'));
  expect(problems).toEqual([]);
});
