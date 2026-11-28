import { flOzToMl } from '../units/convert';
import type { UnitSystem } from '../units/system';
import { LEXICONS, type Lexicon, type VolumeUnit } from './lexicon';
import type { SpeechLocale, Token } from './numberWords';
import { BREAST_MILK, FORMULA, tokenize } from './tokens';

/*
 * Hands-free command parser v0 (docs/design/49-hands-free.md sections 3.3, 4 and 7): one recognised
 * sentence (or the recogniser's n-best list) to one v1 command, or to a reason why nothing may be logged.
 * Pure: no I/O, no clock, nothing stored; the text is dropped by the caller after parsing. Shared
 * vectors: handsFreeCommandVectors.json. Rules:
 * - a negation, a question that is not one of the two v1 questions, another time ("ontem", "às 3",
 *   "há 10 minutos"), an intention ("vai dormir"), a habit, a hedge or a comment ("dormiu bem") never
 *   logs;
 * - two commands in one sentence, two amounts, two sides or two contents: nothing is guessed;
 * - a bottle needs an amount in 1-500 ml (AssistantLimits); a bare number is ml in the metric system
 *   and fl oz in the US one, a said unit wins; storage is ml.
 */

export const BOTTLE_MIN_ML = 1;
export const BOTTLE_MAX_ML = 500;

export type BottleContent = 'formula' | 'breast_milk';
export type BreastSide = 'left' | 'right';
export type DiaperKind = 'wet' | 'dirty' | 'both';

export type HandsFreeCommand =
  | { kind: 'bottle'; amountMl: number; content: BottleContent | null }
  | { kind: 'nursing_start'; side: BreastSide | null }
  | { kind: 'nursing_stop' }
  | { kind: 'sleep_start' }
  | { kind: 'sleep_end' }
  | { kind: 'diaper'; diaper: DiaperKind }
  | { kind: 'ask_milk_today' }
  | { kind: 'ask_last_feed' };

export type CommandKind = HandsFreeCommand['kind'];

export type NotUnderstoodReason =
  | 'empty'
  | 'no_intent'
  | 'negation'
  | 'question'
  | 'report'
  | 'time'
  | 'conflict'
  | 'stray_number'
  | 'ambiguous_amount'
  | 'content_conflict'
  | 'invalid_number'
  | 'diaper_kind'
  | 'no_running';

export type ParseResult =
  | { outcome: 'command'; command: HandsFreeCommand }
  | { outcome: 'needs_amount' }
  | { outcome: 'out_of_range'; amountMl: number }
  | { outcome: 'ambiguous'; choices: readonly ('nursing_stop' | 'sleep_end')[] }
  | { outcome: 'not_understood'; reason: NotUnderstoodReason };

export interface ParseContext {
  locale: SpeechLocale;
  units: UnitSystem;
  /** What is running for the baby: a bare "parou" / "stop" stops the one that runs. */
  running?: { nursing?: boolean; sleep?: boolean };
}

interface SpokenNumber {
  value: number;
  unit: VolumeUnit | null;
  /** Followed by a unit of time: a clock time, a duration or a count ("3 vezes"). */
  time: boolean;
}

/** Words that may open a question before its question word ("hey, did she..."). */
const OPENERS = new Set(['hey', 'ok', 'okay', 'lotties', 'so', 'um', 'uh', 'e', 'entao', 'ai']);

const hasOwn = (record: object, key: string) => Object.hasOwn(record, key);
const command = (value: HandsFreeCommand): ParseResult => ({ outcome: 'command', command: value });
const notUnderstood = (reason: NotUnderstoodReason): ParseResult => ({
  outcome: 'not_understood',
  reason,
});

function containsSeq(words: readonly string[], seq: readonly string[]): boolean {
  for (let i = 0; i + seq.length <= words.length; i += 1) {
    if (seq.every((word, offset) => words[i + offset] === word)) return true;
  }
  return false;
}

