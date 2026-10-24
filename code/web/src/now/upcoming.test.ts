import { describe, expect, it } from 'vitest';
import type { BabyEvent, Prescription } from '../db/models';
import { atTimes, byParts, dose, every, asNeeded } from '../medications/prescriptionFixtures';
import { calculateMedicationStatus, type MedicationDose } from '../medications/statusCalculator';
import type {
  DiaperPredictionsDto,
  PredictionDto,
  PredictionsDto,
  TimeOfDayPatternDto,
} from '../sync/contract';
import { SHIPPED_AGE_NORMS } from '../test/ageNorms';
import {
  BELLY_MASSAGE_TYPE,
  DIAPER_TYPE,
  FEEDING_TYPE,
  FUSSY_TYPE,
  SLEEP_TYPE,
} from '../test/builtInTypes';
import { eventType } from '../presets/presetFixtures';
import { MAX_UPCOMING, upcomingToday, type UpcomingInput, type UpcomingItem } from './upcoming';

/*
 * "Next up" (now/upcoming.ts): golden cases on fixed local times (2026-10-21, a Wednesday), never
 * the wall clock. Every estimate comes from an existing one (the server's feeding prediction, the
 * cry ranker's feed gap, the diaper estimates, the pattern windows, the Meds calculator).
 */

const BELLY_PAIN_TYPE = eventType({ id: 't-belly-pain', key: 'belly_pain', name: 'Belly pain' });
const TYPES = [
  SLEEP_TYPE,
  FEEDING_TYPE,
  DIAPER_TYPE,
  BELLY_MASSAGE_TYPE,
  FUSSY_TYPE,
  BELLY_PAIN_TYPE,
];
const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m);
const NOW = at(14);
/** 30 days old on 2026-10-21: the published formula volume is 90-150 ml (30-61 days). */
const BIRTH = '2026-09-21';

let counter = 0;
function event(type: { id: string }, start: Date, payload: BabyEvent['payload'] = {}): BabyEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    babyId: 'b',
    typeId: type.id,
    startedAt: start.toISOString(),
    endedAt: start.toISOString(),
    payload,
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  };
}

const bottle = (start: Date, ml: number, drunk?: number) =>
  event(FEEDING_TYPE, start, {
    method: 'bottle',
    amount_ml: ml,
    ...(drunk !== undefined ? { amount_drunk_ml: drunk } : {}),
  });
const nursing = (start: Date) => event(FEEDING_TYPE, start, { method: 'breast', side: 'left' });

function predictions(over: Partial<PredictionsDto> = {}): PredictionsDto {
  return {
    babyId: 'b',
    generatedAt: at(13).toISOString(),
    predictions: [],
    insufficientData: [],
    ...over,
  };
}

function feedPrediction(earliest: Date, expected: Date, latest: Date): PredictionDto {
  return {
    typeKey: 'feeding',
    nextStart: {
      earliest: earliest.toISOString(),
      expected: expected.toISOString(),
      latest: latest.toISOString(),
    },
    expectedDuration: null,
    confidence: 'Medium',
    sampleCount: 24,
    reason: '',
    basis: { kind: 'StartInterval', medianGapMinutes: 180, lookBackDays: 7 },
  };
}

const PREDICTED = feedPrediction(at(15, 40), at(16, 10), at(16, 40));

const run = (over: Partial<UpcomingInput> = {}) =>
  upcomingToday({ events: [], types: TYPES, now: NOW, ...over });
const only = (items: UpcomingItem[], kind: UpcomingItem['kind']) =>
  items.filter((item) => item.kind === kind);

