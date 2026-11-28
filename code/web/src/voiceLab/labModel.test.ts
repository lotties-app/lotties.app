import { describe, expect, it } from 'vitest';
import type { ListenResult } from '../platform/speechTypes';
import {
  addAttempt,
  buildExport,
  countsAsAttempt,
  evaluate,
  exportFileName,
  summary,
  type PhraseRecord,
  type RunSelection,
} from './labModel';
import { LAB_PHRASES, type LabPhrase } from './labPhrases';

/* The lab's measures (docs/design/49a-voice-lab.md; design 49 section 7.4). */

const AT = new Date('2026-11-28T10:15:00Z');
const pt = (number: number): LabPhrase => LAB_PHRASES['pt-BR'][number - 1];

function heard(alternatives: string[], latencyMs: number | null = 800): ListenResult {
  return {
    alternatives,
    confidences: alternatives.map(() => null),
    startedAt: 1000,
    endOfSpeechAt: latencyMs === null ? null : 5000,
    resultAt: 5000 + (latencyMs ?? 0),
    onDevice: true,
  };
}

const attempt = (phrase: LabPhrase, alternatives: string[], latencyMs: number | null = 800) =>
  evaluate(phrase, phrase.expected, { listen: heard(alternatives, latencyMs), error: null }, AT);

const RUN: RunSelection = { engine: 'on_device', condition: 'C1', locale: 'pt-BR' };

describe('evaluate', () => {
  it('passes the exact command and times end of speech to result', () => {
    const a = attempt(pt(1), ['mamadeira de 120 ml']);
    expect(a).toMatchObject({ pass: true, wrongAction: false, wrongAmount: false, latencyMs: 800 });
    expect(a.producedText).toBe(true);
  });

  it('counts a different amount as a wrong action with a wrong amount', () => {
    const a = attempt(pt(3), ['mamadeira de cento e cinco mililitros']);
    expect(a).toMatchObject({ pass: false, wrongAction: true, wrongAmount: true });
  });

  it('counts a different command as wrong, "not understood" as a plain failure', () => {
    expect(attempt(pt(14), ['dormiu'])).toMatchObject({ pass: false, wrongAction: true });
    expect(attempt(pt(14), ['a cordou'])).toMatchObject({ pass: false, wrongAction: false });
  });

  it('passes phrases 22 to 24 only when nothing would be logged', () => {
    expect(attempt(pt(22), ['mamadeira']).pass).toBe(true);
    expect(attempt(pt(23), ['que horas são']).pass).toBe(true);
    expect(attempt(pt(24), ['ela está chorando muito']).pass).toBe(true);
    expect(attempt(pt(22), ['mamadeira de 2'])).toMatchObject({ pass: false, wrongAction: true });
  });

  it('records a recognition error as a failed attempt with no text and no latency', () => {
    const a = evaluate(pt(1), pt(1).expected, { listen: null, error: 'no_match' }, AT);
    expect(a).toMatchObject({
      pass: false,
      producedText: false,
      latencyMs: null,
      error: 'no_match',
    });
    expect(countsAsAttempt('no_match')).toBe(true);
    expect(countsAsAttempt('denied')).toBe(false);
    expect(countsAsAttempt('on_device_unavailable')).toBe(false);
    expect(countsAsAttempt('cancelled')).toBe(false);
  });

  it('judges a free try against nothing', () => {
    const a = evaluate(pt(1), null, { listen: heard(['dormiu']), error: null }, AT);
    expect(a).toMatchObject({ pass: false, wrongAction: false });
    expect(a.result).toEqual({ outcome: 'command', command: { kind: 'sleep_start' } });
  });
});

describe('retries', () => {
  it('replace the attempt shown but never the first one, and are counted', () => {
    let records: PhraseRecord[] = [];
    records = addAttempt(records, RUN, pt(1), attempt(pt(1), ['mamadeira de 20 ml']));
    records = addAttempt(records, RUN, pt(1), attempt(pt(1), ['mamadeira de 120 ml']));
    records = addAttempt(records, RUN, pt(1), attempt(pt(1), ['mamadeira de 120 ml']));
    expect(records).toHaveLength(1);
    expect(records[0].first.pass).toBe(false);
    expect(records[0].latest.pass).toBe(true);
    expect(records[0].retries).toBe(2);
    const [row] = summary(records);
    expect(row).toMatchObject({ attempts: 1, passed: 0, accuracy: 0, wrongActions: 1, retries: 2 });
  });

  it('keep runs apart by condition and language', () => {
    let records: PhraseRecord[] = [];
    records = addAttempt(records, RUN, pt(1), attempt(pt(1), ['mamadeira de 120 ml']));
    records = addAttempt(records, { ...RUN, locale: 'en' }, pt(1), attempt(pt(1), ['x']));
    records = addAttempt(records, { ...RUN, condition: 'C2' }, pt(1), attempt(pt(1), ['x']));
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.retries === 0)).toBe(true);
  });
});

describe('summary', () => {
  function run(condition: RunSelection['condition'], heardBy: (p: LabPhrase) => string[]) {
    let records: PhraseRecord[] = [];
    LAB_PHRASES['pt-BR'].forEach((phrase, i) => {
      records = addAttempt(
        records,
        { ...RUN, condition },
        phrase,
        attempt(phrase, heardBy(phrase), 500 + i * 100),
      );
    });
    return records;
  }

  it('gives accuracy, wrong actions, phrases 22-24, latency median and 90th percentile', () => {
    const records = run('C1', (p) => (p.number === 3 ? ['mamadeira de 105'] : [p.text]));
    const [row] = summary(records);
    expect(row).toMatchObject({
      engine: 'on_device',
      condition: 'C1',
      locale: 'pt-BR',
      attempts: 24,
      passed: 23,
      wrongActions: 1,
      wrongAmounts: 1,
      nonePhrases: 3,
      noneLogged: 0,
      producedText: 24,
    });
    expect(row.accuracy).toBeCloseTo(23 / 24);
    // Latencies 500, 600, ... 2800 ms: nearest-rank median is the 12th, the 90th percentile the 22nd.
    expect(row.latencyMedianMs).toBe(1600);
    expect(row.latencyP90Ms).toBe(2600);
  });

  it('adds an all-conditions row per engine once there are two conditions', () => {
    const records = [...run('C1', (p) => [p.text]), ...run('C3', (p) => [p.text])];
    const rows = summary(records);
    expect(rows.map((r) => r.condition)).toEqual(['C1', 'C3', 'all']);
    expect(rows[2].attempts).toBe(48);
  });
});

describe('export', () => {
  it('holds the phrases, both attempts, the retries and the summary, nothing else', () => {
    const records = addAttempt([], RUN, pt(12), attempt(pt(12), ['dormiu']));
    const file = buildExport(
      records,
      {},
      { version: '0.1.0', commit: 'abc', platform: 'android', osVersion: '15' },
      AT,
    );
    expect(Object.keys(file).sort()).toEqual(
      [
        'app',
        'attempts',
        'capabilities',
        'exportedAt',
        'format',
        'hints',
        'summary',
        'version',
      ].sort(),
    );
    expect(file.attempts).toHaveLength(1);
    expect(file.attempts[0]).toMatchObject({
      phraseId: 'pt-12',
      phraseNumber: 12,
      phrase: 'dormiu',
      engine: 'on_device',
      condition: 'C1',
      retries: 0,
    });
    expect(file.summary).toHaveLength(1);
  });

  it('names the file after the local time', () => {
    expect(exportFileName(new Date(2026, 10, 28, 4, 5))).toBe(
      'lotties-voice-lab-20261128-0405.json',
    );
  });
});
