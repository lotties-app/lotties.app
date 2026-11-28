import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload } from '../db/models';
import { todayStats } from '../now/todayStats';
import {
  BUILT_IN_TYPES,
  DIAPER_T,
  FEEDING_T,
  SLEEP,
  event,
  eventType,
} from '../presets/presetFixtures';
import {
  MAX_DAYS_BACK,
  clockOn,
  daySummary,
  earliestDay,
  hasDaySummaryData,
  queryFrom,
  shownBreast,
} from './daySummaryModel';

const HOUR = 3_600_000;
const MIN = 60_000;
/** Local instants around "today" (21 Oct 2026, a Wednesday). */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 + day, hour, minute).toISOString();
const NOW = new Date(2026, 9, 21, 15, 0);
const TODAY = new Date(2026, 9, 21);
const YESTERDAY = new Date(2026, 9, 20);

let seq = 0;
function make(
  typeId: string,
  start: string,
  end: string | null,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  seq += 1;
  return event({ id: `d${seq}`, typeId, startedAt: start, endedAt: end, payload, ...extra });
}
const nap = (start: string, end: string | null, payload: EventPayload = {}) =>
  make(SLEEP, start, end, { kind: 'nap', ...payload });
const night = (start: string, end: string | null, payload: EventPayload = {}) =>
  make(SLEEP, start, end, { kind: 'night', ...payload });
const feed = (start: string, end: string | null, payload: EventPayload) =>
  make(FEEDING_T, start, end, payload);
const bottle = (start: string, end: string | null, prepared?: number, drunk?: number) =>
  feed(start, end, {
    method: 'bottle',
    ...(prepared !== undefined ? { amount_ml: prepared } : {}),
    ...(drunk !== undefined ? { amount_drunk_ml: drunk } : {}),
  });
const diaper = (start: string, content: string) => make(DIAPER_T, start, start, { content });

const summary = (events: BabyEvent[], day = TODAY, now = NOW) =>
  daySummary(events, BUILT_IN_TYPES, day, now);

describe('sleep of the day', () => {
  it('counts the night that ended on the day whole, even when it started the evening before', () => {
    const s = summary([night(at(-1, 20), at(0, 6)), nap(at(0, 9), at(0, 10, 30))]);
    expect(s.sleep?.nightMs).toBe(10 * HOUR);
    expect(s.sleep?.naps).toEqual({ count: 1, ms: 90 * MIN, longestMs: null });
    expect(s.sleep?.totalMs).toBe(11.5 * HOUR);
    // Yesterday did not get that night: it ended today.
    expect(summary([night(at(-1, 20), at(0, 6))], YESTERDAY).sleep).toBeNull();
  });

  it('takes the latest night that ended on the day', () => {
    const s = summary([night(at(-1, 20), at(0, 1)), night(at(0, 2), at(0, 6))]);
    expect(s.sleep?.nightMs).toBe(4 * HOUR);
  });

  it('leaves pauses out and shows the longest of two or more naps', () => {
    const s = summary([
      nap(at(0, 9), at(0, 10), { paused_seconds: 600, pause_count: 1 }),
      nap(at(0, 12), at(0, 13, 30)),
    ]);
    expect(s.sleep?.naps).toEqual({ count: 2, ms: 50 * MIN + 90 * MIN, longestMs: 90 * MIN });
  });

  it('counts a running nap up to now and says asleep for', () => {
    const s = summary([night(at(-1, 20), at(0, 6)), nap(at(0, 14, 20), null)]);
    expect(s.sleep?.naps.ms).toBe(40 * MIN);
    expect(s.sleep?.current).toEqual({ state: 'asleep', ms: 40 * MIN });
  });

  it('does not count a running night that started today, but says asleep for', () => {
    const evening = new Date(2026, 9, 21, 21, 0);
    const s = summary([nap(at(0, 13), at(0, 14)), night(at(0, 20), null)], TODAY, evening);
    expect(s.sleep?.totalMs).toBe(HOUR);
    expect(s.sleep?.nightMs).toBeNull();
    expect(s.sleep?.current).toEqual({ state: 'asleep', ms: HOUR });
    // A running night alone still shows the card (asleep for).
    const only = summary([night(at(0, 20), null)], TODAY, evening);
    expect(only.sleep?.totalMs).toBe(0);
    expect(only.sleep?.current?.state).toBe('asleep');
  });

  it('says awake for since the last sleep ended, today only', () => {
    const events = [night(at(-1, 20), at(0, 6)), nap(at(0, 12), at(0, 13, 15))];
    expect(summary(events).sleep?.current).toEqual({ state: 'awake', ms: 105 * MIN });
    expect(summary([nap(at(-1, 12), at(-1, 13))], YESTERDAY).sleep?.current).toBeNull();
  });

  it('measures a past day whole', () => {
    const s = summary([night(at(-2, 20), at(-1, 6)), nap(at(-1, 16), at(-1, 17))], YESTERDAY);
    expect(s.isToday).toBe(false);
    expect(s.sleep?.totalMs).toBe(11 * HOUR);
  });

  it('ignores markers and night wakings', () => {
    const s = summary([
      make(SLEEP, at(0, 8), at(0, 8), { kind: 'bed_time' }),
      make(SLEEP, at(0, 2), at(0, 3), { kind: 'night_waking' }),
    ]);
    expect(s.sleep).toBeNull();
  });
});