/** Bottles over the last two weeks: afternoons about 120 ml, nights about 100, mornings 150+. */
const HISTORY: BabyEvent[] = [
  bottle(at(13, 0, 20), 110),
  bottle(at(15, 30, 19), 120),
  bottle(at(14, 0, 17), 150, 120),
  bottle(at(16, 0, 15), 130),
  bottle(at(13, 30, 12), 140),
  bottle(at(23, 0, 20), 90),
  bottle(at(2, 0, 19), 100),
  bottle(at(23, 30, 16), 100),
  bottle(at(8, 0, 20), 150),
  bottle(at(9, 0, 18), 150),
  bottle(at(7, 0, 14), 160),
  // Older than 14 days: never counts.
  bottle(at(15, 0, 1), 300),
  bottle(at(15, 0, 2), 300),
];

describe('the next feed', () => {
  it('takes the time from the server and the amount from her afternoons', () => {
    const items = run({
      events: [bottle(at(12, 30), 120)],
      history: [...HISTORY, bottle(at(12, 30), 120)],
      predictions: predictions({ predictions: [PREDICTED] }),
    });
    const [feed] = only(items, 'feed');
    expect(feed.at).toEqual(at(16, 10));
    expect(feed.windowStart).toEqual(at(15, 40));
    expect(feed.windowEnd).toEqual(at(16, 40));
    expect(feed.confidence).toBe('medium');
    // Afternoon drunk amounts 110, 120, 120 (150 prepared, 120 drunk), 130, 140, 120 today.
    expect(feed.amountMl).toEqual({ low: 120, typical: 120, high: 130 });
    expect(feed.basis).toMatchObject({
      kind: 'feed',
      time: { kind: 'prediction', samples: 24 },
      method: 'bottle',
      dayPart: 'afternoon',
      due: false,
      amount: {
        kind: 'dayPart',
        dayPart: 'afternoon',
        samples: 6,
        days: 14,
        byPart: [
          { dayPart: 'morning', typicalMl: 150, samples: 3 },
          { dayPart: 'afternoon', typicalMl: 120, samples: 6 },
          { dayPart: 'night', typicalMl: 100, samples: 3 },
        ],
      },
    });
  });

  it('falls back to all her bottles, then the age norm, then no amount', () => {
    const server = predictions({ predictions: [PREDICTED] });
    const few = [bottle(at(8, 0, 20), 100), bottle(at(9, 0, 19), 110), bottle(at(23, 0, 18), 90)];
    const all = only(run({ events: few, predictions: server }), 'feed')[0];
    expect(all.amountMl).toEqual({ low: 100, typical: 100, high: 110 });
    expect(all.basis).toMatchObject({ amount: { kind: 'allBottles', samples: 3 } });
    expect(all.confidence).toBe('medium');

    const two = few.slice(0, 2);
    const norm = only(
      run({ events: two, predictions: server, birthDate: BIRTH, ageNorms: SHIPPED_AGE_NORMS }),
      'feed',
    )[0];
    expect(norm.amountMl).toEqual({ low: 90, typical: null, high: 150 });
    expect(norm.basis).toMatchObject({
      amount: { kind: 'ageNorm', normId: 'feed_volume_ml_per_feed.formula.30-61' },
    });
    expect(norm.confidence).toBe('low');

    const nothing = only(run({ events: two, predictions: server, birthDate: BIRTH }), 'feed')[0];
    expect(nothing.amountMl).toBeUndefined();
    expect(nothing.basis).toMatchObject({ amount: null, method: 'bottle' });
  });

  it('shows no amount when her feeds at that time are mostly nursing', () => {
    const events = [
      nursing(at(15, 0, 20)),
      nursing(at(16, 0, 19)),
      bottle(at(15, 30, 18), 90),
      ...HISTORY.slice(5),
    ];
    const [feed] = only(
      run({ events, predictions: predictions({ predictions: [PREDICTED] }) }),
      'feed',
    );
    expect(feed.amountMl).toBeUndefined();
    expect(feed.basis).toMatchObject({ method: 'breast', amount: null });
  });

  it('uses her usual gap at that part of the day when the server has no prediction', () => {
    // Afternoon sessions every 2h, the rest every 3h: the latest feed at 13:00.
    const starts = [
      at(12, 0, 19),
      at(14, 0, 19),
      at(16, 0, 19),
      at(18, 0, 19),
      at(12, 0, 20),
      at(14, 0, 20),
      at(16, 0, 20),
      at(19, 0, 20),
      at(22, 0, 20),
      at(1, 0),
      at(4, 0),
      at(7, 0),
      at(10, 0),
      at(13, 0),
    ];
    const [feed] = only(run({ events: starts.map((s) => bottle(s, 100)) }), 'feed');
    expect(feed.at).toEqual(at(15));
    expect(feed.windowStart).toBeUndefined();
    expect(feed.basis).toMatchObject({
      time: { kind: 'ownGap', gapMinutes: 120, dayPart: 'afternoon', samples: 6 },
    });
  });

  it('falls back to all gaps, the server basis gap, and the age norm only where allowed', () => {
    const regular = [at(1), at(4), at(7), at(10), at(13)].map((s) => bottle(s, 100));
    expect(only(run({ events: regular }), 'feed')[0].basis).toMatchObject({
      time: { kind: 'ownGap', gapMinutes: 180, dayPart: null, samples: 4 },
    });

    const lone = [bottle(at(12, 30), 100)];
    const basisOnly = predictions({
      predictions: [
        { ...PREDICTED, nextStart: { ...PREDICTED.nextStart, latest: at(13).toISOString() } },
      ],
    });
    const server = only(run({ events: lone, predictions: basisOnly }), 'feed')[0];
    expect(server.at).toEqual(at(15, 30));
    expect(server.basis).toMatchObject({ time: { kind: 'serverGap', gapMinutes: 180 } });

    // A breastfed newborn (under 4 weeks): the published gap; at 30 days nothing is guessed.
    const newborn = [nursing(at(12, 30))];
    const young = only(
      run({ events: newborn, birthDate: '2026-10-10', ageNorms: SHIPPED_AGE_NORMS }),
      'feed',
    )[0];
    expect(young.basis).toMatchObject({ time: { kind: 'ageNorm' }, method: 'breast' });
    expect(young.confidence).toBe('low');
    expect(
      only(run({ events: newborn, birthDate: BIRTH, ageNorms: SHIPPED_AGE_NORMS }), 'feed'),
    ).toEqual([]);
  });

  it('drops the predicted feed once one is logged inside its window', () => {
    const server = predictions({ predictions: [PREDICTED], generatedAt: at(12).toISOString() });
    const logged = [bottle(at(15, 45), 120)];
    const items = run({ events: logged, predictions: server, now: at(15, 50) });
    // No gap of her own and the server basis gap after the new feed instead.
    expect(only(items, 'feed')[0].basis).toMatchObject({ time: { kind: 'serverGap' } });
    expect(only(items, 'feed')[0].at).toEqual(at(18, 45));
    expect(only(run({ events: logged, now: at(15, 50) }), 'feed')).toEqual([]);
  });

  it('says "any time now" just past the usual gap and nothing long after it', () => {
    const regular = [at(22, 0, 20), at(1), at(4), at(7), at(10)].map((s) => bottle(s, 100));
    const [due] = only(run({ events: regular, now: at(13, 30) }), 'feed');
    expect(due.at).toEqual(at(13, 30));
    expect(due.basis).toMatchObject({ due: true });
    expect(only(run({ events: regular, now: at(16, 30) }), 'feed')).toEqual([]);
  });
});

