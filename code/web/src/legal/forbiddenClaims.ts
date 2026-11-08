import type { Locale } from '../i18n/config';

/*
 * Claims Lotties must never make about who can read people's data (docs/design/47-bring-your-own-database.md
 * section 10, "What Lotties must NOT say or imply"). The Lotties server reads and writes every record it
 * serves, a baby's own database included, and the operator holds the key that opens its connection details:
 * nothing in Lotties is end-to-end encrypted or hidden from the operator. A text that says otherwise is false.
 *
 * Used by forbiddenClaims.test.ts on the legal texts (privacy policy, terms, the own-database consent) and
 * meant to be reused by the tests of any other user-facing text about privacy (the own-database screens, the
 * landing page): `findForbiddenClaims(text, locale)` returns what it found, empty when the text is clean.
 */

/** Phrases that claim more than the code does, per language (case-insensitive). */
export const FORBIDDEN_CLAIMS: Readonly<Record<Locale, readonly RegExp[]>> = {
  en: [
    /end[- ]to[- ]end/i,
    /zero[- ]knowledge/i,
    /operator[- ]blind/i,
    /only you (can|could|will be able to) (read|see|access|open)/i,
    /no one (but|except) you (can|could) (read|see|access)/i,
    /(lotties|we|our servers?|the operator) (cannot|can ?not|can't|never) (see|read|access|open)/i,
    /(lotties|we) (has|have) no access/i,
    /never (touch(es)?|pass(es)? through|reach(es)?) (our|lotties'?s?) servers?/i,
    /we (do not|don't|never) store your (data|records)/i,
    /(your )?credentials are safe from us/i,
    /hidden from (us|lotties|the operator)/i,
  ],
  'pt-BR': [
    /ponta[- ]a[- ]ponta/i,
    /conhecimento zero/i,
    /zero[- ]knowledge/i,
    /(só|somente|apenas) você (pode|consegue|poderá|vai poder) (ler|ver|acessar|abrir)/i,
    /ninguém além de você/i,
    /(o lotties|nós|nossos servidores|o operador) (não|nunca) (pode|podemos|consegue|conseguimos|podem|conseguem) (ver|ler|acessar|abrir)/i,
    /não (podemos|conseguimos) (ver|ler|acessar|abrir) (os )?seus/i,
    /(o lotties|nós) não (tem|temos) acesso/i,
    /nunca (passa|passam|chega|chegam) (pelos|aos) nossos servidores/i,
    /não (guardamos|armazenamos) (os )?seus (dados|registros)/i,
    /(suas )?credenciais (estão )?protegidas de nós/i,
    /escondid[oa]s? (de nós|do lotties|do operador)/i,
  ],
};

/**
 * Honest negations the texts must be able to say ("this is not end-to-end encryption"); they are removed
 * before the scan, so only a positive claim is caught.
 */
export const ALLOWED_NEGATIONS: Readonly<Record<Locale, readonly RegExp[]>> = {
  en: [
    /\b(is|are) not end[- ]to[- ]end encrypt(ion|ed)\b/gi,
    /\bnot end[- ]to[- ]end encrypt(ion|ed)\b/gi,
  ],
  'pt-BR': [
    /\bnão (é|são) criptografi(a|ados?|adas?) de ponta[- ]a[- ]ponta\b/gi,
    /\bnão (é|são) criptografad[oa]s? de ponta[- ]a[- ]ponta\b/gi,
  ],
};

/** The forbidden claims found in `text` (each as the matched words); empty when there are none. */
export function findForbiddenClaims(text: string, locale: Locale): string[] {
  const cleaned = ALLOWED_NEGATIONS[locale].reduce(
    (current, negation) => current.replace(negation, ' '),
    text,
  );
  return FORBIDDEN_CLAIMS[locale].flatMap((claim) => {
    const match = cleaned.match(claim);
    return match ? [match[0]] : [];
  });
}