describe('feeding of the day', () => {
  it('uses the Now Milk today rule: finished bottles only, drunk capped, untouched counts', () => {
    const events = [
      bottle(at(0, 7), at(0, 7, 20), 120, 100),
      bottle(at(0, 10), at(0, 10, 15), 100, 140),
      bottle(at(0, 12), at(0, 12, 10), 90, 0),
      bottle(at(0, 14, 30), null, 150),
      feed(at(0, 9), at(0, 9, 20), { method: 'breast' }),
    ];
    const s = summary(events);
    expect(s.feeding?.milk).toEqual({ drunkMl: 200, preparedMl: 310 });
    // The same value and feed count as the Now screen.
    const now = todayStats(events, BUILT_IN_TYPES, NOW);
    expect(s.feeding?.milk).toEqual(now.milk);
    expect(s.feeding?.feeds).toBe(now.feeds);
    expect(s.feeding?.feeds).toBe(5);
    expect(s.feeding?.lastFeedAt).toBe(at(0, 14, 30));
    expect(s.feeding?.usualMetric).toBe('ml');
  });

  it('falls back to the feed count without bottle amounts, solids included, pumping never', () => {
    const s = summary([
      feed(at(0, 8), at(0, 8, 15), { method: 'breast' }),
      feed(at(0, 12), at(0, 12, 10), { method: 'solid', food: 'banana' }),
      make('type-pump', at(0, 13), at(0, 13, 20), { amount_left_ml: 60 }),
    ]);
    expect(s.feeding?.feeds).toBe(2);
    expect(s.feeding?.milk).toBeNull();
    expect(s.feeding?.usualMetric).toBe('feeds');
    // Pumping is not in the other kinds either.
    expect(s.health).toBeNull();
  });

  it('adds up breast time and the sides when the payload has them', () => {
    const s = summary([
      feed(at(0, 8), at(0, 8, 20), {
        method: 'breast',
        breast_left_seconds: 600,
        breast_right_seconds: 480,
      }),
      feed(at(0, 11), at(0, 11, 10), { method: 'breast' }),
    ]);
    // 2 minutes of the first feed and the whole second one have no side.
    expect(s.feeding?.breast).toEqual({
      totalMs: 30 * MIN,
      leftMs: 600_000,
      rightMs: 480_000,
      unsidedMs: 12 * MIN,
      hasSides: true,
    });
    expect(shownBreast(s.feeding!.breast!)).toEqual({ total: 30, left: 10, right: 8, unsided: 12 });
  });

  it('counts a feed whose sides add up to more than its effective time at its sides', () => {
    const s = summary([
      feed(at(0, 8), at(0, 8, 10), {
        method: 'breast',
        breast_left_seconds: 400,
        breast_right_seconds: 300,
      }),
    ]);
    expect(s.feeding?.breast).toMatchObject({ totalMs: 700_000, unsidedMs: 0 });
  });
});

