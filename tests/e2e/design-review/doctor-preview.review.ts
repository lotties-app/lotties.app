import { test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the doctor access screens (`/dev/doctor`): the professional profile, the Doctor invite
 * form, members with the doctor and the access log, the invite picker with Doctor and its consent
 * line, Patients, the doctor's notes and the composer, the family's notes and "Recorded by Dr." on
 * Growth, in light and dark, English and Portuguese, on a phone (390x844). Credential-free (see
 * doctor-preview.config.ts).
 *
 * Narrow it with DOCTOR_SCHEMES=dark DOCTOR_LOCALES=en.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SCHEMES = ['light', 'dark'] as const;
const LOCALES = ['en', 'pt-BR'] as const;
const PAGES = ['profile', 'accept', 'members', 'patients', 'notes', 'family', 'growth'] as const;

const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

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

async function open(page: Page, state: string, scheme: string): Promise<void> {
  await page.goto(`/dev/doctor?state=${state}&scheme=${scheme}`);
  await page.locator('h1').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1500); // fonts, live queries and the seed settle
}

const file = (name: string) => path.join(SHOTS, `${name}.png`);

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: file(name), fullPage, animations: 'disabled', caret: 'hide' });
}

const en = (locale: string) => locale === 'en';

test('Doctor access pages', async ({ browser }) => {
  for (const locale of pick(process.env.DOCTOR_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.DOCTOR_SCHEMES, SCHEMES)) {
      for (const state of PAGES) {
        await open(page, state, scheme);
        await shoot(page, `doctor-${state}-${scheme}-${locale}`);
      }
    }
    await context.close();
  }
});

test('The composer and the Doctor invite picker', async ({ browser }) => {
  for (const locale of pick(process.env.DOCTOR_LOCALES, LOCALES)) {
    const context = await contextFor(browser, locale);
    const page = await context.newPage();
    for (const scheme of pick(process.env.DOCTOR_SCHEMES, SCHEMES)) {
      const tag = `${scheme}-${locale}`;
      await open(page, 'composer', scheme);
      await shoot(page, `doctor-composer-${tag}`, false);

      await open(page, 'members', scheme);
      await page.getByRole('combobox', { name: en(locale) ? 'Invite role' : 'Papel do convite' }).click();
      await page.waitForTimeout(300);
      await shoot(page, `doctor-invite-picker-${tag}`, false);
      await page.getByRole('option', { name: en(locale) ? /^Doctor/ : /^Médico/ }).click();
      await page.waitForTimeout(300);
      const consent = page.getByText(en(locale) ? /The doctor who accepts/ : /O\(a\) médico\(a\) que aceitar/);
      await consent.scrollIntoViewIfNeeded();
      await shoot(page, `doctor-invite-consent-${tag}`, false);
    }
    await context.close();
  }
});
