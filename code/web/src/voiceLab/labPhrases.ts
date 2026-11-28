import type { HandsFreeCommand } from '../voice/commandParser';
import type { SpeechLocale } from '../voice/numberWords';
import type { UnitSystem } from '../units/system';

/*
 * The phrases the owner reads aloud in the voice lab (docs/design/49-hands-free.md section 7.3), with
 * the command each one must give. The ids are those of voice/handsFreeCommandVectors.json, and
 * labPhrases.test.ts checks that both say the same. These are test material in the language spoken,
 * not interface text: they are not translated.
 */

export type LabCondition = 'C1' | 'C2' | 'C3' | 'C4';
export const LAB_CONDITIONS: readonly LabCondition[] = ['C1', 'C2', 'C3', 'C4'];
export const LAB_LOCALES: readonly SpeechLocale[] = ['pt-BR', 'en'];

/** What a phrase must give: a command, or nothing logged (22 needs an amount, 23 and 24 are not commands). */
export type LabExpectation =
  | { type: 'command'; command: HandsFreeCommand }
  | { type: 'none'; outcome: 'needs_amount' | 'not_understood' };

export interface LabPhrase {
  id: string;
  /** Its number in design 49 section 7.3 (pt-BR 1-24, en 1-10, the US phrase 11). */
  number: number;
  locale: SpeechLocale;
  units: UnitSystem;
  text: string;
  expected: LabExpectation;
}

const cmd = (command: HandsFreeCommand): LabExpectation => ({ type: 'command', command });
const bottle = (amountMl: number, content: 'formula' | 'breast_milk' | null = null) =>
  cmd({ kind: 'bottle', amountMl, content });

type Row = readonly [string, LabExpectation, UnitSystem?];

const PT: readonly Row[] = [
  ['mamadeira de 120 ml', bottle(120)],
  ['mamadeira de 90', bottle(90)],
  ['mamadeira de cento e cinquenta mililitros', bottle(150)],
  ['mamadeira de 60 ml de fórmula', bottle(60, 'formula')],
  ['mamadeira de 100 de leite materno', bottle(100, 'breast_milk')],
  ['mamadeira de 210', bottle(210)],
  ['peito esquerdo', cmd({ kind: 'nursing_start', side: 'left' })],
  ['começou no peito direito', cmd({ kind: 'nursing_start', side: 'right' })],
  ['mamando no lado esquerdo', cmd({ kind: 'nursing_start', side: 'left' })],
  ['parou de mamar', cmd({ kind: 'nursing_stop' })],
  ['terminou a mamada', cmd({ kind: 'nursing_stop' })],
  ['dormiu', cmd({ kind: 'sleep_start' })],
  ['o bebê pegou no sono', cmd({ kind: 'sleep_start' })],
  ['acordou', cmd({ kind: 'sleep_end' })],
  ['ela acordou agora', cmd({ kind: 'sleep_end' })],
  ['fralda de xixi', cmd({ kind: 'diaper', diaper: 'wet' })],
  ['fralda molhada', cmd({ kind: 'diaper', diaper: 'wet' })],
  ['fralda de cocô', cmd({ kind: 'diaper', diaper: 'dirty' })],
  ['xixi e cocô', cmd({ kind: 'diaper', diaper: 'both' })],
  ['quanto leite ela tomou hoje', cmd({ kind: 'ask_milk_today' })],
  ['quando foi a última mamada', cmd({ kind: 'ask_last_feed' })],
  ['mamadeira', { type: 'none', outcome: 'needs_amount' }],
  ['que horas são', { type: 'none', outcome: 'not_understood' }],
  ['ela está chorando muito', { type: 'none', outcome: 'not_understood' }],
];

const EN: readonly Row[] = [
  ['bottle 120 ml', bottle(120)],
  ['90 ml bottle of formula', bottle(90, 'formula')],
  ['left side', cmd({ kind: 'nursing_start', side: 'left' })],
  ['start nursing on the right', cmd({ kind: 'nursing_start', side: 'right' })],
  ['stop nursing', cmd({ kind: 'nursing_stop' })],
  ['she fell asleep', cmd({ kind: 'sleep_start' })],
  ['she woke up', cmd({ kind: 'sleep_end' })],
  ['wet diaper', cmd({ kind: 'diaper', diaper: 'wet' })],
  ['dirty diaper', cmd({ kind: 'diaper', diaper: 'dirty' })],
  ['how much milk today', cmd({ kind: 'ask_milk_today' })],
  ['four ounce bottle', bottle(118), 'us'],
];

const pad = (n: number) => String(n).padStart(2, '0');

const phrases = (locale: SpeechLocale, rows: readonly Row[]): LabPhrase[] =>
  rows.map(([text, expected, units], index) => ({
    id:
      locale === 'pt-BR'
        ? `pt-${pad(index + 1)}`
        : units === 'us'
          ? 'en-us-01'
          : `en-${pad(index + 1)}`,
    number: index + 1,
    locale,
    units: units ?? 'metric',
    text,
    expected,
  }));

export const LAB_PHRASES: Readonly<Record<SpeechLocale, readonly LabPhrase[]>> = {
  'pt-BR': phrases('pt-BR', PT),
  en: phrases('en', EN),
};

/** Section 7.3: C2 (night voice) and C4 (airplane mode) read a subset of the pt-BR phrases. */
const SUBSETS: Readonly<Partial<Record<LabCondition, readonly number[]>>> = {
  C2: [1, 7, 10, 12, 14, 16, 18, 21],
  C4: [1, 7, 12, 16, 21],
};

/**
 * The phrases of one run. pt-BR: all 24 in C1 and C3, the subsets in C2 and C4. English is measured
 * once in C1 (section 7.3) and has no subsets: every condition reads its whole list.
 */
export function phrasesFor(locale: SpeechLocale, condition: LabCondition): readonly LabPhrase[] {
  const all = LAB_PHRASES[locale];
  const subset = locale === 'pt-BR' ? SUBSETS[condition] : undefined;
  return subset ? all.filter((phrase) => subset.includes(phrase.number)) : all;
}