describe('the next feed after a smaller bottle than usual (the cry ranker partial-feed rule)', () => {
  // Every 3 h, 100 ml each (her usual amount 100 ml, her usual gap 180 min): next at 16:00.
  const before = [at(1), at(4), at(7), at(10)].map((s) => bottle(s, 100));
  const lastBottle = (payload: BabyEvent['payload']) =>
    event(FEEDING_TYPE, at(13), { method: 'bottle', amount_ml: 100, ...payload });
  const feedAfter = (last: BabyEvent, over: Partial<UpcomingInput> = {}) =>
    only(run({ events: [...before, last], ...over }), 'feed')[0];

  it('is identical to before when there is no partial feed', () => {
    const full = feedAfter(lastBottle({}));
    expect(full.at).toEqual(at(16));
    expect(full.basis).not.toHaveProperty('partialFeed');
    // 80 of 100 ml is above the 70% line: still no partial feed.
    const most = feedAfter(lastBottle({ amount_drunk_ml: 80 }));
    expect(most.at).toEqual(at(16));
    expect(most.basis).not.toHaveProperty('partialFeed');
  });

  it('comes earlier by half the missing share of her usual gap', () => {
    // 60 of 100 ml: 20% earlier, 36 of 180 minutes.
    const feed = feedAfter(lastBottle({ amount_drunk_ml: 60 }));
    expect(feed.at).toEqual(at(15, 24));
    expect(feed.basis).toMatchObject({
      time: { kind: 'ownGap', gapMinutes: 180 },
      partialFeed: { drunkMl: 60, usualMl: 100, endedBySleep: false, minutesEarlier: 36 },
    });
    // The expected amount is not touched.
    expect(feed.amountMl).toEqual(feedAfter(lastBottle({})).amountMl);
  });

  it('is clamped at 30% of her usual gap', () => {
    const feed = feedAfter(lastBottle({ amount_drunk_ml: 10 }));
    expect(feed.at).toEqual(at(15, 6));
    expect(feed.basis).toMatchObject({ partialFeed: { drunkMl: 10, minutesEarlier: 54 } });
  });

  it('counts a bottle a sleep stopped once its drunk amount is known', () => {
    const feed = feedAfter(lastBottle({ amount_drunk_ml: 50, ended_by: 'sleep' }));
    expect(feed.at).toEqual(at(15, 15));
    expect(feed.basis).toMatchObject({
      partialFeed: { drunkMl: 50, usualMl: 100, endedBySleep: true, minutesEarlier: 45 },
    });
    // Unknown drunk amount: nothing is guessed.
    const unknown = feedAfter(lastBottle({ ended_by: 'sleep' }));
    expect(unknown.at).toEqual(at(16));
    expect(unknown.basis).not.toHaveProperty('partialFeed');
  });

  it('leaves the time unchanged after nursing', () => {
    const feed = feedAfter(nursing(at(13)));
    expect(feed.at).toEqual(at(16));
    expect(feed.basis).not.toHaveProperty('partialFeed');
  });

  it('opens the server window earlier and keeps its end', () => {
    const feed = feedAfter(lastBottle({ amount_drunk_ml: 40 }), {
      predictions: predictions({ predictions: [PREDICTED] }),
    });
    // 190 min to 16:10, clamped 30%: 57 minutes earlier.
    expect(feed.at).toEqual(at(15, 13));
    expect(feed.windowStart).toEqual(at(14, 43));
    expect(feed.windowEnd).toEqual(at(16, 40));
    expect(feed.basis).toMatchObject({
      time: { kind: 'prediction' },
      partialFeed: { minutesEarlier: 57 },
    });
  });
});

