import { describe, expect, it } from 'vitest';
import vectors from './handsFreeCommandVectors.json';
import {
  BOTTLE_MAX_ML,
  isLoggingCommand,
  parseAlternatives,
  parseCommand,
  sameCommand,
  type HandsFreeCommand,
  type ParseContext,
  type ParseResult,
} from './commandParser';
import { digitValue, type SpeechLocale } from './numberWords';
import { normalizeText } from './tokens';
import type { UnitSystem } from '../units/system';

/* The hands-free parser v0 (docs/design/49-hands-free.md sections 3.3, 4 and 7.3). */

interface Expectation {
  kind?: string;
  outcome?: string;
  reason?: string;
  [slot: string]: unknown;
}

interface VectorCase {
  id: string;
  locale: string;
  units?: string;
  running?: { nursing?: boolean; sleep?: boolean };
  text: string;
  expect: Expectation;
}

const contextOf = (c: Pick<VectorCase, 'locale' | 'units' | 'running'>): ParseContext => ({
  locale: c.locale as SpeechLocale,
  units: (c.units ?? 'metric') as UnitSystem,
  running: c.running,
});

function check(result: ParseResult, expected: Expectation) {
  if (expected.kind !== undefined) {
    expect(result).toEqual({ outcome: 'command', command: expected });
    return;
  }
  expect(result.outcome).toBe(expected.outcome);
  if (expected.reason !== undefined && result.outcome === 'not_understood') {
    expect(result.reason).toBe(expected.reason);
  }
}

const cases = vectors.cases as VectorCase[];
const logging = cases.filter(
  (c) => c.expect.kind !== undefined && !c.expect.kind.startsWith('ask_'),
);