describe('breast time as shown', () => {
  const time = (left: number, right: number, unsided: number) => ({
    totalMs: (left + right + unsided) * MIN,
    leftMs: left * MIN,
    rightMs: right * MIN,
    unsidedMs: unsided * MIN,
    hasSides: left + right > 0,
  });

  it('rounds the total once and shares it, so the parts add up as shown', () => {
    // 20.6 + 7.6 = 28.2: shown 28 = 21 + 7, never 21 + 8.
    expect(shownBreast(time(20.6, 7.6, 0))).toEqual({ total: 28, left: 21, right: 7, unsided: 0 });
    expect(shownBreast(time(9.5, 9.5, 0))).toEqual({ total: 19, left: 10, right: 9, unsided: 0 });
    expect(shownBreast(time(0.4, 0.4, 0.4))).toEqual({ total: 1, left: 1, right: 0, unsided: 0 });
  });

  it('keeps the sum equal to the total for many splits', () => {
    for (let i = 0; i < 200; i++) {
      const parts = [((i * 37) % 97) / 7, ((i * 53) % 89) / 9, ((i * 11) % 31) / 5];
      const shown = shownBreast(time(parts[0], parts[1], parts[2]));
      expect(shown.left + shown.right + shown.unsided).toBe(shown.total);
      expect(shown.total).toBe(Math.round(parts[0] + parts[1] + parts[2]));
    }
  });
});

describe('diapers, crying and care', () => {
  it('counts a mixed diaper as wet and dirty', () => {
    const s = summary([
      diaper(at(0, 7), 'WET'),
      diaper(at(0, 9), 'MIXED'),
      diaper(at(0, 11), 'dirty'),
    ]);
    expect(s.diapers).toMatchObject({ total: 3, wet: 2, dirty: 2, mixed: 1, hasContent: true });
  });

  it('counts crying spells and their timed length', () => {
    const s = summary([
      make('type-fussy', at(0, 9), at(0, 9, 20)),
      make('type-fussy', at(0, 11), at(0, 11)),
      make('type-fussy', at(0, 14, 50), null),
    ]);
    expect(s.crying).toMatchObject({ spells: 3, totalMs: 30 * MIN });
    expect(summary([make('type-fussy', at(0, 11), at(0, 11))]).crying?.totalMs).toBeNull();
  });

  it('shows the latest temperature, a dose count and the other kinds, custom ones by name', () => {
    const custom = eventType({ id: 'type-custom', key: 'custom_vitamin_sun', name: 'Sunbath' });
    custom.babyId = 'baby-1';
    const types = [...BUILT_IN_TYPES, custom];
    const events = [
      make('type-temperature', at(0, 8), at(0, 8), { value_c: 37.2 }),
      make('type-temperature', at(0, 12), at(0, 12), { value_c: 37.9 }),
      make('type-med', at(0, 9), at(0, 9), {
        medications: [
          { medicationId: 'm1', name: 'Secret', dose: { amount: 5, unit: 'ml' } },
          { medicationId: 'm2', name: 'Other' },
        ],
      }),
      make('type-med', at(0, 13), at(0, 13), {}),
      make('type-tummy', at(0, 10), at(0, 10, 10)),
      make('type-tummy', at(0, 11), at(0, 11, 5)),
      make('type-bath', at(0, 14), at(0, 14), {}, { notes: 'never shown' }),
      make('type-custom', at(0, 12, 30), at(0, 12, 30)),
    ];
    const s = daySummary(events, types, TODAY, NOW);
    expect(s.health?.temperature).toEqual({ valueC: 37.9, at: at(0, 12) });
    expect(s.health?.medicationDoses).toBe(3);
    expect(s.health?.others).toEqual([
      { typeId: 'type-tummy', count: 2, durationMs: 15 * MIN },
      { typeId: 'type-bath', count: 1, durationMs: null },
      { typeId: 'type-custom', count: 1, durationMs: null },
    ]);
    expect(JSON.stringify(s)).not.toMatch(/Secret|never shown|amount/);
  });

  it('hides everything on an empty day', () => {
    const s = summary([diaper(at(-1, 9), 'WET')]);
    expect(hasDaySummaryData(s)).toBe(false);
  });

  it('ignores deleted and future events', () => {
    const s = summary([
      diaper(at(0, 9), 'WET'),
      make(DIAPER_T, at(0, 10), at(0, 10), { content: 'WET' }, { deletedAt: at(0, 11) }),
      diaper(at(0, 16), 'WET'),
    ]);
    expect(s.diapers?.total).toBe(1);
  });
});