const RULE: DiaperPredictionsDto['rule'] = {
  wetLookBackDays: 7,
  minimumWetEvents: 8,
  dirtyLookBackDays: 14,
  minimumDirtyEvents: 3,
  lowerPercentile: 25,
  upperPercentile: 75,
  feedWindowMinutes: 180,
  minimumFeedPairs: 5,
  maximumLagSpreadMinutes: 40,
  leadMinutes: 20,
  graceMinutes: 40,
};

function diaper(gapCount: number, dirtyMedian = 1440): PredictionsDto {
  const gap = (anchor: Date, lower: number, median: number, upper: number) => ({
    anchorAt: anchor.toISOString(),
    nextStart: {
      earliest: anchor.toISOString(),
      expected: anchor.toISOString(),
      latest: anchor.toISOString(),
    },
    lowerGapMinutes: lower,
    medianGapMinutes: median,
    upperGapMinutes: upper,
    eventCount: gapCount + 1,
    gapCount,
    confidence: 'Medium' as const,
  });
  return predictions({
    diaper: {
      wet: gap(at(13), 130, 150, 170),
      dirty: {
        lastDirtyAt: at(18, 0, 20).toISOString(),
        gap: gap(at(18, 0, 20), dirtyMedian - 60, dirtyMedian, dirtyMedian + 60),
        afterFeed: null,
      },
      rule: RULE,
    },
  });
}

