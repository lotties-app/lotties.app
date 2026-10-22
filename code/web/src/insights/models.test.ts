import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BabyEvent, EventPayload } from '../db/models';
import { BUILT_IN_TYPES, DIAPER_T, FEEDING_T, SLEEP, event } from '../presets/presetFixtures';
import { completedDaysWithData, lastDays, localDay, median } from './days';
import { diaperSummary, diapersByDay } from './diaperModel';
import { feedGaps, feedingSummary, feedsByDay, MAX_FEED_GAP_MS } from './feedingModel';
import { rhythmRows, sleepAverages, sleepByDay, usualClock, usualTimes } from './sleepModel';

const HOUR = 3_600_000;
const MIN = 60_000;
/** Local instants around "today" (21 Oct 2026). */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, 21 + day, hour, minute).toISOString();
const NOW = new Date(2026, 9, 21, 15, 0);
const TODAY = localDay(NOW).key;

let seq = 0;
function make(
  typeId: string,
  start: string,
  end: string | null,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  seq += 1;
  return event({ id: `e${seq}`, typeId, startedAt: start, endedAt: end, payload, ...extra });
}
const sleep = (start: string, end: string | null, payload: EventPayload = { kind: 'nap' }) =>
  make(SLEEP, start, end, payload);

describe('local days', () => {
  it('lists the last days oldest first, ending today', () => {
    const days = lastDays(NOW, 3);
    expect(days.map((d) => d.key)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(days[2].start.getHours()).toBe(0);
  });

  it('averages over finished days, today only when it is the only one', () => {
    const days = [
      { key: '2026-10-20', v: 2 },
      { key: TODAY, v: 1 },
    ];
    expect(completedDaysWithData(days, (d) => d.v > 0, TODAY).map((d) => d.key)).toEqual([
      '2026-10-20',
    ]);
    expect(completedDaysWithData([days[1]], (d) => d.v > 0, TODAY)).toHaveLength(1);
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('sleep per day', () => {
  it('splits a night that crosses midnight between the two days', () => {
    const night = sleep(at(-2, 20), at(-1, 6), { kind: 'night' });
    const days = sleepByDay([night], BUILT_IN_TYPES, lastDays(new Date(2026, 9, 20, 12), 2), NOW);
    expect(days.map((d) => d.nightMs)).toEqual([4 * HOUR, 6 * HOUR]);
    expect(days.map((d) => d.napMs)).toEqual([0, 0]);
  });

  it('leaves pauses, markers, wakings and deleted events out and counts a running nap until now', () => {
    const events = [
      sleep(at(-1, 13), at(-1, 14), { kind: 'nap', paused_seconds: 600, pause_count: 1 }),
      sleep(at(-1, 6), at(-1, 6), { kind: 'woke_up' }),
      sleep(at(-1, 2), at(-1, 3), { kind: 'night_waking' }),
      make(SLEEP, at(-1, 9), at(-1, 10), { kind: 'nap' }, { deletedAt: at(-1, 11) }),
      sleep(at(0, 14), null),
    ];
    const days = sleepByDay(events, BUILT_IN_TYPES, lastDays(NOW, 2), NOW);
    expect(days.map((d) => d.napMs)).toEqual([50 * MIN, 60 * MIN]);
    expect(days.map((d) => d.nightMs)).toEqual([0, 0]);
  });

  it('averages finished days with sleep, not the unfinished today', () => {
    const events = [
      sleep(at(-2, 20), at(-1, 6), { kind: 'night' }),
      sleep(at(-1, 13), at(-1, 15)),
      sleep(at(0, 13), at(0, 14)),
    ];
    const days = sleepByDay(events, BUILT_IN_TYPES, lastDays(NOW, 3), NOW);
    const averages = sleepAverages(days, TODAY);
    // 19 Oct: 4 h of night; 20 Oct: 6 h of night and a 2 h nap; 21 Oct (today, not counted): 1 h.
    expect(averages).toEqual({ totalMs: 6 * HOUR, nightMs: 5 * HOUR, napMs: 1 * HOUR, days: 2 });
  });
});

describe('sleep per day on a DST day', () => {
  // The zone the suite runs in, restored by name (deleting TZ does not reset the cached zone).
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  beforeAll(() => {
    // Lisbon springs forward on 29 March 2026 at 01:00 (a 23-hour day).
    process.env.TZ = 'Europe/Lisbon';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  it('buckets by real local midnights', () => {
    const day = localDay(new Date(2026, 2, 29, 12));
    expect(day.end.getTime() - day.start.getTime()).toBe(23 * HOUR);
    // 22:00 on the 28th to 07:00 on the 29th is 8 real hours: 2 before midnight, 6 after.
    const night = sleep(
      new Date(2026, 2, 28, 22).toISOString(),
      new Date(2026, 2, 29, 7).toISOString(),
      { kind: 'night' },
    );
    const days = sleepByDay([night], BUILT_IN_TYPES, lastDays(new Date(2026, 2, 29, 12), 2), NOW);
    expect(days.map((d) => d.key)).toEqual(['2026-03-28', '2026-03-29']);
    expect(days.map((d) => d.nightMs)).toEqual([2 * HOUR, 6 * HOUR]);
  });
});

describe('sleep rhythm', () => {
  it('draws rows from 06:00 to 06:00, newest first, with wakings as their own spans', () => {
    const events = [
      sleep(at(-1, 19), at(0, 6), { kind: 'night' }),
      sleep(at(0, 2), at(0, 3), { kind: 'night_waking' }),
      sleep(at(-1, 12), at(-1, 13)),
      sleep(at(-1, 18, 30), at(-1, 18, 30), { kind: 'bed_time' }),
    ];
    const rows = rhythmRows(events, BUILT_IN_TYPES, lastDays(NOW, 2), NOW);
    expect(rows.map((r) => r.key)).toEqual([TODAY, '2026-10-20']);
    const yesterday = rows[1];
    const kinds = yesterday.spans.map((s) => [s.kind, s.from, s.to]);
    // 12:00-13:00 is 6/24 to 7/24 of the row; the night 19:00 to 06:00 ends the row; the waking
    // (02:00-03:00) is drawn last.
    expect(kinds).toEqual([
      ['nap', 0.25, 7 / 24],
      ['night', 13 / 24, 1],
      ['waking', 20 / 24, 21 / 24],
    ]);
    expect(yesterday.bedtime).toBe(at(-1, 18, 30));
    expect(rows[0].wake).toBe(at(0, 6));
  });

  it('takes bedtime from the night start without a marker and wake-up from a marker without a night', () => {
    const events = [
      sleep(at(-1, 20, 10), at(-1, 23)),
      sleep(at(-1, 20, 30), at(-1, 23, 30), { kind: 'night' }),
      sleep(at(0, 6, 40), at(0, 6, 40), { kind: 'woke_up' }),
    ];
    const rows = rhythmRows(events, BUILT_IN_TYPES, lastDays(NOW, 2), NOW);
    expect(rows[1].bedtime).toBe(at(-1, 20, 30));
    expect(rows[0].wake).toBe(at(0, 6, 40));
  });

  it('finds the usual clock time across midnight by measuring bedtimes from noon', () => {
    expect(usualClock([at(-2, 23, 30), at(-1, 0, 30)], true)).toBe(0);
    expect(usualClock([at(-2, 6), at(-1, 7)], false)).toBe(6 * 60 + 30);
    expect(usualClock([], true)).toBeNull();
    expect(usualTimes([])).toEqual({ bedtime: null, wake: null });
  });
});

describe('feeding', () => {
  const feeds = [
    // A stray amount on a breast feed is not bottle milk.
    make(FEEDING_T, at(-1, 6), at(-1, 6, 20), { method: 'breast', amount_ml: 60 }),
    make(FEEDING_T, at(-1, 9), at(-1, 9, 15), {
      method: 'bottle',
      amount_ml: 120,
      paused_seconds: 300,
      pause_count: 1,
    }),
    make(FEEDING_T, at(-1, 12), at(-1, 12), { method: 'bottle', amount_ml: 90 }),
    make(FEEDING_T, at(-1, 23), at(-1, 23, 20), { method: 'bottle' }),
    make(FEEDING_T, at(-1, 13), at(-1, 13, 5), {}, { deletedAt: at(-1, 14) }),
    make(FEEDING_T, at(0, 14), null, { method: 'bottle', amount_ml: 0 }),
  ];

  it('counts feeds per day by the day they started', () => {
    const days = feedsByDay(feeds, BUILT_IN_TYPES, lastDays(NOW, 2), NOW);
    expect(days.map((d) => d.feeds)).toEqual([4, 1]);
    // Bottle milk per day: 120 + 90 ml; today's running bottle has no amount yet.
    expect(days.map((d) => d.bottleMl)).toEqual([210, 0]);
  });

  it('averages gaps up to 8 hours, bottle amounts and effective bottle times', () => {
    expect(feedGaps(feeds.slice(0, 4).filter((f) => f.deletedAt === null))).toEqual([
      3 * HOUR,
      3 * HOUR,
    ]);
    expect(MAX_FEED_GAP_MS).toBe(8 * HOUR);
    const summary = feedingSummary(feeds, BUILT_IN_TYPES, lastDays(NOW, 2), NOW, TODAY);
    // Gaps 3h, 3h, (11h left out), 15h left out.
    expect(summary.avgGapMs).toBe(3 * HOUR);
    expect(summary.perDay).toBe(4);
    expect(summary.avgBottleMl).toBe(105);
    // The paused bottle is 10 min, the instant one has none, the 23:00 one 20 min; running excluded.
    expect(summary.avgBottleMs).toBe(15 * MIN);
    // Averaged over the days that have bottle amounts.
    expect(summary.mlPerDay).toBe(210);
  });

  it('has no numbers without feeds', () => {
    expect(feedingSummary([], BUILT_IN_TYPES, lastDays(NOW, 7), NOW, TODAY)).toEqual({
      perDay: null,
      avgGapMs: null,
      avgBottleMl: null,
      avgBottleMs: null,
      mlPerDay: null,
    });
  });
});

describe('diapers', () => {
  it('counts wet and dirty, a mixed one in both, in any letter case', () => {
    const events = [
      make(DIAPER_T, at(-1, 7), at(-1, 7), { content: 'WET' }),
      make(DIAPER_T, at(-1, 9), at(-1, 9), { content: 'mixed' }),
      make(DIAPER_T, at(-1, 11), at(-1, 11), { content: 'DIRTY' }),
      make(DIAPER_T, at(-1, 12), at(-1, 12), {}),
      make(DIAPER_T, at(-1, 13), at(-1, 13), { content: 'WET' }, { deletedAt: at(-1, 14) }),
    ];
    const days = diapersByDay(events, BUILT_IN_TYPES, lastDays(NOW, 2), NOW);
    expect(days[0]).toMatchObject({ total: 4, wet: 2, dirty: 2 });
    expect(days[1]).toMatchObject({ total: 0, wet: 0, dirty: 0 });
    expect(diaperSummary(days, TODAY)).toEqual({
      perDay: 4,
      wetPerDay: 2,
      dirtyPerDay: 2,
      hasContent: true,
    });
  });

  it('shows only totals when no diaper says what it held', () => {
    const days = diapersByDay(
      [make(DIAPER_T, at(-1, 7), at(-1, 7), {})],
      BUILT_IN_TYPES,
      lastDays(NOW, 2),
      NOW,
    );
    expect(diaperSummary(days, TODAY).hasContent).toBe(false);
  });
});