describe('usual by this time', () => {
  /** A diaper at 09:00 and one at 18:00 on `day` days before today. */
  const diaperDay = (day: number) => [diaper(at(day, 9), 'WET'), diaper(at(day, 18), 'WET')];

  it('needs three recorded days', () => {
    const two = [...diaperDay(-1), ...diaperDay(-2), diaper(at(0, 8), 'WET')];
    expect(summary(two).diapers?.usual).toBeNull();
    const three = [...two, ...diaperDay(-3)];
    // Up to 15:00 each of those days had one diaper.
    expect(summary(three).diapers?.usual).toEqual({ value: 1, days: 3 });
  });

  it('leaves unlogged days out and counts a recorded day with nothing by then as zero', () => {
    const events = [
      ...diaperDay(-1),
      ...diaperDay(-4),
      // Logged only in the evening: recorded, nothing before 15:00.
      diaper(at(-6, 20), 'WET'),
      diaper(at(0, 8), 'WET'),
    ];
    expect(summary(events).diapers?.usual).toEqual({ value: 2 / 3, days: 3 });
  });

  it('only looks at the seven days before the viewed day', () => {
    const events = [...diaperDay(-8), ...diaperDay(-9), ...diaperDay(-10), diaper(at(0, 8), 'WET')];
    expect(summary(events).diapers?.usual).toBeNull();
  });

  it('compares whole days when a past day is viewed', () => {
    const events = [...diaperDay(-2), ...diaperDay(-3), ...diaperDay(-4), diaper(at(-1, 8), 'WET')];
    expect(summary(events, YESTERDAY).diapers?.usual).toEqual({ value: 2, days: 3 });
  });

  it('measures sleep by then: the night that ended before, nap minutes elapsed before', () => {
    const day = (d: number) => [
      night(at(d - 1, 20), at(d, 6)),
      // 14:30-15:30: only 30 minutes had elapsed by 15:00.
      nap(at(d, 14, 30), at(d, 15, 30)),
      nap(at(d, 17), at(d, 18)),
    ];
    const events = [...day(-1), ...day(-2), ...day(-3), nap(at(0, 9), at(0, 10))];
    const usual = summary(events).sleep?.usual;
    expect(usual).toEqual({ value: 10.5 * HOUR, days: 3 });
    // Viewing yesterday, the days before it are whole: 10 h night + 2 h naps (only 2 such days).
    const past = summary([...events, ...day(-4)], YESTERDAY).sleep?.usual;
    expect(past).toEqual({ value: 12 * HOUR, days: 3 });
  });

  it('measures ml by then: bottles started and finished by the clock time', () => {
    const day = (d: number) => [
      bottle(at(d, 9), at(d, 9, 20), 120),
      // Running at 15:00 on that day: not counted by then.
      bottle(at(d, 14, 50), at(d, 15, 10), 100),
      bottle(at(d, 19), at(d, 19, 20), 150),
    ];
    const events = [...day(-1), ...day(-2), ...day(-3), bottle(at(0, 9), at(0, 9, 15), 90)];
    const s = summary(events);
    expect(s.feeding?.usualMetric).toBe('ml');
    expect(s.feeding?.usual).toEqual({ value: 120, days: 3 });
  });

  it('counts feeds when the headline is the feed count, days without feeds left out', () => {
    const breast = (d: number, h: number) => feed(at(d, h), at(d, h, 15), { method: 'breast' });
    const events = [
      breast(-1, 8),
      breast(-1, 12),
      breast(-1, 16),
      breast(-2, 8),
      breast(-3, 8),
      breast(-3, 11),
      breast(0, 8),
      // A diaper-only day is not a feeding day.
      diaper(at(-5, 9), 'WET'),
    ];
    expect(summary(events).feeding?.usual).toEqual({ value: 5 / 3, days: 3 });
  });

  it('counts crying spells by then', () => {
    const spell = (d: number, h: number) => make('type-fussy', at(d, h), at(d, h, 10));
    const events = [spell(-1, 10), spell(-1, 19), spell(-2, 11), spell(-3, 20), spell(0, 9)];
    expect(summary(events).crying?.usual).toEqual({ value: 2 / 3, days: 3 });
  });
});