describe('handsFreeCommandVectors.json', () => {
  it('has unique ids, every 7.3 phrase and both languages', () => {
    const ids = [...cases.map((c) => c.id), ...vectors.nBest.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(cases.filter((c) => c.id.startsWith('pt-') && /^pt-\d\d$/.test(c.id))).toHaveLength(24);
    expect(cases.filter((c) => /^en-\d\d$/.test(c.id))).toHaveLength(10);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_, c) => {
    check(parseCommand(c.text, contextOf(c)), c.expect);
  });

  it.each(vectors.nBest.map((c) => [c.id, c] as const))('n-best %s', (_, c) => {
    const { result, index } = parseAlternatives(c.alternatives, contextOf(c));
    check(result, c.expect as Expectation);
    expect(index).toBe(c.index);
  });
});

describe('rules hold beyond the listed phrases', () => {
  const NEGATION: Record<SpeechLocale, string> = { 'pt-BR': 'não', en: 'not' };
  const OTHER_DAY: Record<SpeechLocale, string> = { 'pt-BR': 'ontem', en: 'yesterday' };
  const FUTURE: Record<SpeechLocale, string> = { 'pt-BR': 'ela vai', en: 'she will' };

  it.each(logging.map((c) => [c.id, c] as const))('%s never logs once negated', (_, c) => {
    const locale = c.locale as SpeechLocale;
    const result = parseCommand(`${NEGATION[locale]} ${c.text}`, contextOf(c));
    expect(result).toEqual({ outcome: 'not_understood', reason: 'negation' });
  });

  it.each(logging.map((c) => [c.id, c] as const))('%s never logs about another day', (_, c) => {
    const locale = c.locale as SpeechLocale;
    expect(parseCommand(`${c.text} ${OTHER_DAY[locale]}`, contextOf(c)).outcome).not.toBe(
      'command',
    );
  });

  it.each(logging.map((c) => [c.id, c] as const))('%s never logs as an intention', (_, c) => {
    const locale = c.locale as SpeechLocale;
    expect(parseCommand(`${FUTURE[locale]} ${c.text}`, contextOf(c)).outcome).not.toBe('command');
  });

  it.each(logging.map((c) => [c.id, c] as const))('%s never logs as a question', (_, c) => {
    const result = parseCommand(`${c.text}?`, contextOf(c));
    expect(result.outcome === 'command' && isLoggingCommand(result.command)).toBe(false);
  });
});

/* Spelled-out numbers built here, not listed: every amount the recogniser could write in words. */
const PT_UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const PT_TEENS = [
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const PT_TENS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const PT_HUNDREDS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function ptWords(n: number): string {
  if (n === 100) return 'cem';
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(PT_HUNDREDS[hundreds]);
  if (rest > 0 && rest < 10) parts.push(PT_UNITS[rest]);
  else if (rest >= 10 && rest < 20) parts.push(PT_TEENS[rest - 10]);
  else if (rest >= 20) {
    const unit = rest % 10;
    const tens = PT_TENS[Math.floor(rest / 10)];
    parts.push(unit > 0 ? `${tens} e ${PT_UNITS[unit]}` : tens);
  }
  return parts.join(' e ');
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function enBelowHundred(n: number): string {
  if (n < 10) return EN_ONES[n];
  if (n < 20) return EN_TEENS[n - 10];
  const unit = n % 10;
  return `${EN_TENS[Math.floor(n / 10)]}${unit > 0 ? ` ${EN_ONES[unit]}` : ''}`;
}

function enWords(n: number, and: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return enBelowHundred(rest);
  const head = `${EN_ONES[hundreds]} hundred`;
  if (rest === 0) return head;
  return `${head}${and ? ' and' : ''} ${enBelowHundred(rest)}`;
}

const expectedBottle = (amountMl: number): ParseResult =>
  amountMl >= 1 && amountMl <= BOTTLE_MAX_ML
    ? { outcome: 'command', command: { kind: 'bottle', amountMl, content: null } }
    : { outcome: 'out_of_range', amountMl };

const metric = (locale: SpeechLocale): ParseContext => ({ locale, units: 'metric' });
const ALL = Array.from({ length: 999 }, (_, i) => i + 1);

describe('spoken amounts', () => {
  it('reads every Portuguese number from 1 to 999 with a unit and alone', () => {
    for (const n of ALL) {
      expect(parseCommand(`mamadeira de ${ptWords(n)} ml`, metric('pt-BR')), ptWords(n)).toEqual(
        expectedBottle(n),
      );
      if (n > 1) {
        expect(parseCommand(`mamadeira de ${ptWords(n)}`, metric('pt-BR'))).toEqual(
          expectedBottle(n),
        );
      }
    }
  });

  it('reads every English number from 1 to 999, with and without "and"', () => {
    for (const n of ALL) {
      for (const and of [true, false]) {
        const words = enWords(n, and);
        expect(parseCommand(`bottle of ${words} ml`, metric('en')), words).toEqual(
          expectedBottle(n),
        );
      }
    }
  });

  it('reads digits and refuses what is out of 1-500 ml, in both systems', () => {
    for (const n of [0, 1, 2, 30, 99, 120, 250, 499, 500, 501, 750, 1000, 2500]) {
      expect(parseCommand(`mamadeira de ${n} ml`, metric('pt-BR'))).toEqual(expectedBottle(n));
      expect(parseCommand(`${n} ml bottle`, metric('en'))).toEqual(expectedBottle(n));
    }
    // A bare number is fl oz in the US system: 16 oz is in range, 17 oz is not.
    const us: ParseContext = { locale: 'en', units: 'us' };
    expect(parseCommand('bottle of 16', us)).toEqual(expectedBottle(473));
    expect(parseCommand('bottle of 17', us)).toEqual({ outcome: 'out_of_range', amountMl: 503 });
  });

  it('reads digit groups without guessing', () => {
    expect(digitValue('120')).toBe(120);
    expect(digitValue('4,5')).toBe(4.5);
    expect(digitValue('4.5')).toBe(4.5);
    expect(digitValue('1.000')).toBe(1000);
    expect(digitValue('1,000')).toBe(1000);
    expect(digitValue('1.2.3')).toBeNaN();
  });
});

describe('normalization', () => {
  it('drops accents and case, opens contractions, marks clock times', () => {
    expect(normalizeText('Fralda de COCÔ', 'pt-BR')).toBe('fralda de coco');
    expect(normalizeText("She didn't wake", 'en')).toBe('she did not wake');
    expect(normalizeText('she’s asleep', 'en')).toBe('she is asleep');
    expect(normalizeText('acordou 15h30', 'pt-BR')).toContain('§clock');
    expect(normalizeText('120ml', 'pt-BR')).toBe('120 ml');
  });
});

describe('command helpers', () => {
  const bottle: HandsFreeCommand = { kind: 'bottle', amountMl: 120, content: null };

  it('only the two questions do not log', () => {
    expect(isLoggingCommand(bottle)).toBe(true);
    expect(isLoggingCommand({ kind: 'sleep_start' })).toBe(true);
    expect(isLoggingCommand({ kind: 'ask_milk_today' })).toBe(false);
    expect(isLoggingCommand({ kind: 'ask_last_feed' })).toBe(false);
  });

  it('compares kind and every slot', () => {
    expect(sameCommand(bottle, { kind: 'bottle', amountMl: 120, content: null })).toBe(true);
    expect(sameCommand(bottle, { kind: 'bottle', amountMl: 150, content: null })).toBe(false);
    expect(sameCommand(bottle, { kind: 'bottle', amountMl: 120, content: 'formula' })).toBe(false);
    expect(
      sameCommand({ kind: 'nursing_start', side: 'left' }, { kind: 'nursing_start', side: null }),
    ).toBe(false);
    expect(sameCommand({ kind: 'diaper', diaper: 'wet' }, { kind: 'diaper', diaper: 'both' })).toBe(
      false,
    );
    expect(sameCommand({ kind: 'sleep_end' }, { kind: 'sleep_start' })).toBe(false);
  });
});
