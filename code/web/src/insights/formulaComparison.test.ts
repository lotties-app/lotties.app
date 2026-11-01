import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload, EventType, Formula } from '../db/models';
import { DIAPER_TYPE, FEEDING_TYPE, FUSSY_TYPE } from '../test/builtInTypes';
import {
  compareFormulas,
  formulaReadiness,
  weightForDay,
  type WeightPoint,
} from './formulaComparison';

/*
 * The Formulas insight model on a pinned clock (21 Oct 2026, 15:00 local): periods per formula,
 * the 7 days / 20 bottles rule, mixed days, belly pains after a bottle, weights, day bucketing.
 */

const NOW = new Date(2026, 9, 21, 15, 0);
const BELLY_PAIN_TYPE: EventType = {
  ...FUSSY_TYPE,
  id: 'type-belly-pain',
  key: 'belly_pain',
  name: 'Belly pain',
  hasDuration: false,
  fields: [],
};
const BUILT_IN_TYPES = [FEEDING_TYPE, DIAPER_TYPE, FUSSY_TYPE, BELLY_PAIN_TYPE];
const typeId = (key: string) => BUILT_IN_TYPES.find((t) => t.key === key)!.id;
let seq = 0;

const at = (back: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 - back, hour, minute).toISOString();

function make(type: string, start: string, payload: EventPayload = {}, end = start): BabyEvent {
  seq += 1;
  return {
    id: `f-${seq}`,
    babyId: 'b1',
    typeId: typeId(type),
    startedAt: start,
    endedAt: end,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
}

const bottle = (start: string, formulaId: string, ml?: number, name?: string) =>
  make('feeding', start, {
    method: 'bottle',
    bottle_feeding_type: 'formula',
    formula_id: formulaId,
    ...(name ? { formula_name: name } : {}),
    ...(ml ? { amount_ml: ml } : {}),
  });

const formula = (id: string, name: string): Formula => ({
  id,
  babyId: 'b1',
  name,
  brand: null,
  stage: null,
  notes: null,
  startedOn: null,
  isCurrent: false,
  archived: false,
  createdBy: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

const FORMULAS = [formula('a', 'Nan 1'), formula('b', 'Aptamil 2')];

/** `bottles` bottles of `formulaId` (120 ml) on each day from `from` back to `to` back. */
function days(formulaId: string, from: number, to: number, bottles = 3): BabyEvent[] {
  const events: BabyEvent[] = [];
  for (let back = from; back >= to; back--) {
    for (let i = 0; i < bottles; i++) events.push(bottle(at(back, 8 + i * 4), formulaId, 120));
  }
  return events;
}

const compare = (events: BabyEvent[], weights: WeightPoint[] = [], formulas = FORMULAS) =>
  compareFormulas({ events, types: BUILT_IN_TYPES, formulas, weights, now: NOW });

describe('periods and the unlock rule', () => {
  it('compares two formulas used one after the other, most recent first', () => {
    const events = [
      ...days('a', 20, 11), // Nan 1: 10 days, 30 bottles
      ...days('b', 10, 1), // Aptamil 2: 10 days, 30 bottles
      make('belly_pain', at(15, 18), { intensity: 3 }),
      make('belly_pain', at(14, 18), { intensity: 3 }),
      make('belly_pain', at(5, 18), { intensity: 2 }),
    ];

    const result = compare(events);

    expect(result.view).toBe('compare');
    expect(result.qualified.map((p) => p.name)).toEqual(['Aptamil 2', 'Nan 1']);
    const [apt, nan] = result.qualified;
    expect(apt.days).toHaveLength(10);
    expect(apt.bottles).toBe(30);
    expect(apt.metrics.bottlesPerDay).toBe(3);
    expect(apt.metrics.mlPerDay).toBe(360);
    expect(apt.metrics.bellyPainsPerDay).toBeCloseTo(0.1);
    expect(nan.metrics.bellyPainsPerDay).toBeCloseTo(0.2);
    expect(apt.first.getDate()).toBe(11);
    expect(apt.last.getDate()).toBe(20);
  });

  it('needs at least 7 days and 20 bottles: otherwise readiness, day 4 of 7', () => {
    const fewDays = compare([...days('a', 4, 1), ...days('a', 4, 1)]); // 4 days, 24 bottles
    const fewBottles = compare(days('a', 8, 1, 2)); // 8 days, 16 bottles

    expect(fewDays.view).toBe('collecting');
    expect(formulaReadiness(fewDays.periods[0])).toMatchObject({
      days: 4,
      daysLeft: 3,
      progress: 4 / 7,
    });
    expect(fewBottles.view).toBe('collecting');
    expect(formulaReadiness(fewBottles.periods[0])).toMatchObject({ daysLeft: 0, bottlesLeft: 4 });
    expect(compare([]).view).toBe('none');
  });

  it('one qualifying formula is a single view; a second one still collecting is not compared', () => {
    const result = compare([...days('a', 12, 3), ...days('b', 2, 0)]);

    expect(result.view).toBe('single');
    expect(result.qualified.map((p) => p.formulaId)).toEqual(['a']);
    expect(result.periods.map((p) => p.formulaId)).toEqual(['b', 'a']);
  });

  it('counts a mixed day for both formulas, each with its own bottles', () => {
    const events = [...days('a', 10, 2, 3), ...days('b', 10, 2, 3)];
    events.push(make('fussy', at(5, 19), {}, at(5, 19, 30)));

    const [first, second] = compare(events).qualified;

    expect(first.days).toHaveLength(9);
    expect(second.days).toHaveLength(9);
    expect(first.metrics.bottlesPerDay).toBe(3);
    expect(first.metrics.fussyPerDay).toBeCloseTo(1 / 9);
    expect(second.metrics.fussyPerDay).toBeCloseTo(1 / 9);
  });

  it('averages over finished days only (today counts for the unlock, not the averages)', () => {
    const result = compare([...days('a', 7, 1, 3), ...days('a', 0, 0, 1)]);
    const period = result.qualified[0];

    expect(period.days).toHaveLength(8);
    expect(period.averagedDays).toBe(7);
    expect(period.metrics.bottlesPerDay).toBe(3);
  });

  it('names an unknown formula by the newest name a bottle recorded', () => {
    const result = compare([bottle(at(1, 8), 'gone', 90, 'Similac 1')], [], []);
    expect(result.periods[0].name).toBe('Similac 1');
  });

  it('ignores deleted bottles, breast milk and bottles before the 30 days', () => {
    const deleted = { ...bottle(at(2, 8), 'a', 90), deletedAt: at(2, 9) };
    const breastMilk = make('feeding', at(2, 10), {
      method: 'bottle',
      bottle_feeding_type: 'breast_milk',
    });
    const old = bottle(at(31, 8), 'a', 90);
    expect(compare([deleted, breastMilk, old]).view).toBe('none');
  });
});

describe('belly pains after a bottle', () => {
  it('counts an episode starting within 2 h after the end of a bottle of that formula, once', () => {
    const events = [
      ...days('a', 10, 1, 3), // bottles at 08:00, 12:00, 16:00
      make('belly_pain', at(3, 9, 59), { intensity: 2 }), // 1 h 59 after 08:00: counts
      make('belly_pain', at(3, 10, 1), { intensity: 2 }), // 2 h 01 after 08:00: day only
      make('belly_pain', at(4, 13), { intensity: 2 }), // after 12:00: counts once (not twice)
    ];

    const period = compare(events).qualified[0];
    const day = (back: number) => period.days.find((d) => d.start.getDate() === 21 - back)!;

    expect([day(3).bellyPains, day(3).bellyPainsAfterBottle]).toEqual([2, 1]);
    expect([day(4).bellyPains, day(4).bellyPainsAfterBottle]).toEqual([1, 1]);
  });

  it('measures from the end of a timed bottle', () => {
    const timed = make(
      'feeding',
      at(2, 8),
      { method: 'bottle', bottle_feeding_type: 'formula', formula_id: 'a', amount_ml: 100 },
      at(2, 8, 40),
    );
    const events = [
      ...days('a', 10, 3, 3),
      timed,
      make('belly_pain', at(2, 10, 30), { intensity: 1 }),
    ];

    const period = compare(events).qualified[0];

    expect(period.days.find((d) => d.start.getDate() === 19)!.bellyPainsAfterBottle).toBe(1);
  });

  it('puts a pain after midnight on the day of the late bottle', () => {
    const events = [
      ...days('a', 10, 3, 3),
      bottle(at(2, 23, 30), 'a', 120),
      make('belly_pain', at(1, 0, 30), { intensity: 2 }),
    ];

    const period = compare(events).qualified[0];
    const late = period.days.find((d) => d.start.getDate() === 19)!;

    expect(late).toMatchObject({ bottles: 1, bellyPains: 0, bellyPainsAfterBottle: 1 });
    expect(period.days.some((d) => d.start.getDate() === 20)).toBe(false);
  });
});

describe('ml per kg and weights', () => {
  it('uses the nearest weight before the day within 14 days, else the nearest after', () => {
    const weights = [
      { date: '2026-10-01', kg: 4 },
      { date: '2026-10-10', kg: 5 },
      { date: '2026-10-30', kg: 6 },
    ];
    expect(weightForDay(weights, '2026-10-12')).toBe(5);
    expect(weightForDay(weights, '2026-10-10')).toBe(5);
    expect(weightForDay([{ date: '2026-10-20', kg: 5.5 }], '2026-10-12')).toBe(5.5);
    expect(weightForDay([{ date: '2026-09-01', kg: 4 }], '2026-10-12')).toBeNull();
  });

  it('skips ml per kg without a weight near the days', () => {
    const events = days('a', 10, 1, 3);
    expect(compare(events).qualified[0].metrics.mlPerKgPerDay).toBeNull();
    const withWeight = compare(events, [{ date: '2026-10-11', kg: 4.5 }]).qualified[0];
    expect(withWeight.metrics.mlPerKgPerDay).toBeCloseTo(360 / 4.5);
    expect(withWeight.days[0].kg).toBe(4.5);
  });

  it('leaves ml empty when no bottle had an amount', () => {
    const events = days('a', 10, 1, 3).map((e) => ({
      ...e,
      payload: { method: 'bottle', bottle_feeding_type: 'formula', formula_id: 'a' },
    }));
    const period = compare(events).qualified[0];
    expect(period.metrics.mlPerDay).toBeNull();
    expect(period.metrics.bottlesPerDay).toBe(3);
  });
});

describe('dirty diapers', () => {
  it('counts dirty and mixed diapers per day', () => {
    const events = [
      ...days('a', 10, 1, 3),
      make('diaper', at(2, 9), { content: 'DIRTY' }),
      make('diaper', at(2, 11), { content: 'MIXED' }),
      make('diaper', at(2, 13), { content: 'WET' }),
    ];
    expect(DIAPER_TYPE.key).toBe('diaper');
    const period = compare(events).qualified[0];
    expect(period.days.find((d) => d.start.getDate() === 19)!.dirty).toBe(2);
    expect(period.metrics.dirtyPerDay).toBeCloseTo(0.2);
  });
});

describe('day bucketing on a DST day', () => {
  // The zone the suite runs in, restored by name (deleting TZ does not reset the cached zone).
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  beforeAll(() => {
    // Lisbon falls back on 25 October 2026 at 02:00 (a 25-hour day).
    process.env.TZ = 'Europe/Lisbon';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  it('buckets bottles by real local days around the change', () => {
    const now = new Date(2026, 9, 27, 12);
    const local = (day: number, hour: number, minute = 0) =>
      new Date(2026, 9, day, hour, minute).toISOString();
    const events: BabyEvent[] = [];
    for (let day = 18; day <= 26; day++) {
      for (const hour of [0, 12, 23])
        events.push(bottle(local(day, hour, hour === 23 ? 59 : 5), 'a', 100));
    }

    const result = compareFormulas({
      events,
      types: BUILT_IN_TYPES,
      formulas: FORMULAS,
      weights: [],
      now,
    });
    const period = result.qualified[0];

    expect(period.days.map((d) => d.key)).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(period.days.every((d) => d.bottles === 3)).toBe(true);
    expect(FEEDING_TYPE.fields.some((f) => f.key === 'formula_id')).toBe(true);
  });
});
