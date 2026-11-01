import type { BabyRoutineDb } from '../db/database';
import {
  RSV_MATERNAL_CONDITION,
  type ScheduledDose,
  type VaccineDefinition,
  type VaccineSchedule,
} from '../vaccines/vaccineSchedule';

/*
 * A small synthetic vaccine schedule (schema v2) for tests and the developer previews: a handful
 * of vaccines with every behaviour the page has to show (alternatives the sources disagree on, a
 * combined product, a yearly dose, a condition, private-only doses, a dose that expires). Invented
 * for this purpose: it is not the real schedule (code/api/data/vaccine-schedule.br.json).
 */

type DoseInput = Partial<ScheduledDose> & {
  doseId: string;
  vaccineKey: string;
  recommendedAgeDays: number;
  en: string;
  pt: string;
};

function dose({ en, pt, ...input }: DoseInput): ScheduledDose {
  const isPrivate = input.network === 'private';
  return {
    label: { en, 'pt-BR': pt },
    earliestAgeDays: input.recommendedAgeDays,
    latestAgeDays: null,
    minIntervalDaysFromPrevious: null,
    sources: isPrivate ? ['sbp', 'sbim'] : ['pni', 'sbp', 'sbim'],
    network: 'public',
    notes: { en: `Notes of ${input.doseId}.`, 'pt-BR': `Observações de ${input.doseId}.` },
    alternativeGroup: null,
    needsReview: false,
    needsReviewReason: null,
    previousDoseIds: [],
    covers: [],
    recurrence: null,
    condition: null,
    recordOnly: false,
    ...input,
  };
}

function vaccine(
  key: string,
  en: string,
  pt: string,
  protects: [string[], string[]],
  network = 'public',
): VaccineDefinition {
  return {
    key,
    names: { en, 'pt-BR': pt },
    protectsAgainst: { en: protects[0], 'pt-BR': protects[1] },
    network,
  };
}

const FIRST = { en: '1st dose', pt: '1ª dose' };
const SECOND = { en: '2nd dose', pt: '2ª dose' };

