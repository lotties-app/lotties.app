import { describe, expect, it } from 'vitest';
import { useTestLocale } from '../test/locale';
import { factSentence, factSentences } from './cryReasonsText';

/* Every fact of the ranking becomes one sentence through the catalog (no inferred words). */

describe('cry reason fact sentences', () => {
  it.each([
    [
      { kind: 'sinceLastFeed', minutes: 160, usualGapMinutes: 150 },
      'Last fed 2h 40m ago; she usually goes about 2h 30m.',
    ],
    [{ kind: 'sinceLastFeed', minutes: 45, usualGapMinutes: null }, 'Last fed 45m ago.'],
    [{ kind: 'feedingNow', minutes: 10 }, 'A feed is running, started 10m ago.'],
    [
      { kind: 'awakeFor', minutes: 95, windowMinutes: 90 },
      'Awake for 1h 35m; she usually stays up about 1h 30m.',
    ],
    [{ kind: 'awakeFor', minutes: 30, windowMinutes: null }, 'Awake for 30m.'],
    [{ kind: 'nightTime' }, 'It is night time.'],
    [
      { kind: 'sinceLastDiaper', minutes: 200, usualGapMinutes: 150 },
      'Last diaper 3h 20m ago; she usually goes about 2h 30m.',
    ],
    [{ kind: 'sinceLastDiaper', minutes: 60, usualGapMinutes: null }, 'Last diaper 1h ago.'],
    [
      { kind: 'dirtyDue', signal: 'afterFeed', expectedAt: '2026-10-23T18:00:00.000Z' },
      'A dirty diaper often comes about now after a feed.',
    ],
    [{ kind: 'recentFeedNoBurp', minutesSinceFeed: 12 }, 'Fed 12m ago, with no burp logged since.'],
    [
      { kind: 'reliefAfterFeed', minutesSinceFeed: 5 },
      'Fed 5m ago, and a burp or massage was logged.',
    ],
    [{ kind: 'bellyPattern', typicalClock: '18:00' }, 'Belly pain often shows up around 18:00.'],
    [{ kind: 'eveningFussy', typicalClock: '19:30' }, 'Fussiness often starts around 19:30.'],
    [{ kind: 'eveningFussy', typicalClock: null }, 'Evenings are a common fussy time at this age.'],
    [{ kind: 'noData', reason: 'noLog' }, 'Not enough logged yet.'],
    [
      { kind: 'noData', reason: 'asleep' },
      'A sleep timer is still running, so the log may be behind.',
    ],
  ] as const)('%o reads "%s"', (fact, expected) => {
    expect(factSentence(fact)).toBe(expected);
  });

  it('the gap signal of a dirty diaper names the expected time', () => {
    expect(
      factSentence({ kind: 'dirtyDue', signal: 'gap', expectedAt: '2026-10-23T18:05:00.000Z' }),
    ).toMatch(/^A dirty diaper may come around \d{2}:\d{2}\.$/);
  });

  it('keeps at most two sentences per cause', () => {
    expect(
      factSentences([
        { kind: 'recentFeedNoBurp', minutesSinceFeed: 12 },
        { kind: 'bellyPattern', typicalClock: '18:00' },
        { kind: 'eveningFussy', typicalClock: null },
      ]),
    ).toHaveLength(2);
    expect(factSentences([])).toEqual([]);
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    expect(factSentence({ kind: 'sinceLastFeed', minutes: 160, usualGapMinutes: 150 })).toBe(
      'Última mamada há 2 h 40 min; ela costuma ficar cerca de 2 h 30 min entre mamadas.',
    );
    expect(factSentence({ kind: 'noData', reason: 'noLog' })).toBe(
      'Ainda não há registros suficientes.',
    );
  });
});