describe('days on a DST change', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  beforeAll(() => {
    // Lisbon springs forward on 29 March 2026 at 01:00 (a 23-hour day).
    process.env.TZ = 'Europe/Lisbon';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  it('cuts each past day at the same local clock time, not 24-hour steps', () => {
    const now = new Date(2026, 2, 30, 15, 0);
    const cut = clockOn(new Date(2026, 2, 29), now);
    expect(cut.getHours()).toBe(15);
    expect(now.getTime() - cut.getTime()).toBe(24 * HOUR);
    // From the 28th to the 29th at 15:00 crosses the spring-forward night: 23 real hours.
    expect(cut.getTime() - clockOn(new Date(2026, 2, 28), now).getTime()).toBe(23 * HOUR);
  });

  it('counts the usual by local clock time across the change', () => {
    const d = (day: number, h: number, m = 0) => new Date(2026, 2, 30 + day, h, m).toISOString();
    const events = [
      // 14:30 counts, 15:30 does not, on each of the three days (the 29th is 23 hours long).
      make(DIAPER_T, d(-1, 14, 30), d(-1, 14, 30), { content: 'WET' }),
      make(DIAPER_T, d(-1, 15, 30), d(-1, 15, 30), { content: 'WET' }),
      make(DIAPER_T, d(-2, 14, 30), d(-2, 14, 30), { content: 'WET' }),
      make(DIAPER_T, d(-2, 15, 30), d(-2, 15, 30), { content: 'WET' }),
      make(DIAPER_T, d(-3, 14, 30), d(-3, 14, 30), { content: 'WET' }),
      make(DIAPER_T, d(-3, 15, 30), d(-3, 15, 30), { content: 'WET' }),
      make(DIAPER_T, d(0, 9), d(0, 9), { content: 'WET' }),
    ];
    const now = new Date(2026, 2, 30, 15, 0);
    const s = daySummary(events, BUILT_IN_TYPES, new Date(2026, 2, 30), now);
    expect(s.diapers?.usual).toEqual({ value: 1, days: 3 });
  });

  it('keeps a night across the change whole on the day it ended', () => {
    const s = daySummary(
      [night(new Date(2026, 2, 28, 22).toISOString(), new Date(2026, 2, 29, 7).toISOString())],
      BUILT_IN_TYPES,
      new Date(2026, 2, 29),
      new Date(2026, 2, 29, 12),
    );
    // 22:00 to 07:00 across the spring-forward night is 8 real hours.
    expect(s.sleep?.nightMs).toBe(8 * HOUR);
  });
});

describe('navigation bounds', () => {
  it('reaches back at most MAX_DAYS_BACK days, never before the first logged day', () => {
    expect(earliestDay(NOW, null).getTime()).toBe(TODAY.getTime());
    expect(earliestDay(NOW, at(-3, 10)).getTime()).toBe(new Date(2026, 9, 18).getTime());
    expect(earliestDay(NOW, at(-200, 10)).getTime()).toBe(
      new Date(2026, 9, 21 - MAX_DAYS_BACK).getTime(),
    );
  });

  it('loads the earliest day, its usual days and the night before them', () => {
    expect(queryFrom(NOW)).toBe(new Date(2026, 9, 21 - MAX_DAYS_BACK - 8).toISOString());
  });
});
