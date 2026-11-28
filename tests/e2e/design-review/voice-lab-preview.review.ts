import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the voice lab (`/dev/voice-lab`) at 360 px in English and Portuguese: the start of a run, the
 * listening state, a passed and a failed attempt with its retry, the summary after a few phrases, a
 * phone without on-device recognition, and the key logger. Fails on horizontal page
 * scroll. Credential-free (see voice-lab-preview.config.ts).
 *
 * Narrow it with VOICE_LAB_LOCALES=en VOICE_LAB_SCHEMES=dark.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(here, '..', '..', '..', 'docs', 'design', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const LOCALES = ['en', 'pt-BR'] as const;
const SCHEMES = ['light', 'dark'] as const;
const pick = <T extends string>(env: string | undefined, all: readonly T[]): T[] =>
  env ? all.filter((value) => env.split(',').includes(value)) : [...all];

const TEXT = {
  en: {
    speak: 'Speak',
    next: 'Next',
    retry: 'Retry',
    cancel: 'Cancel',
    keys: 'Key logger',
  },
  'pt-BR': {
    speak: 'Falar',
    next: 'Próxima',
    retry: 'Repetir',
    cancel: 'Cancelar',
    keys: 'Teclas',
  },
} as const;

async function noSideScroll(page: Page, name: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, full = true) {
  await page.waitForTimeout(300);
  await noSideScroll(page, name);
  await page.screenshot({ path: path.join(SHOTS, `voice-lab-${name}.png`), fullPage: full });
}

async function open(page: Page, state: string, scheme: string) {
  await page.goto(`/dev/voice-lab?state=${state}&scheme=${scheme}`);
  await page.getByTestId('voice-lab').waitFor();
  await page.getByTestId('voice-lab-capabilities').getByText(/Android/).waitFor();
  await page.waitForTimeout(600);
}

test('voice lab at 360 px', async ({ browser }) => {
  for (const locale of pick(process.env.VOICE_LAB_LOCALES, LOCALES)) {
    for (const scheme of pick(process.env.VOICE_LAB_SCHEMES, SCHEMES)) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 2,
        locale: locale === 'en' ? 'en-GB' : 'pt-BR',
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
      const t = TEXT[locale];
      const tag = `${locale}-${scheme}`;

      await open(page, 'run', scheme);
      await shot(page, `start-${tag}`);
      await shot(page, `start-top-${tag}`, false);

      // Phrase 1 passes; then 2; phrase 3 is misheard (105 ml), retried, and passes.
      const card = page.getByTestId('voice-lab-phrase');
      await page.getByRole('button', { name: t.speak, exact: true }).click();
      await card.getByTestId('voice-lab-attempt').waitFor();
      await card.scrollIntoViewIfNeeded();
      await shot(page, `pass-${tag}`, false);
      await page.getByRole('button', { name: t.next }).click();
      await page.getByRole('button', { name: t.speak, exact: true }).click();
      await card.getByTestId('voice-lab-attempt').waitFor();
      await page.getByRole('button', { name: t.next }).click();
      await page.getByRole('button', { name: t.speak, exact: true }).click();
      await card.getByTestId('voice-lab-attempt').waitFor();
      await card.scrollIntoViewIfNeeded();
      await shot(page, `fail-${tag}`, false);
      await page.getByRole('button', { name: t.retry }).click();
      await page.waitForTimeout(300);
      await page.getByTestId('voice-lab-summary').scrollIntoViewIfNeeded();
      await shot(page, `summary-${tag}`);

      await page.getByRole('button', { name: t.keys }).click();
      await page.keyboard.press('PageDown');
      await page.keyboard.press('ArrowRight');
      await page.getByTestId('voice-lab-keys').scrollIntoViewIfNeeded();
      await shot(page, `keys-${tag}`, false);

      await open(page, 'hang', scheme);
      await page.getByRole('button', { name: t.speak, exact: true }).click();
      await page.getByTestId('voice-lab-listening').waitFor();
      await page.getByTestId('voice-lab-phrase').scrollIntoViewIfNeeded();
      await shot(page, `listening-${tag}`, false);
      await page.getByRole('button', { name: t.cancel }).first().click();

      await open(page, 'no-device', scheme);
      await page.getByRole('button', { name: t.speak, exact: true }).click();
      await page.getByRole('alert').first().waitFor();
      await shot(page, `no-device-${tag}`);

      await context.close();
    }
  }
});
