import {
  isLoggingCommand,
  parseAlternatives,
  sameCommand,
  type ParseResult,
} from '../voice/commandParser';
import type { SpeechLocale } from '../voice/numberWords';
import type {
  ListenResult,
  SpeechCapabilities,
  SpeechEngineKind,
  SpeechErrorCode,
} from '../platform/speechTypes';
import type { LabCondition, LabExpectation, LabPhrase } from './labPhrases';

/*
 * The voice lab's results (docs/design/49a-voice-lab.md): one attempt per phrase, engine, condition and
 * language, kept in memory only. A retry replaces the attempt shown but never the first one, which is
 * what the measures of design 49 section 7.4 count, and the retries are counted, so a failure that was
 * retried stays visible. Pure: no storage, no network, no clock (the caller passes times).
 */

/** Recognition errors that are a result of the attempt (they count); the others are setup problems. */
const ATTEMPT_ERRORS: ReadonlySet<SpeechErrorCode> = new Set([
  'no_match',
  'speech_timeout',
  'network',
  'audio',
  'timeout',
  'recognizer_error',
]);

/** Whether an error ends an attempt that counts (no text, nothing understood) or only stops this try. */
export const countsAsAttempt = (code: SpeechErrorCode) => ATTEMPT_ERRORS.has(code);

export interface Attempt {
  alternatives: string[];
  confidences: (number | null)[];
  result: ParseResult;
  /** The alternative the result came from (null: none). */
  matchedIndex: number | null;
  pass: boolean;
  /** A command would have been logged that is not the expected one. */
  wrongAction: boolean;
  /** A bottle would have been logged with an amount that was not said. */
  wrongAmount: boolean;
  producedText: boolean;
  /** End of speech (as the engine reports it) to the parsed result. */
  latencyMs: number | null;
  error: SpeechErrorCode | null;
  onDevice: boolean | null;
  /** ISO time of the attempt. */
  at: string;
}

export interface PhraseRecord {
  key: string;
  phrase: LabPhrase;
  engine: SpeechEngineKind;
  condition: LabCondition;
  /** Counted by the measures. */
  first: Attempt;
  /** Shown on screen. */
  latest: Attempt;
  retries: number;
}

export interface RunSelection {
  engine: SpeechEngineKind;
  condition: LabCondition;
  locale: SpeechLocale;
}

export const recordKey = (run: RunSelection, phraseId: string) =>
  `${run.engine}|${run.condition}|${run.locale}|${phraseId}`;

function judge(expected: LabExpectation, result: ParseResult) {
  const logged =
    result.outcome === 'command' && isLoggingCommand(result.command) ? result.command : null;
  const expectedCommand = expected.type === 'command' ? expected.command : null;
  const pass =
    expectedCommand !== null
      ? result.outcome === 'command' && sameCommand(result.command, expectedCommand)
      : logged === null;
  const wrongAction =
    logged !== null && !(expectedCommand !== null && sameCommand(logged, expectedCommand));
  const wrongAmount =
    wrongAction &&
    logged?.kind === 'bottle' &&
    !(expectedCommand?.kind === 'bottle' && expectedCommand.amountMl === logged.amountMl);
  return { pass, wrongAction, wrongAmount };
}

export interface Heard {
  listen: ListenResult | null;
  error: SpeechErrorCode | null;
  /** Milliseconds the parser took (added to the engine's latency). */
  parseMs?: number;
}

/** Parses what the engine heard and judges it against `expected` (null: a free try). */
export function evaluate(
  phrase: Pick<LabPhrase, 'locale' | 'units'>,
  expected: LabExpectation | null,
  heard: Heard,
  at: Date,
): Attempt {
  const alternatives = heard.listen?.alternatives ?? [];
  const { result, index } = parseAlternatives(alternatives, {
    locale: phrase.locale,
    units: phrase.units,
  });
  const verdict = expected
    ? judge(expected, result)
    : { pass: false, wrongAction: false, wrongAmount: false };
  const listen = heard.listen;
  const latencyMs =
    listen && listen.endOfSpeechAt !== null
      ? Math.max(0, listen.resultAt - listen.endOfSpeechAt) + Math.round(heard.parseMs ?? 0)
      : null;
  return {
    alternatives,
    confidences: listen?.confidences ?? [],
    result,
    matchedIndex: index,
    ...verdict,
    producedText: alternatives.some((text) => text.trim() !== ''),
    latencyMs,
    error: heard.error,
    onDevice: listen?.onDevice ?? null,
    at: at.toISOString(),
  };
}

/** Adds an attempt: the first one of a phrase stays, later ones are retries. */
export function addAttempt(
  records: readonly PhraseRecord[],
  run: RunSelection,
  phrase: LabPhrase,
  attempt: Attempt,
): PhraseRecord[] {
  const key = recordKey(run, phrase.id);
  const existing = records.find((record) => record.key === key);
  if (!existing) {
    return [
      ...records,
      {
        key,
        phrase,
        engine: run.engine,
        condition: run.condition,
        first: attempt,
        latest: attempt,
        retries: 0,
      },
    ];
  }
  return records.map((record) =>
    record === existing ? { ...record, latest: attempt, retries: record.retries + 1 } : record,
  );
}

