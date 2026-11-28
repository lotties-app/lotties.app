/*
 * Spoken numbers for the hands-free parser (docs/design/49-hands-free.md section 3.3): "cento e
 * vinte", "one hundred and twenty", "120", "4,5", "1.000". Pure, no I/O. The tokens are already
 * normalized (lower case, no accents, see tokens.ts). A number that cannot be read without guessing
 * (two numbers side by side, "1.2.3") marks the utterance as invalid instead of picking one.
 */

export type SpeechLocale = 'pt-BR' | 'en';

/** A word of the utterance; `value` is set when the word (or the words it replaced) is a number. */
export interface Token {
  text: string;
  value?: number;
}

type Part = 'unit' | 'teen' | 'ten' | 'hundred' | 'multiplier' | 'thousand';

interface NumberTable {
  words: Readonly<Record<string, readonly [Part, number]>>;
  /** Joins the parts of one number ("cento e vinte", "hundred and twenty"). */
  connector: string;
  /** Words that are a number only inside a longer number or right before a unit ("uma onça"). */
  articleLike: ReadonlySet<string>;
}

const PT: NumberTable = {
  words: {
    zero: ['unit', 0],
    um: ['unit', 1],
    uma: ['unit', 1],
    dois: ['unit', 2],
    duas: ['unit', 2],
    tres: ['unit', 3],
    quatro: ['unit', 4],
    cinco: ['unit', 5],
    seis: ['unit', 6],
    sete: ['unit', 7],
    oito: ['unit', 8],
    nove: ['unit', 9],
    dez: ['teen', 10],
    onze: ['teen', 11],
    doze: ['teen', 12],
    treze: ['teen', 13],
    catorze: ['teen', 14],
    quatorze: ['teen', 14],
    quinze: ['teen', 15],
    dezesseis: ['teen', 16],
    dezasseis: ['teen', 16],
    dezessete: ['teen', 17],
    dezassete: ['teen', 17],
    dezoito: ['teen', 18],
    dezenove: ['teen', 19],
    dezanove: ['teen', 19],
    vinte: ['ten', 20],
    trinta: ['ten', 30],
    quarenta: ['ten', 40],
    cinquenta: ['ten', 50],
    cincoenta: ['ten', 50],
    sessenta: ['ten', 60],
    setenta: ['ten', 70],
    oitenta: ['ten', 80],
    noventa: ['ten', 90],
    cem: ['hundred', 100],
    cento: ['hundred', 100],
    duzentos: ['hundred', 200],
    duzentas: ['hundred', 200],
    trezentos: ['hundred', 300],
    trezentas: ['hundred', 300],
    quatrocentos: ['hundred', 400],
    quatrocentas: ['hundred', 400],
    quinhentos: ['hundred', 500],
    quinhentas: ['hundred', 500],
    seiscentos: ['hundred', 600],
    seiscentas: ['hundred', 600],
    setecentos: ['hundred', 700],
    setecentas: ['hundred', 700],
    oitocentos: ['hundred', 800],
    oitocentas: ['hundred', 800],
    novecentos: ['hundred', 900],
    novecentas: ['hundred', 900],
    mil: ['thousand', 1000],
  },
  connector: 'e',
  articleLike: new Set(['um', 'uma']),
};

const EN: NumberTable = {
  words: {
    zero: ['unit', 0],
    one: ['unit', 1],
    two: ['unit', 2],
    three: ['unit', 3],
    four: ['unit', 4],
    five: ['unit', 5],
    six: ['unit', 6],
    seven: ['unit', 7],
    eight: ['unit', 8],
    nine: ['unit', 9],
    ten: ['teen', 10],
    eleven: ['teen', 11],
    twelve: ['teen', 12],
    thirteen: ['teen', 13],
    fourteen: ['teen', 14],
    fifteen: ['teen', 15],
    sixteen: ['teen', 16],
    seventeen: ['teen', 17],
    eighteen: ['teen', 18],
    nineteen: ['teen', 19],
    twenty: ['ten', 20],
    thirty: ['ten', 30],
    forty: ['ten', 40],
    fifty: ['ten', 50],
    sixty: ['ten', 60],
    seventy: ['ten', 70],
    eighty: ['ten', 80],
    ninety: ['ten', 90],
    hundred: ['multiplier', 100],
    thousand: ['thousand', 1000],
  },
  connector: 'and',
  articleLike: new Set(['one', 'a', 'an']),
};

