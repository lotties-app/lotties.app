import { readNumbers, type SpeechLocale, type Token } from './numberWords';

/*
 * Text to tokens for the hands-free parser: lower case, accents removed ("cocô" -> "coco"), English
 * contractions opened ("didn't" -> "did not"), punctuation dropped (a question mark is remembered),
 * multi-word names joined ("leite materno" -> one token, so "peito" in "leite do peito" is not a
 * breast side), "acabou de dormir" read as "dormiu", then numbers read (numberWords.ts). Pure.
 */

/** Joined names: content of a bottle and the fluid ounce. */
export const BREAST_MILK = '§breastmilk';
export const FORMULA = '§formula';
/** "mais ou menos", "about": an approximate amount is still the amount said. */
export const APPROX = '§approx';
/** A clock time such as "3:15" or "15h30". */
export const CLOCK = '§clock';

type Phrase = readonly [readonly string[], readonly string[]];

/** Longest first within a locale; applied left to right. */
const PHRASES: Readonly<Record<SpeechLocale, readonly Phrase[]>> = {
  'pt-BR': [
    [['leite', 'do', 'peito'], [BREAST_MILK]],
    [['leite', 'de', 'peito'], [BREAST_MILK]],
    [['leite', 'da', 'mae'], [BREAST_MILK]],
    [['leite', 'materno'], [BREAST_MILK]],
    [['leite', 'ordenhado'], [BREAST_MILK]],
    [['leite', 'artificial'], [FORMULA]],
    [['formula', 'infantil'], [FORMULA]],
    [['formula'], [FORMULA]],
    [['oncas', 'fluidas'], ['oz']],
    [['onca', 'fluida'], ['oz']],
    [['fl', 'oz'], ['oz']],
    [['mais', 'ou', 'menos'], [APPROX]],
    [['cerca', 'de'], [APPROX]],
    [['aproximadamente'], [APPROX]],
    [['uns'], [APPROX]],
    [['umas'], [APPROX]],
    // "Just did": the event happened now.
    [
      ['acabou', 'de', 'pegar', 'no', 'sono'],
      ['pegou', 'no', 'sono'],
    ],
    [['acabou', 'de', 'dormir'], ['dormiu']],
    [['acabou', 'de', 'adormecer'], ['adormeceu']],
    [['acabou', 'de', 'acordar'], ['acordou']],
    [
      ['acabou', 'de', 'mamar'],
      ['parou', 'de', 'mamar'],
    ],
    [['acabou', 'de', 'fazer'], ['fez']],
  ],
  en: [
    [['breast', 'milk'], [BREAST_MILK]],
    [['pumped', 'milk'], [BREAST_MILK]],
    [['expressed', 'milk'], [BREAST_MILK]],
    [['breastmilk'], [BREAST_MILK]],
    [['formula'], [FORMULA]],
    [['fluid', 'ounces'], ['oz']],
    [['fluid', 'ounce'], ['oz']],
    [['fl', 'oz'], ['oz']],
    // "about to" stays a future marker (kept as it is), "about 120" is an approximate amount.
    [
      ['about', 'to'],
      ['about', 'to'],
    ],
    [['about'], [APPROX]],
    [['around'], [APPROX]],
    [['roughly'], [APPROX]],
    [['approximately'], [APPROX]],
  ],
};

const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
  [/n't\b/g, ' not'],
  [/'ll\b/g, ' will'],
  [/'re\b/g, ' are'],
  [/'s\b/g, ' is'],
  [/'m\b/g, ' am'],
  [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'],
];

export interface Tokenized {
  tokens: Token[];
  words: string[];
  questionMark: boolean;
  invalidNumber: boolean;
}

function replacePhrases(words: readonly string[], phrases: readonly Phrase[]): string[] {
  const out: string[] = [];
  let index = 0;
  outer: while (index < words.length) {
    for (const [from, to] of phrases) {
      if (from.every((word, offset) => words[index + offset] === word)) {
        out.push(...to);
        index += from.length;
        continue outer;
      }
    }
    out.push(words[index]);
    index += 1;
  }
  return out;
}

/** Lower case, no accents, English contractions opened, digits split from letters. */
export function normalizeText(text: string, locale: SpeechLocale): string {
  let s = text.toLowerCase().replace(/[’`´]/g, "'");
  if (locale === 'en') {
    for (const [pattern, replacement] of CONTRACTIONS) s = s.replace(pattern, replacement);
  }
  s = s.normalize('NFD').replace(/\p{M}/gu, '');
  s = s.replace(/\b\d{1,2}\s?[:h]\s?\d{2}\b/g, ` ${CLOCK} `);
  s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  return s;
}

/**
 * The words of `text`, with numbers read. `isUnit` names the unit words of the locale (an article
 * such as "uma" is a number only right before one).
 */
export function tokenize(
  text: string,
  locale: SpeechLocale,
  isUnit: (word: string | undefined) => boolean,
): Tokenized {
  const questionMark = /[?¿]/.test(text);
  const normalized = normalizeText(text, locale);
  const raw = normalized.match(/§[a-z]+|\d+(?:[.,]\d+)*|[a-z]+/g) ?? [];
  const joined = replacePhrases(raw, PHRASES[locale]);
  const { tokens, invalid } = readNumbers(joined, locale, isUnit);
  return { tokens, words: tokens.map((token) => token.text), questionMark, invalidNumber: invalid };
}
