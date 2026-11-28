import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Captures the experimental voice test (`/dev/voice-lab`) at 360 px in English and Portuguese: the
 * Settings > Experimental group off, its explainer dialog and the group on; the page on Try it with the
 * technical details folded, a Try it result and the listening state; the guided test (a passed and a
 * failed attempt with its retry, the summary); the technical details with the key logger; a phone
 * without on-device recognition. Fails on horizontal page scroll. Credential-free (see
 * voice-lab-preview.config.ts).
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
    switch: /Hands-free \(voice test\)/,
    turnOn: 'Turn on',
    tapToSpeak: 'Tap to speak',
    guided: 'Guided test',
    speak: 'Speak',
    next: 'Next',
    retry: 'Retry',
    cancel: 'Cancel',
    technical: 'Technical details',
    keys: 'Key logger',
  },
  'pt-BR': {
    switch: /Mãos livres \(teste de voz\)/,
    turnOn: 'Ligar',
    tapToSpeak: 'Tocar para falar',
    guided: 'Teste guiado',
    speak: 'Falar',
    next: 'Próxima',
    retry: 'Repetir',
    cancel: 'Cancelar',
    technical: 'Detalhes técnicos',
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
  await page.screenshot({
    path: path.join(SHOTS, `voice-lab-${name}.png`),
    fullPage: full,
  });
}

async function open(page: Page, state: string, scheme: string) {
  await page.goto(`/dev/voice-lab?state=${state}&scheme=${scheme}`);
  await page.getByTestId('voice-lab').waitFor();
  await page.waitForTimeout(600);
}

test('voice test at 360 px', async ({ browser }) => {
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

      // Settings > Experimental: off, the explainer, on.
      await page.goto(`/dev/voice-lab?state=settings&scheme=${scheme}`);
      await page.getByTestId('voice-test-setting').waitFor();
      await shot(page, `settings-off-${tag}`, false);
      await page.getByRole('switch', { name: t.switch }).click();
      await page.getByRole('dialog').waitFor();
      await shot(page, `optin-dialog-${tag}`, false);
      await page.getByRole('dialog').getByRole('button', { name: t.turnOn }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await shot(page, `settings-on-${tag}`, false);

      // The page: Try it first, technical details folded; a try; the listening state.
      await open(page, 'run', scheme);
      await shot(page, `try-start-${tag}`, false);
      await page.getByRole('button', { name: t.tapToSpeak }).click();
      await page.getByTestId('voice-lab-attempt').waitFor();
      await shot(page, `try-result-${tag}`);

      // The guided test in Portuguese (the scripted replies are the pt-BR phrases).
      await page.getByRole('radio', { name: t.guided }).click();
      await page.getByTestId('voice-lab-guided').getByRole('radio', { name: 'Português' }).click();
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

      // Technical details, opened, with the key logger.
      await page.getByRole('button', { name: t.technical }).click();
      await page
        .getByTestId('voice-lab-capabilities')
        .getByText(/Android/)
        .waitFor();
      await page.getByRole('button', { name: t.keys }).click();
      await page.keyboard.press('PageDown');
      await page.keyboard.press('ArrowRight');
      await page.getByTestId('voice-lab-technical').scrollIntoViewIfNeeded();
      await shot(page, `technical-${tag}`);

      await open(page, 'hang', scheme);
      await page.getByRole('button', { name: t.tapToSpeak }).click();
      await page.getByTestId('voice-lab-listening').waitFor();
      await shot(page, `listening-${tag}`, false);
      await page.getByRole('button', { name: t.cancel }).first().click();

      await open(page, 'no-device', scheme);
      await page.getByRole('alert').first().waitFor();
      await shot(page, `no-device-${tag}`, false);

      await context.close();
    }
  }
});
