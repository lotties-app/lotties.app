import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../i18n/config';
import { BYO_DATABASE_CONSENT } from './byoDatabaseConsent';
import { FORBIDDEN_CLAIMS, findForbiddenClaims } from './forbiddenClaims';
import { POLICY_DOCUMENTS } from './policyDocuments';
import { termsEn } from './terms.en';
import { termsPtBR } from './terms.pt-BR';

/*
 * No legal text claims more than the code does about who can read people's data
 * (docs/design/47-bring-your-own-database.md section 10). The scan is shared: any test of a user-facing
 * text about privacy can call findForbiddenClaims(text, locale).
 */

const locales = LOCALES.map((locale) => locale.code) as Locale[];

const TERMS: Readonly<Record<Locale, unknown>> = { en: termsEn, 'pt-BR': termsPtBR };

/** Claims each pattern must catch, per language. */
const CAUGHT: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    'Your records are end-to-end encrypted.',
    'We use end to end encryption.',
    'A zero-knowledge design.',
    'Only you can read your data.',
    'No one but you can see it.',
    'Lotties cannot see your records.',
    "We can't read your database.",
    'Lotties has no access to it.',
    'Your data never touches our servers.',
    'We do not store your data.',
    'Your credentials are safe from us.',
    'Hidden from the operator.',
    'An operator-blind store.',
  ],
  'pt-BR': [
    'Seus registros têm criptografia de ponta a ponta.',
    'Só você pode ler os seus dados.',
    'Somente você consegue ver.',
    'Ninguém além de você vê.',
    'O Lotties não consegue ler os seus registros.',
    'Não podemos ver os seus dados.',
    'O Lotties não tem acesso a eles.',
    'Seus dados nunca passam pelos nossos servidores.',
    'Não guardamos seus dados.',
    'Suas credenciais estão protegidas de nós.',
    'Um projeto de conhecimento zero.',
  ],
};

/** Honest sentences the texts need, which must not be caught. */
const ALLOWED: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    'This is not end-to-end encryption.',
    'The Lotties servers can read them while they do so.',
    'Only your device can read the content of a reminder.',
    'We cannot delete them for you.',
  ],
  'pt-BR': [
    'Isto não é criptografia de ponta a ponta.',
    'Os servidores do Lotties conseguem lê-los nesse momento.',
    'Não conseguimos apagá-los por você.',
  ],
};

describe('forbidden privacy claims', () => {
  it.each(locales)('has patterns for %s', (locale) => {
    expect(FORBIDDEN_CLAIMS[locale].length).toBeGreaterThan(5);
  });

  it.each(locales.flatMap((locale) => CAUGHT[locale].map((text) => [locale, text] as const)))(
    'catches the %s claim "%s"',
    (locale, text) => {
      expect(findForbiddenClaims(text, locale)).not.toEqual([]);
    },
  );

  it.each(locales.flatMap((locale) => ALLOWED[locale].map((text) => [locale, text] as const)))(
    'lets the %s sentence "%s" pass',
    (locale, text) => {
      expect(findForbiddenClaims(text, locale)).toEqual([]);
    },
  );

  it.each(locales)('finds none in the %s privacy policy', (locale) => {
    expect(findForbiddenClaims(JSON.stringify(POLICY_DOCUMENTS[locale]), locale)).toEqual([]);
  });

  it.each(locales)('finds none in the %s terms of use', (locale) => {
    expect(findForbiddenClaims(JSON.stringify(TERMS[locale]), locale)).toEqual([]);
  });

  it.each(locales)('finds none in the %s own-database consent', (locale) => {
    expect(findForbiddenClaims(JSON.stringify(BYO_DATABASE_CONSENT[locale]), locale)).toEqual([]);
  });
});
