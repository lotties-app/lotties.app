import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import {
  addDays,
  categoriesOf,
  dayBounds,
  dayValue,
  eventsOfDay,
  filterByCategory,
  isSameDay,
  parseDayValue,
  queryRange,
  summarizeDay,
} from './dayModel';

const types = [FEEDING_TYPE, SLEEP_TYPE, DIAPER_TYPE];
const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const DAY = new Date(2026, 9, 20, 15, 0);

let counter = 0;
function event(overrides: Partial<BabyEvent>): BabyEvent {
  counter += 1;
  return {
    id: `e${counter}`,
    babyId: 'baby-1',
    typeId: FEEDING_TYPE.id,
    startedAt: local(20, 8),
    endedAt: null,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: local(20, 8),
    updatedAt: local(20, 8),
    deletedAt: null,
    ...overrides,
  };
}
const sleep = (startedAt: string, endedAt: string | null, kind = 'nap') =>
  event({ typeId: SLEEP_TYPE.id, startedAt, endedAt, payload: { kind } });

describe('day boundaries', () => {
  it('spans local midnight to local midnight, also across a month end', () => {
    const { start, end } = dayBounds(new Date(2026, 9, 31, 22, 30));
    expect(start).toEqual(new Date(2026, 9, 31));
    expect(end).toEqual(new Date(2026, 10, 1));
    expect(addDays(new Date(2026, 9, 31), 1)).toEqual(new Date(2026, 10, 1));
    expect(isSameDay(new Date(2026, 9, 20, 1), new Date(2026, 9, 20, 23))).toBe(true);
  });

  it('round-trips the date field value and rejects non-dates', () => {
    expect(dayValue(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(parseDayValue('2026-01-05')).toEqual(new Date(2026, 0, 5));
    expect(parseDayValue('2026-02-31')).toBeNull();
    expect(parseDayValue('')).toBeNull();
  });

  it('queries from a day before the day, so a night that started yesterday reaches in', () => {
    const range = queryRange(dayBounds(DAY));
    expect(range.to).toBe(local(21, 0));
    expect(Date.parse(range.from)).toBeLessThan(Date.parse(local(19, 12)));
  });
});

describe('eventsOfDay', () => {
  it('keeps live events that started on the day, newest first', () => {
    const events = [
      event({ startedAt: local(20, 9) }),
      event({ startedAt: local(20, 0, 5) }),
      event({ startedAt: local(19, 23, 55) }),
      event({ startedAt: local(21, 0) }),
      event({ startedAt: local(20, 12), deletedAt: local(20, 13) }),
    ];
    expect(eventsOfDay(events, dayBounds(DAY)).map((e) => e.startedAt)).toEqual([
      local(20, 9),
      local(20, 0, 5),
    ]);
  });
});

describe('summarizeDay', () => {
  const bounds = dayBounds(DAY);

  it('counts feeds and diapers that started on the day and sleeps the part inside it', () => {
    const summary = summarizeDay(
      [
        sleep(local(19, 20), local(20, 6)),
        sleep(local(20, 12), local(20, 13, 30)),
        event({ startedAt: local(20, 7) }),
        event({ startedAt: local(20, 10) }),
        event({ typeId: DIAPER_TYPE.id, startedAt: local(20, 11), payload: { content: 'WET' } }),
        event({ startedAt: local(19, 10) }),
      ],
      types,
      bounds,
      new Date(2026, 9, 20, 18),
    );
    expect(summary.sleepMinutes).toBe(6 * 60 + 90);
    expect(summary.feeds).toBe(2);
    expect(summary.diapers).toBe(1);
  });

  it('counts a running sleep until now and clips a night to the day end', () => {
    const now = new Date(2026, 9, 20, 15);
    expect(summarizeDay([sleep(local(20, 14), null)], types, bounds, now).sleepMinutes).toBe(60);
    const night = summarizeDay([sleep(local(20, 21), local(21, 6), 'night')], types, bounds, now);
    expect(night.sleepMinutes).toBe(3 * 60);
    expect(night.spans[0].to).toBe(1);
  });

  it('puts sleep stretches and event ticks on the ribbon as fractions of the day', () => {
    const summary = summarizeDay(
      [
        sleep(local(20, 6), local(20, 12)),
        sleep(local(20, 3), local(20, 3, 20), 'night_waking'),
        event({ startedAt: local(20, 18) }),
      ],
      types,
      bounds,
      new Date(2026, 9, 20, 23),
    );
    expect(summary.spans).toHaveLength(2);
    expect(summary.spans.find((s) => s.category === 'sleep')).toMatchObject({
      from: 0.25,
      to: 0.5,
    });
    expect(summary.spans.some((s) => s.category === 'nightWaking')).toBe(true);
    expect(summary.sleepMinutes).toBe(360);
    expect(summary.ticks).toEqual([expect.objectContaining({ at: 0.75, category: 'feeding' })]);
  });

  it('does not count wake-up markers as sleep', () => {
    const summary = summarizeDay(
      [sleep(local(20, 6), local(20, 6), 'woke_up')],
      types,
      bounds,
      new Date(2026, 9, 20, 23),
    );
    expect(summary.sleepMinutes).toBe(0);
    expect(summary.spans).toEqual([]);
  });
});

describe('category filter', () => {
  it('lists the categories the types have and filters the events by them', () => {
    expect(categoriesOf(types)).toEqual(['sleep', 'feeding', 'diaper']);
    const events = [
      event({}),
      event({ typeId: DIAPER_TYPE.id }),
      sleep(local(20, 9), local(20, 10)),
    ];
    expect(filterByCategory(events, types, new Set())).toHaveLength(3);
    expect(filterByCategory(events, types, new Set(['diaper', 'sleep'] as const))).toHaveLength(2);
  });
});