const TABLES: Readonly<Record<SpeechLocale, NumberTable>> = { 'pt-BR': PT, en: EN };

/** Which part may follow the last one read ("vinte e cinco" yes, "cinco e vinte" no). */
const NEXT: Readonly<Record<Part | 'start', ReadonlySet<Part>>> = {
  start: new Set(['unit', 'teen', 'ten', 'hundred', 'multiplier', 'thousand']),
  unit: new Set(['multiplier', 'thousand']),
  teen: new Set(['multiplier', 'thousand']),
  ten: new Set(['unit', 'thousand']),
  hundred: new Set(['unit', 'teen', 'ten', 'thousand']),
  multiplier: new Set(['unit', 'teen', 'ten', 'thousand']),
  thousand: new Set(['unit', 'teen', 'ten', 'hundred']),
};

const DIGITS = /^\d+(?:[.,]\d+)*$/;

/**
 * A digit token as a number: `120`, `4.5` / `4,5` (decimal), `1.000` / `1,000` (thousands: every
 * group after a separator has three digits). Anything else (`1.2.3`) is `NaN`.
 */
export function digitValue(text: string): number {
  if (!DIGITS.test(text)) return Number.NaN;
  const groups = text.split(/[.,]/);
  if (groups.length === 1) return Number(text);
  if (groups.slice(1).every((group) => group.length === 3)) return Number(groups.join(''));
  if (groups.length === 2) return Number(`${groups[0]}.${groups[1]}`);
  return Number.NaN;
}

interface Read {
  value: number;
  /** Index after the last word of the number. */
  next: number;
  /** Words read (connectors included). */
  words: number;
}

function partOf(table: NumberTable, word: string | undefined): readonly [Part, number] | null {
  if (word === undefined || !Object.hasOwn(table.words, word)) return null;
  return table.words[word];
}

/** The longest spelled-out number starting at `start`, or null. */
function readWords(table: NumberTable, words: readonly string[], start: number): Read | null {
  let total = 0;
  let current = 0;
  let last: Part | 'start' = 'start';
  let index = start;
  // "a hundred", "an hundred": the article stands for one.
  if ((words[index] === 'a' || words[index] === 'an') && words[index + 1] === 'hundred') {
    current = 1;
    last = 'unit';
    index += 1;
  }
  while (index < words.length) {
    let word = words[index];
    let step = 1;
    if (word === table.connector && last !== 'start') {
      word = words[index + 1];
      step = 2;
    }
    const part = partOf(table, word);
    if (!part || !NEXT[last].has(part[0])) break;
    const [kind, value] = part;
    if (kind === 'multiplier') current = (current || 1) * value;
    else if (kind === 'thousand') {
      total += (current || 1) * value;
      current = 0;
    } else current += value;
    last = kind;
    index += step;
  }
  if (last === 'start') return null;
  return { value: total + current, next: index, words: index - start };
}

export interface NumberedTokens {
  tokens: Token[];
  /** A number could not be read without guessing (adjacent numbers, malformed digits). */
  invalid: boolean;
}

/**
 * Replaces spelled-out numbers and digit strings by number tokens. `isUnit` tells whether a word is
 * a unit (ml, onças, horas...): "uma" before a unit is one, elsewhere it is an article.
 */
export function readNumbers(
  words: readonly string[],
  locale: SpeechLocale,
  isUnit: (word: string | undefined) => boolean,
): NumberedTokens {
  const table = TABLES[locale];
  const tokens: Token[] = [];
  let invalid = false;
  let previousWasNumber = false;
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (DIGITS.test(word)) {
      const value = digitValue(word);
      if (Number.isNaN(value) || previousWasNumber) invalid = true;
      tokens.push({ text: word, value });
      previousWasNumber = true;
      index += 1;
      continue;
    }
    const read = readWords(table, words, index);
    const lone = read !== null && read.words === 1 && table.articleLike.has(word);
    // "one twenty": an article-like number right before another number cannot be read safely.
    const beforeNumber =
      read !== null &&
      (DIGITS.test(words[read.next] ?? '') || readWords(table, words, read.next) !== null);
    if (read && !(lone && !isUnit(words[read.next]) && !beforeNumber)) {
      if (previousWasNumber) invalid = true;
      tokens.push({ text: words.slice(index, read.next).join(' '), value: read.value });
      previousWasNumber = true;
      index = read.next;
      continue;
    }
    tokens.push({ text: word });
    previousWasNumber = false;
    index += 1;
  }
  return { tokens, invalid };
}
