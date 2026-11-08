import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../i18n/config';
import {
  BYO_DATABASE_CONSENT,
  BYO_DATABASE_POLICY_HREF,
  byoDatabaseConsentText,
} from './byoDatabaseConsent';
import { OWN_DATABASE_FLOW } from './dataFlows';
import { POLICY_DOCUMENTS } from './policyDocuments';

/* The optional consent `byo_database` states the same facts as the policy (dataFlows.ts OWN_DATABASE_FLOW). */

const locales = LOCALES.map((locale) => locale.code) as Locale[];

const FACTS: Readonly<Record<Locale, Record<string, RegExp>>> = {
  en: {
    sameApp: /exactly as before/,
    where: /Only where this baby's care records are stored changes/,
    postgres: /PostgreSQL database at \{provider\}/,
    through: /through the Lotties servers/,
    serversRead: /can read them/,
    stays: /What stays with Lotties: your account, your consents/,
    cipher: /AES-256-GCM/,
    operator: /people who run them, can open them/,
    notE2E: /This is not end-to-end encryption/,
    chosen: /a company you choose, not one Lotties chooses/,
    region: /country or region you picked/,
    responsible: /You are responsible for that account/,
    pause: /pause/,
    backups: /no backups/,
    notAvailable: /reminders, invited members and doctor access are not available/,
    back: /move the records back/,
  },
  'pt-BR': {
    sameApp: /exatamente como antes/,
    where: /Só muda onde os registros de cuidado deste bebê ficam guardados/,
    postgres: /PostgreSQL em \{provider\}/,
    through: /por meio dos servidores do Lotties/,
    serversRead: /conseguem lê-los/,
    stays: /O que fica com o Lotties: a sua conta, os seus consentimentos/,
    cipher: /AES-256-GCM/,
    operator: /pessoas que os operam, conseguem abri-los/,
    notE2E: /Isto não é criptografia de ponta a ponta/,
    chosen: /uma empresa que você escolhe, não o Lotties/,
    region: /país ou a região que você escolheu/,
    responsible: /Você é responsável por essa conta/,
    pause: /pausar/,
    backups: /não ter backup/,
    notAvailable: /lembretes, membros convidados e o acesso de médicos não estão disponíveis/,
    back: /trazer os registros de volta/,
  },
};

describe('the own-database consent text', () => {
  it('has the same shape in every language', () => {
    const shape = (locale: Locale) => {
      const text = BYO_DATABASE_CONSENT[locale];
      return { keys: Object.keys(text), points: text.points.length };
    };
    for (const locale of locales) expect(shape(locale)).toEqual(shape('en'));
  });

  it.each(locales)('states every fact of the flow in %s', (locale) => {
    const text = JSON.stringify(BYO_DATABASE_CONSENT[locale]);
    for (const [name, pattern] of Object.entries(FACTS[locale]))
      expect(text, name).toMatch(pattern);
    expect(OWN_DATABASE_FLOW.connectionDetails.cipher).toBe('AES-256-GCM');
  });

  it.each(locales)('names the provider in the %s declaration and fills it in', (locale) => {
    expect(BYO_DATABASE_CONSENT[locale].declaration).toContain('{provider}');
    const filled = byoDatabaseConsentText(locale, ' Supabase ');
    expect(JSON.stringify(filled)).not.toContain('{provider}');
    expect(filled.declaration).toContain('Supabase');
    // A blank name still reads as a sentence, capitalised at its start.
    const blank = byoDatabaseConsentText(locale, '  ');
    expect(JSON.stringify(blank)).not.toContain('{provider}');
    for (const point of blank.points) expect(point.charAt(0)).toBe(point.charAt(0).toUpperCase());
  });

  it('links to the policy section that describes it', () => {
    expect(BYO_DATABASE_POLICY_HREF).toBe(`/privacy#privacy-${OWN_DATABASE_FLOW.sectionId}`);
    for (const locale of locales) {
      expect(
        POLICY_DOCUMENTS[locale].sections.some(
          (section) => section.id === OWN_DATABASE_FLOW.sectionId,
        ),
      ).toBe(true);
    }
  });
});