const anyIn = (words: readonly string[], set: ReadonlySet<string>) => words.some((w) => set.has(w));
const anySeq = (words: readonly string[], seqs: readonly (readonly string[])[]) =>
  seqs.some((seq) => containsSeq(words, seq));

function numbersOf(tokens: readonly Token[], lexicon: Lexicon): SpokenNumber[] {
  return tokens.flatMap((token, index) => {
    if (token.value === undefined) return [];
    const next = tokens[index + 1]?.text;
    const unit =
      next !== undefined && hasOwn(lexicon.volumeUnits, next) ? lexicon.volumeUnits[next] : null;
    return [{ value: token.value, unit, time: next !== undefined && lexicon.timeUnits.has(next) }];
  });
}

function isQuestion(words: readonly string[], questionMark: boolean, lexicon: Lexicon): boolean {
  if (questionMark) return true;
  if (anyIn(words, lexicon.questionWords) || anySeq(words, lexicon.questionSeqs)) return true;
  const first = words.find((word) => !OPENERS.has(word));
  return first !== undefined && lexicon.questionOpeners.has(first);
}

/** The two v1 questions (asked or said as a statement: "última mamada"), about today only. */
function askCommand(words: readonly string[], lexicon: Lexicon): ParseResult | null {
  if (anyIn(words, lexicon.otherDays) || anySeq(words, lexicon.otherDaySeqs)) return null;
  const aboutFeeds = anyIn(words, lexicon.feedTopic);
  const lastOrSince =
    anyIn(words, lexicon.last) ||
    anySeq(words, lexicon.sinceQuestion) ||
    anyIn(words, lexicon.when);
  if (aboutFeeds && lastOrSince) return command({ kind: 'ask_last_feed' });
  if (anySeq(words, lexicon.amountQuestion) && anyIn(words, lexicon.milkTopic)) {
    return command({ kind: 'ask_milk_today' });
  }
  return null;
}

/** "para a mamada", "pare de mamar": "para" is a stop verb only right before a feed word. */
function weakStopBeforeFeed(words: readonly string[], lexicon: Lexicon): boolean {
  const feedWord = (word: string | undefined) =>
    word !== undefined && (lexicon.feed.has(word) || lexicon.breast.has(word));
  return words.some((word, index) => {
    if (!lexicon.weakStop.has(word)) return false;
    const next = words[index + 1];
    const skip = next === 'de' || next === 'a' || next === 'o';
    return feedWord(skip ? words[index + 2] : next);
  });
}

function bareStop(running: ParseContext['running']): ParseResult {
  const nursing = running?.nursing === true;
  const sleep = running?.sleep === true;
  if (nursing && sleep) return { outcome: 'ambiguous', choices: ['nursing_stop', 'sleep_end'] };
  if (nursing) return command({ kind: 'nursing_stop' });
  if (sleep) return command({ kind: 'sleep_end' });
  return notUnderstood('no_running');
}

function bottleCommand(
  words: readonly string[],
  numbers: readonly SpokenNumber[],
  units: UnitSystem,
): ParseResult {
  const formula = words.includes(FORMULA);
  const breastMilk = words.includes(BREAST_MILK);
  if (formula && breastMilk) return notUnderstood('content_conflict');
  const content: BottleContent | null = formula ? 'formula' : breastMilk ? 'breast_milk' : null;
  if (numbers.length === 0) return { outcome: 'needs_amount' };
  if (numbers.length > 1) return notUnderstood('ambiguous_amount');
  const [spoken] = numbers;
  const unit = spoken.unit ?? (units === 'us' ? 'oz' : 'ml');
  const amountMl =
    unit === 'oz'
      ? flOzToMl(spoken.value)
      : Math.round(unit === 'l' ? spoken.value * 1000 : spoken.value);
  if (amountMl < BOTTLE_MIN_ML || amountMl > BOTTLE_MAX_ML) {
    return { outcome: 'out_of_range', amountMl };
  }
  return command({ kind: 'bottle', amountMl, content });
}