export const TEST_SCHEDULE: VaccineSchedule = {
  schemaVersion: 2,
  profile: 'BR',
  generatedOn: '2026-10-22',
  sources: [
    {
      id: 'pni',
      name: 'Ministério da Saúde: Calendário Nacional de Vacinação 2026',
      edition: '2026',
      url: 'https://www.gov.br/saude/pt-br/vacinacao/calendario',
      retrievedOn: '2026-10-22',
      network: 'public',
    },
    {
      id: 'sbp',
      name: 'Sociedade Brasileira de Pediatria: Calendário de Vacinação',
      edition: '2026-27',
      url: 'https://www.sbp.com.br/?p=63971',
      retrievedOn: '2026-10-22',
      network: 'private-recommendation',
    },
    {
      id: 'sbim',
      name: 'Sociedade Brasileira de Imunizações: Calendário de vacinação, criança',
      edition: '2026-27',
      url: 'https://sbim.org.br/calendarios',
      retrievedOn: '2026-10-22',
      network: 'private-recommendation',
    },
  ],
  vaccines: [
    vaccine('bcg', 'BCG', 'BCG', [
      ['severe forms of tuberculosis'],
      ['formas graves de tuberculose'],
    ]),
    vaccine('hepatite-b', 'Hepatitis B', 'Hepatite B', [['hepatitis B'], ['hepatite B']]),
    vaccine(
      'vsr-nirsevimabe',
      'RSV antibody (nirsevimab)',
      'Anticorpo contra o VSR (nirsevimabe)',
      [['severe RSV disease'], ['doença grave pelo VSR']],
      'private',
    ),
    vaccine('penta', 'Pentavalent', 'Pentavalente', [
      ['diphtheria', 'tetanus', 'whooping cough', 'Hib', 'hepatitis B'],
      ['difteria', 'tétano', 'coqueluche', 'Hib', 'hepatite B'],
    ]),
    vaccine(
      'hexavalente',
      'Hexavalent, acellular',
      'Hexavalente acelular',
      [
        ['diphtheria', 'tetanus', 'whooping cough', 'Hib', 'hepatitis B', 'polio'],
        ['difteria', 'tétano', 'coqueluche', 'Hib', 'hepatite B', 'poliomielite'],
      ],
      'private',
    ),
    vaccine('vip', 'Inactivated polio (IPV)', 'Poliomielite inativada (VIP)', [
      ['polio'],
      ['poliomielite'],
    ]),
    vaccine('vop', 'Oral polio (OPV)', 'Poliomielite oral (VOP)', [['polio'], ['poliomielite']]),
    vaccine('rotavirus', 'Rotavirus', 'Rotavírus', [
      ['severe diarrhea from rotavirus'],
      ['diarreia grave por rotavírus'],
    ]),
    vaccine('pneumo-conjugada', 'Pneumococcal conjugate', 'Pneumocócica conjugada', [
      ['pneumococcal disease'],
      ['doença pneumocócica'],
    ]),
    vaccine(
      'meningo-b',
      'Meningococcal B',
      'Meningocócica B',
      [['meningococcal B disease'], ['doença meningocócica B']],
      'private',
    ),
    vaccine('influenza', 'Influenza (flu)', 'Influenza (gripe)', [['flu'], ['gripe']]),
    vaccine('febre-amarela', 'Yellow fever', 'Febre amarela', [
      ['yellow fever'],
      ['febre amarela'],
    ]),
    vaccine('triplice-viral', 'MMR', 'Tríplice viral (SCR)', [
      ['measles', 'mumps', 'rubella'],
      ['sarampo', 'caxumba', 'rubéola'],
    ]),
    vaccine('varicela', 'Varicella (chickenpox)', 'Varicela', [['chickenpox'], ['catapora']]),
    vaccine('tetraviral', 'MMRV', 'Tetraviral (SCRV)', [
      ['measles', 'mumps', 'rubella', 'chickenpox'],
      ['sarampo', 'caxumba', 'rubéola', 'catapora'],
    ]),
  ],
  doses: [
    dose({
      doseId: 'bcg-1',
      vaccineKey: 'bcg',
      recommendedAgeDays: 0,
      latestAgeDays: 1825,
      en: 'Single dose',
      pt: 'Dose única',
    }),
    dose({
      doseId: 'hepatite-b-1',
      vaccineKey: 'hepatite-b',
      recommendedAgeDays: 0,
      latestAgeDays: 30,
      en: 'Birth dose',
      pt: 'Dose ao nascer',
    }),
    dose({
      doseId: 'vsr-nirsevimabe-1',
      vaccineKey: 'vsr-nirsevimabe',
      recommendedAgeDays: 0,
      latestAgeDays: 364,
      network: 'private',
      condition: RSV_MATERNAL_CONDITION,
      needsReview: true,
      needsReviewReason: 'Depends on the mother',
      en: 'Single dose',
      pt: 'Dose única',
    }),
    dose({
      doseId: 'penta-1',
      vaccineKey: 'penta',
      recommendedAgeDays: 61,
      earliestAgeDays: 42,
      latestAgeDays: 2556,
      sources: ['pni'],
      alternativeGroup: 'dtp-primaria-1',
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'penta-2',
      vaccineKey: 'penta',
      recommendedAgeDays: 122,
      earliestAgeDays: 72,
      latestAgeDays: 2556,
      sources: ['pni'],
      minIntervalDaysFromPrevious: 30,
      previousDoseIds: ['penta-1'],
      alternativeGroup: 'dtp-primaria-2',
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'hexavalente-1',
      vaccineKey: 'hexavalente',
      recommendedAgeDays: 61,
      network: 'private',
      alternativeGroup: 'dtp-primaria-1',
      needsReview: true,
      needsReviewReason: 'Product choice',
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'hexavalente-2',
      vaccineKey: 'hexavalente',
      recommendedAgeDays: 122,
      network: 'private',
      alternativeGroup: 'dtp-primaria-2',
      previousDoseIds: ['hexavalente-1'],
      needsReview: true,
      needsReviewReason: 'Product choice',
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'vip-1',
      vaccineKey: 'vip',
      recommendedAgeDays: 61,
      latestAgeDays: 1825,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'vip-2',
      vaccineKey: 'vip',
      recommendedAgeDays: 122,
      earliestAgeDays: 91,
      latestAgeDays: 1825,
      minIntervalDaysFromPrevious: 30,
      previousDoseIds: ['vip-1'],
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'rotavirus-1',
      vaccineKey: 'rotavirus',
      recommendedAgeDays: 61,
      earliestAgeDays: 45,
      latestAgeDays: 120,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'rotavirus-2',
      vaccineKey: 'rotavirus',
      recommendedAgeDays: 122,
      earliestAgeDays: 106,
      latestAgeDays: 730,
      minIntervalDaysFromPrevious: 30,
      previousDoseIds: ['rotavirus-1'],
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'pneumo-conjugada-1',
      vaccineKey: 'pneumo-conjugada',
      recommendedAgeDays: 61,
      latestAgeDays: 364,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'meningo-b-1',
      vaccineKey: 'meningo-b',
      recommendedAgeDays: 91,
      earliestAgeDays: 61,
      network: 'private',
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'meningo-b-2',
      vaccineKey: 'meningo-b',
      recommendedAgeDays: 152,
      earliestAgeDays: 122,
      network: 'private',
      minIntervalDaysFromPrevious: 61,
      previousDoseIds: ['meningo-b-1'],
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'influenza-1',
      vaccineKey: 'influenza',
      recommendedAgeDays: 183,
      latestAgeDays: 2191,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'influenza-anual',
      vaccineKey: 'influenza',
      recommendedAgeDays: 365,
      latestAgeDays: 2191,
      sources: ['pni'],
      alternativeGroup: 'influenza-anual',
      needsReview: true,
      needsReviewReason: 'Yearly',
      previousDoseIds: ['influenza-1'],
      recurrence: { everyDays: 365, startAgeDays: 365 },
      en: 'Yearly dose',
      pt: 'Dose anual',
    }),
    dose({
      doseId: 'influenza-anual-sociedades',
      vaccineKey: 'influenza',
      recommendedAgeDays: 365,
      network: 'private',
      alternativeGroup: 'influenza-anual',
      needsReview: true,
      needsReviewReason: 'Yearly',
      previousDoseIds: ['influenza-1'],
      recurrence: { everyDays: 365, startAgeDays: 365 },
      en: 'Yearly dose',
      pt: 'Dose anual',
    }),
    dose({
      doseId: 'febre-amarela-1',
      vaccineKey: 'febre-amarela',
      recommendedAgeDays: 274,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'triplice-viral-1',
      vaccineKey: 'triplice-viral',
      recommendedAgeDays: 365,
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'triplice-viral-2',
      vaccineKey: 'triplice-viral',
      recommendedAgeDays: 457,
      earliestAgeDays: 380,
      minIntervalDaysFromPrevious: 15,
      previousDoseIds: ['triplice-viral-1'],
      en: SECOND.en,
      pt: SECOND.pt,
    }),
    dose({
      doseId: 'varicela-1-sociedades',
      vaccineKey: 'varicela',
      recommendedAgeDays: 365,
      network: 'private',
      alternativeGroup: 'varicela-1',
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'varicela-1',
      vaccineKey: 'varicela',
      recommendedAgeDays: 457,
      latestAgeDays: 2556,
      sources: ['pni'],
      alternativeGroup: 'varicela-1',
      en: FIRST.en,
      pt: FIRST.pt,
    }),
    dose({
      doseId: 'tetraviral-15m',
      vaccineKey: 'tetraviral',
      recommendedAgeDays: 457,
      sources: ['pni'],
      covers: ['triplice-viral-2', 'varicela-1'],
      recordOnly: true,
      en: '15-month dose (2nd MMR + 1st varicella)',
      pt: 'Dose dos 15 meses (2ª tríplice viral + 1ª varicela)',
    }),
  ],
};

/** Puts the schedule in the device cache, as the app does after `GET /vaccine-schedule`. */
export async function seedSchedule(
  db: BabyRoutineDb,
  schedule: VaccineSchedule = TEST_SCHEDULE,
  etag: string | null = '"br-test-1"',
): Promise<void> {
  const stamp = new Date().toISOString();
  await db.vaccineSchedules.put({
    profile: 'BR',
    etag,
    schedule,
    fetchedAt: stamp,
    checkedAt: stamp,
  });
}