describe('diapers', () => {
  it('places the next wet diaper and the next poop with their windows', () => {
    const items = run({ predictions: diaper(5) });
    const [wet] = only(items, 'diaperWet');
    expect(wet).toMatchObject({ at: at(15, 30), windowStart: at(15, 10), windowEnd: at(15, 50) });
    const [dirty] = only(items, 'diaperDirty');
    expect(dirty).toMatchObject({ at: at(18), windowStart: at(17), windowEnd: at(19) });
    expect(dirty.basis).toMatchObject({ signal: 'gap', samples: 5, daily: true });
  });

  it('invents no poop time from fewer than 3 samples', () => {
    expect(only(run({ predictions: diaper(2) }), 'diaperDirty')).toEqual([]);
  });

  it('re-anchors at a diaper logged on the device and drops windows already past', () => {
    const wet = event(DIAPER_TYPE, at(13, 50), { content: 'WET' });
    expect(only(run({ predictions: diaper(5), events: [wet] }), 'diaperWet')[0].at).toEqual(
      at(16, 20),
    );
    expect(only(run({ predictions: diaper(5), now: at(16) }), 'diaperWet')).toEqual([]);
  });
});

function pattern(typeKey: string, over: Partial<TimeOfDayPatternDto> = {}): TimeOfDayPatternDto {
  return {
    typeKey,
    typicalClock: '18:30',
    windowStart: '18:00',
    windowEnd: '19:30',
    windowMinutes: 90,
    spreadMinutes: 20,
    confidence: 'High',
    eventDayCount: 6,
    recentDayCount: 5,
    timeZone: null,
    days: [],
    rule: {
      lookBackDays: 14,
      recentDays: 7,
      minimumRecentDays: 4,
      maximumSpreadMinutes: 45,
      minimumCoveragePercent: 60,
      leadMinutes: 45,
    },
    ...over,
  };
}

describe('patterns', () => {
  const both = predictions({
    patterns: [
      pattern('belly_pain'),
      pattern('fussy', { typicalClock: '20:00', windowStart: '19:30', windowEnd: '21:00' }),
    ],
  });

  it('shows the belly pain and fussy windows still ahead today', () => {
    const items = run({ predictions: both });
    expect(only(items, 'bellyPain')[0]).toMatchObject({
      at: at(18, 30),
      windowStart: at(18),
      windowEnd: at(19, 30),
      confidence: 'high',
      basis: { kind: 'pattern', typicalClock: '18:30', days: 6, due: false },
    });
    expect(only(items, 'fussy')[0].at).toEqual(at(20));
  });

  it('drops a window that passed or was handled, keeps an open one from now', () => {
    expect(only(run({ predictions: both, now: at(19, 40) }), 'bellyPain')).toEqual([]);
    const pain = event(BELLY_PAIN_TYPE, at(18, 5));
    expect(only(run({ predictions: both, now: at(18, 40), events: [pain] }), 'bellyPain')).toEqual(
      [],
    );
    const open = only(run({ predictions: both, now: at(18, 40) }), 'bellyPain')[0];
    expect(open).toMatchObject({ at: at(18, 40), basis: { due: true } });
  });

  it('shows nothing without a pattern', () => {
    expect(run({ predictions: predictions() })).toEqual([]);
  });
});