export interface SummaryRow {
  engine: SpeechEngineKind;
  condition: LabCondition | 'all';
  locale: SpeechLocale;
  attempts: number;
  passed: number;
  /** 0-1, null without attempts. */
  accuracy: number | null;
  wrongActions: number;
  wrongActionRate: number | null;
  wrongAmounts: number;
  /** Phrases that must log nothing (22-24), and how many did log. */
  nonePhrases: number;
  noneLogged: number;
  latencyMedianMs: number | null;
  latencyP90Ms: number | null;
  producedText: number;
  retries: number;
}

/** Nearest-rank percentile of a sorted list. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function summarize(
  rows: readonly PhraseRecord[],
  head: Pick<SummaryRow, 'engine' | 'condition' | 'locale'>,
): SummaryRow {
  const firsts = rows.map((row) => row.first);
  const latencies = firsts
    .map((a) => a.latencyMs)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);
  const passed = firsts.filter((a) => a.pass).length;
  const wrongActions = firsts.filter((a) => a.wrongAction).length;
  const none = rows.filter((row) => row.phrase.expected.type === 'none');
  const ratio = (n: number) => (firsts.length > 0 ? n / firsts.length : null);
  return {
    ...head,
    attempts: firsts.length,
    passed,
    accuracy: ratio(passed),
    wrongActions,
    wrongActionRate: ratio(wrongActions),
    wrongAmounts: firsts.filter((a) => a.wrongAmount).length,
    nonePhrases: none.length,
    noneLogged: none.filter((row) => row.first.wrongAction).length,
    latencyMedianMs: percentile(latencies, 50),
    latencyP90Ms: percentile(latencies, 90),
    producedText: firsts.filter((a) => a.producedText).length,
    retries: rows.reduce((sum, row) => sum + row.retries, 0),
  };
}

/** One row per engine, language and condition, plus an "all conditions" row per engine and language. */
export function summary(records: readonly PhraseRecord[]): SummaryRow[] {
  const groups = new Map<string, PhraseRecord[]>();
  for (const record of records) {
    const key = `${record.engine}|${record.phrase.locale}|${record.condition}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const rows: SummaryRow[] = [];
  const engines = new Map<string, PhraseRecord[]>();
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [engine, locale, condition] = key.split('|') as [
      SpeechEngineKind,
      SpeechLocale,
      LabCondition,
    ];
    rows.push(summarize(group, { engine, locale, condition }));
    const engineKey = `${engine}|${locale}`;
    engines.set(engineKey, [...(engines.get(engineKey) ?? []), ...group]);
  }
  for (const [key, group] of engines) {
    const conditions = new Set(group.map((record) => record.condition));
    if (conditions.size < 2) continue;
    const [engine, locale] = key.split('|') as [SpeechEngineKind, SpeechLocale];
    rows.push(summarize(group, { engine, locale, condition: 'all' }));
  }
  return rows;
}

/** Section 7.4 thresholds. */
export const THRESHOLDS = {
  accuracy: { C1: 0.9, C2: 0.8, C3: 0.8 } as Readonly<Partial<Record<LabCondition, number>>>,
  wrongActionRate: 0.02,
  latencyMedianMs: 1500,
  latencyP90Ms: 3000,
} as const;

export interface LabExport {
  format: 'lotties-voice-lab';
  version: 1;
  exportedAt: string;
  app: { version: string; commit: string; platform: string; osVersion: string | null };
  /** What the phone reported, per language, when the export was made. */
  capabilities: Partial<Record<SpeechLocale, SpeechCapabilities>>;
  hints: boolean;
  attempts: {
    phraseId: string;
    phraseNumber: number;
    locale: SpeechLocale;
    units: string;
    phrase: string;
    expected: LabExpectation;
    engine: SpeechEngineKind;
    condition: LabCondition;
    retries: number;
    first: Attempt;
    latest: Attempt;
  }[];
  summary: SummaryRow[];
}

/**
 * The export file: the test phrases' attempts and the summary. Free tries are never in it (anything
 * could have been said), nor anything about a baby.
 */
export function buildExport(
  records: readonly PhraseRecord[],
  capabilities: Partial<Record<SpeechLocale, SpeechCapabilities>>,
  app: LabExport['app'],
  at: Date,
): LabExport {
  return {
    format: 'lotties-voice-lab',
    version: 1,
    exportedAt: at.toISOString(),
    app,
    capabilities,
    hints: true,
    attempts: records.map((record) => ({
      phraseId: record.phrase.id,
      phraseNumber: record.phrase.number,
      locale: record.phrase.locale,
      units: record.phrase.units,
      phrase: record.phrase.text,
      expected: record.phrase.expected,
      engine: record.engine,
      condition: record.condition,
      retries: record.retries,
      first: record.first,
      latest: record.latest,
    })),
    summary: summary(records),
  };
}

/** `lotties-voice-lab-20261128-0415.json` (local time). */
export function exportFileName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `lotties-voice-lab-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(
    at.getHours(),
  )}${pad(at.getMinutes())}.json`;
}