type Intent = 'bottle' | 'nursing_start' | 'nursing_stop' | 'sleep_start' | 'sleep_end' | 'diaper';

interface Reading {
  intents: Intent[];
  diaper: DiaperKind | null;
  side: BreastSide | 'both' | null;
}

/** Which commands the words name, before any slot is checked. */
function readIntents(
  words: readonly string[],
  numbers: readonly SpokenNumber[],
  lexicon: Lexicon,
): Reading {
  const has = (set: ReadonlySet<string>) => anyIn(words, set);
  const diaperWord = has(lexicon.diaper);
  const wet = has(lexicon.wet) || (diaperWord && has(lexicon.wetWithDiaper));
  const dirty = has(lexicon.dirty) || (diaperWord && has(lexicon.dirtyWithDiaper));
  const both = (diaperWord && has(lexicon.bothWithDiaper)) || (wet && dirty);
  const diaper: DiaperKind | null = both ? 'both' : wet ? 'wet' : dirty ? 'dirty' : null;

  const startVerb = has(lexicon.start);
  const stopVerb = has(lexicon.stop) || weakStopBeforeFeed(words, lexicon);
  // A past feed verb ("mamou no peito esquerdo") names nursing too; the statement check refuses it.
  const feedWord = has(lexicon.breast) || has(lexicon.feed) || has(lexicon.pastFeed);
  const left = has(lexicon.left);
  const right = has(lexicon.right);
  const onlySide = words.every(
    (w) =>
      lexicon.fillers.has(w) ||
      lexicon.left.has(w) ||
      lexicon.right.has(w) ||
      lexicon.sideNouns.has(w),
  );
  const sideCounts = (left || right) && (feedWord || has(lexicon.sideNouns) || onlySide);
  const nursingStop = anySeq(words, lexicon.nursingStopSeqs) || (stopVerb && feedWord);
  const nursingStart =
    !nursingStop && (has(lexicon.breast) || (startVerb && has(lexicon.feed)) || sideCounts);

  const sleepObject = has(lexicon.sleepObjects);
  const sleepStart =
    has(lexicon.sleepStart) || anySeq(words, lexicon.sleepStartSeqs) || (startVerb && sleepObject);
  const sleepEnd =
    has(lexicon.sleepEnd) || anySeq(words, lexicon.sleepEndSeqs) || (stopVerb && sleepObject);

  const amountSaid =
    numbers.length > 0 &&
    (numbers.some((n) => n.unit !== null) || has(lexicon.milk) || has(lexicon.drink));
  const bottle = has(lexicon.bottle) || amountSaid;

  const intents: Intent[] = [];
  if (bottle) intents.push('bottle');
  if (nursingStop) intents.push('nursing_stop');
  else if (nursingStart) intents.push('nursing_start');
  if (sleepStart) intents.push('sleep_start');
  if (sleepEnd) intents.push('sleep_end');
  if (diaper || diaperWord) intents.push('diaper');
  const side = left && right ? 'both' : left ? 'left' : right ? 'right' : null;
  return { intents, diaper, side: sideCounts ? side : null };
}