describe('medicines', () => {
  const offset = -NOW.getTimezoneOffset();
  const statuses = (list: Prescription[], doses: MedicationDose[] = [], now = NOW) =>
    calculateMedicationStatus({
      prescriptions: list,
      doses,
      now,
      utcOffsetMinutes: offset,
      weight: null,
    }).map((status) => ({ status, name: `Med ${status.prescription.medicationId}` }));

  it('lists the scheduled doses still ahead today, as prescribed', () => {
    const parts = byParts('a', ['morning', 'afternoon', 'evening'], {
      reminders: [{ part: 'evening', time: '19:00' }],
    });
    const times = atTimes('b', ['08:00', '20:00', '23:30']);
    const interval = every('c', 360);
    const items = run({
      medicines: statuses(
        [parts, times, interval, asNeeded('d', 240)],
        [dose(at(9), 'a'), dose(at(10), 'c')],
      ),
    });
    const medicine = only(items, 'medicine');
    expect(medicine.map((item) => [item.basis, item.at])).toEqual([
      [
        {
          kind: 'medicine',
          name: 'Med a',
          prescriptionId: parts.id,
          schedule: 'dayPart',
          dayPart: 'afternoon',
        },
        NOW,
      ],
      [
        {
          kind: 'medicine',
          name: 'Med c',
          prescriptionId: interval.id,
          schedule: 'interval',
          everyMinutes: 360,
        },
        at(16),
      ],
      [
        {
          kind: 'medicine',
          name: 'Med a',
          prescriptionId: parts.id,
          schedule: 'dayPart',
          dayPart: 'evening',
          reminderAt: at(19),
        },
        at(19),
      ],
      [{ kind: 'medicine', name: 'Med b', prescriptionId: times.id, schedule: 'time' }, at(20)],
      [{ kind: 'medicine', name: 'Med b', prescriptionId: times.id, schedule: 'time' }, at(23, 30)],
    ]);
    expect(medicine[0]).toMatchObject({
      windowStart: at(12),
      windowEnd: at(18),
      confidence: 'high',
    });
  });

  it('drops a part already given and a dose that is past (never "overdue")', () => {
    const parts = byParts('a', ['afternoon']);
    expect(only(run({ medicines: statuses([parts], [dose(at(13), 'a')]) }), 'medicine')).toEqual(
      [],
    );
    const late = every('c', 60);
    expect(only(run({ medicines: statuses([late], [dose(at(9), 'c')]) }), 'medicine')).toEqual([]);
  });
});

describe('the day', () => {
  it('keeps only today, in time order, at most 8', () => {
    const many = atTimes('b', [
      '14:10',
      '14:20',
      '14:30',
      '14:40',
      '14:50',
      '15:00',
      '15:10',
      '15:20',
      '15:30',
    ]);
    const offset = -NOW.getTimezoneOffset();
    const medicines = calculateMedicationStatus({
      prescriptions: [many],
      doses: [],
      now: NOW,
      utcOffsetMinutes: offset,
      weight: null,
    }).map((status) => ({ status, name: 'X' }));
    const items = run({ medicines, predictions: diaper(5) });
    expect(items).toHaveLength(MAX_UPCOMING);
    const times = items.map((item) => item.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('stops at local midnight (the real length of the day)', () => {
    const before = event(DIAPER_TYPE, at(21, 0), { content: 'WET' });
    const after = event(DIAPER_TYPE, at(22, 0), { content: 'WET' });
    const midnight = new Date(2026, 9, 22).getTime();
    // 21:00 + 2h30 is 23:30, still today; 22:00 + 2h30 is 00:30, tomorrow.
    expect(
      only(run({ predictions: diaper(5), events: [before], now: at(22, 10) }), 'diaperWet')[0].at,
    ).toEqual(at(23, 30));
    const late = run({ predictions: diaper(5), events: [after], now: at(22, 10) });
    expect(only(late, 'diaperWet')).toEqual([]);
    for (const item of late) expect(item.at.getTime()).toBeLessThan(midnight);
  });

  it('is nothing at all without any history or estimate', () => {
    expect(run()).toEqual([]);
  });
});