function statement(
  words: readonly string[],
  numbers: readonly SpokenNumber[],
  context: ParseContext,
  lexicon: Lexicon,
): ParseResult {
  const { intents, diaper, side } = readIntents(words, numbers, lexicon);
  if (intents.length === 0) {
    const onlyStop =
      anyIn(words, lexicon.bareStop) &&
      words.every((w) => lexicon.fillers.has(w) || lexicon.bareStop.has(w));
    return onlyStop ? bareStop(context.running) : notUnderstood('no_intent');
  }
  if (intents.length > 1) return notUnderstood('conflict');
  const [intent] = intents;
  if (intent === 'bottle') return bottleCommand(words, numbers, context.units);
  if (numbers.length > 0) return notUnderstood('stray_number');
  // "dormiu bem" is about a sleep that went by (in Portuguese "direito" there is not a side).
  const sleepIntent = intent === 'sleep_start' || intent === 'sleep_end';
  if (sleepIntent && anyIn(words, lexicon.quality)) return notUnderstood('report');
  switch (intent) {
    case 'diaper':
      return diaper ? command({ kind: 'diaper', diaper }) : notUnderstood('diaper_kind');
    case 'nursing_stop':
      return command({ kind: 'nursing_stop' });
    case 'nursing_start':
      if (anyIn(words, lexicon.pastFeed)) return notUnderstood('report');
      if (side === 'both') return notUnderstood('conflict');
      return command({ kind: 'nursing_start', side });
    case 'sleep_start':
      return command({ kind: 'sleep_start' });
    case 'sleep_end':
      return command({ kind: 'sleep_end' });
  }
}

/** One recognised sentence to a command, or the reason nothing may be logged. */
export function parseCommand(text: string, context: ParseContext): ParseResult {
  const lexicon = LEXICONS[context.locale];
  const isUnit = (word: string | undefined) =>
    word !== undefined && (hasOwn(lexicon.volumeUnits, word) || lexicon.timeUnits.has(word));
  const { tokens, words, questionMark, invalidNumber } = tokenize(text, context.locale, isUnit);
  if (words.length === 0) return notUnderstood('empty');
  if (anyIn(words, lexicon.negation)) return notUnderstood('negation');
  if (invalidNumber) return notUnderstood('invalid_number');
  const ask = askCommand(words, lexicon);
  if (isQuestion(words, questionMark, lexicon)) return ask ?? notUnderstood('question');
  if (ask) return ask;
  if (anyIn(words, lexicon.report) || anySeq(words, lexicon.reportSeqs)) {
    return notUnderstood('report');
  }
  const numbers = numbersOf(tokens, lexicon);
  if (numbers.some((n) => n.time)) return notUnderstood('time');
  return statement(words, numbers, context, lexicon);
}

export interface AlternativesResult {
  result: ParseResult;
  /** The alternative that gave the result (null: the list was empty). */
  index: number | null;
}

/** Results that end the walk down the n-best list: a command, or a reason to log nothing. */
const keepsLooking = (result: ParseResult) =>
  result.outcome === 'not_understood' &&
  (result.reason === 'no_intent' || result.reason === 'empty');

/**
 * The recogniser's n-best list, best first, to one result: the first alternative that is a command,
 * unless a better-ranked one already said why nothing may be logged ("não dormiu" above "dormiu" logs
 * nothing). Alternatives with no command words at all are skipped.
 */
export function parseAlternatives(
  alternatives: readonly string[],
  context: ParseContext,
): AlternativesResult {
  let firstSkipped: AlternativesResult | null = null;
  for (let index = 0; index < alternatives.length; index += 1) {
    const result = parseCommand(alternatives[index], context);
    if (!keepsLooking(result)) return { result, index };
    firstSkipped ??= { result, index };
  }
  return firstSkipped ?? { result: notUnderstood('empty'), index: null };
}

/** Whether a command writes an entry (the two questions only read). */
export function isLoggingCommand(value: HandsFreeCommand): boolean {
  return value.kind !== 'ask_milk_today' && value.kind !== 'ask_last_feed';
}

/** Same kind and every slot equal. */
export function sameCommand(a: HandsFreeCommand, b: HandsFreeCommand): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'bottle':
      return b.kind === 'bottle' && a.amountMl === b.amountMl && a.content === b.content;
    case 'nursing_start':
      return b.kind === 'nursing_start' && a.side === b.side;
    case 'diaper':
      return b.kind === 'diaper' && a.diaper === b.diaper;
    default:
      return true;
  }
}
