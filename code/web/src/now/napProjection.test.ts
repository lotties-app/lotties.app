import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BabyEvent } from '../db/models';
import { SLEEP_TYPE } from '../test/builtInTypes';
import { projectNaps, type ProjectionInput, type ProjectionPrediction } from './napProjection';
import { pinClock } from './ui/nowKit';

const TYPES = [SLEEP_TYPE];
const MIN = 60_000;
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m);
const iso = (date: Date) => date.toISOString();

let counter = 0;
function sleep(from: Date, to: Date | null, kind = 'nap'): BabyEvent {
  counter += 1;
  return {
    id: `s${counter}`,
    babyId: 'b',
    typeId: SLEEP_TYPE.id,
    startedAt: iso(from),
    endedAt: to ? iso(to) : null,
    payload: { kind },
    notes: null,
    createdBy: null,
    createdAt: iso(from),
    updatedAt: iso(from),
    deletedAt: null,
  };
}

/** Three past days with a 1 h morning nap, a 1 h 30 afternoon nap and a 40 min evening nap. */
const PAST: BabyEvent[] = [-1, -2, -3].flatMap((day) => [
  sleep(at(8, 30, day), at(9, 30, day)),
  sleep(at(13, 0, day), at(14, 30, day)),
  sleep(at(18, 0, day), at(18, 40, day)),
]);

function prediction(
  expected: Date,
  basis: Record<string, unknown> = { kind: 'AwakeWindow', medianGapMinutes: 120, lookBackDays: 7 },
): ProjectionPrediction {
  return {
    nextStart: {
      earliest: iso(new Date(expected.getTime() - 15 * MIN)),
      expected: iso(expected),
      latest: iso(new Date(expected.getTime() + 30 * MIN)),
    },
    basis,
    expectedDuration: { minutes: 75 },
  };
}

function input(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    events: PAST,
    types: TYPES,
    now: at(8, 0),
    state: { kind: 'awake', since: iso(at(6, 30)) },
    prediction: prediction(at(9, 0)),
    ...overrides,
  };
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const windows = (p: ReturnType<typeof projectNaps>) =>
  (p?.windows ?? []).map((w) => `${clock(w.earliest)}-${clock(w.latest)}`);

afterEach(() => {
  vi.useRealTimers();
});

describe('projectNaps', () => {
  it('awake before the first nap: the naps after the server window, up to her usual count', () => {
    const p = projectNaps(input());
    // 09:00 + the morning nap (1 h) + 2 h awake = 12:00; then + 1 h 30 (afternoon) + 2 h = 15:30.
    // She had 3 naps on her recent days: the server's window and two more.
    expect(windows(p)).toEqual(['11:45-12:30', '15:15-16:00']);
    expect(p?.wake).toBeNull();
    expect(p?.basis).toEqual({ gapKind: 'awake', gapMinutes: 120, napMinutes: 60 });
    expect(p?.windows.map((w) => w.index)).toEqual([1, 2]);
  });

  it('between naps: one nap done today leaves one more after the server window', () => {
    const today = sleep(at(8, 30), at(9, 30));
    const p = projectNaps(
      input({
        events: [...PAST, today],
        now: at(10, 0),
        state: { kind: 'awake', since: iso(at(9, 30)) },
        prediction: prediction(at(11, 30)),
      }),
    );
    // 11:30 + 1 h (morning) + 2 h = 14:30.
    expect(windows(p)).toEqual(['14:15-15:00']);
  });

  it('asleep in a nap: the likely wake-up and the next window from it', () => {
    const morning = sleep(at(8, 30), at(9, 30));
    const running = sleep(at(12, 10), null);
    const p = projectNaps(
      input({
        events: [...PAST, morning, running],
        now: at(12, 40),
        state: { kind: 'asleep', since: running.startedAt, sleepKind: 'nap' },
        prediction: prediction(at(12, 0)),
      }),
    );
    // Wakes about 12:10 + 1 h 30 = 13:40; the next window 13:40 + 2 h = 15:40.
    expect(p?.wake).toEqual({ from: at(12, 40).getTime(), at: at(13, 40).getTime() });
    expect(windows(p)).toEqual(['15:25-16:10']);
    expect(p?.basis.napMinutes).toBe(90);
  });

  it('asleep longer than usual: the wake-up is never before now', () => {
    const running = sleep(at(12, 10), null);
    const p = projectNaps(
      input({
        events: [...PAST, running],
        now: at(14, 0),
        state: { kind: 'asleep', since: running.startedAt, sleepKind: 'nap' },
        prediction: prediction(at(12, 0)),
      }),
    );
    expect(p?.wake?.at).toBe(at(14, 0).getTime());
  });

  it('stops at the bedtime window: the last nap of the day', () => {
    const p = projectNaps(input({ bedTime: { earliest: iso(at(15, 0)), latest: iso(at(16, 0)) } }));
    expect(windows(p)).toEqual(['11:45-12:30']);
  });

  it('projects nothing in the night, in a night sleep or without a prediction', () => {
    expect(
      projectNaps(
        input({ state: { kind: 'asleep', since: iso(at(19, 0, -1)), sleepKind: 'night' } }),
      ),
    ).toBeNull();
    expect(projectNaps(input({ state: { kind: 'other' } }))).toBeNull();
    expect(projectNaps(input({ prediction: null }))).toBeNull();
  });

  it('projects nothing with too little data (fewer than three recent naps)', () => {
    const few = [sleep(at(8, 30, -1), at(9, 30, -1)), sleep(at(13, 0, -1), at(14, 30, -1))];
    expect(projectNaps(input({ events: few }))).toBeNull();
  });

  it('caps at three projected naps when there is no past day to count', () => {
    const today = [
      sleep(at(1, 0), at(1, 40)),
      sleep(at(2, 0), at(2, 40)),
      sleep(at(3, 0), at(3, 40)),
    ];
    const p = projectNaps(
      input({
        events: today,
        now: at(4, 0),
        prediction: prediction(at(5, 0), {
          kind: 'AwakeWindow',
          medianGapMinutes: 60,
          lookBackDays: 7,
        }),
      }),
    );
    expect(p?.windows).toHaveLength(3);
  });

  it('uses the start interval when the basis is one, and the wake window when there is none', () => {
    const interval = projectNaps(
      input({
        prediction: prediction(at(9, 0), {
          kind: 'StartInterval',
          medianGapMinutes: 240,
          lookBackDays: 7,
        }),
      }),
    );
    // Starts every 4 h: 13:00 and 17:00.
    expect(windows(interval)).toEqual(['12:45-13:30', '16:45-17:30']);
    expect(interval?.basis.gapKind).toBe('start');
    const fallback = projectNaps(
      input({ prediction: prediction(at(9, 0), {}), wakeWindowMinutes: 150 }),
    );
    expect(fallback?.basis).toMatchObject({ gapKind: 'awake', gapMinutes: 150 });
    expect(projectNaps(input({ prediction: prediction(at(9, 0), {}) }))).toBeNull();
  });

  it('falls back to the typical length of the prediction for a part with few naps', () => {
    const fewMornings = PAST.filter((e) => new Date(e.startedAt).getHours() !== 8);
    const extra = [sleep(at(13, 0, -4), at(14, 30, -4))];
    const p = projectNaps(input({ events: [...fewMornings, ...extra] }));
    // Morning naps unknown: 75 min from the prediction; 09:00 + 1 h 15 + 2 h = 12:15.
    expect(windows(p)[0]).toBe('12:00-12:45');
  });

  it('never projects past midnight and cuts a window at it', () => {
    pinClock(21, 0);
    const now = new Date();
    const day = (h: number, m = 0, offset = 0) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
    const past = [-1, -2, -3].flatMap((offset) => [
      sleep(day(8, 30, offset), day(9, 30, offset)),
      sleep(day(18, 0, offset), day(18, 40, offset)),
      sleep(day(19, 0, offset), day(19, 40, offset)),
      sleep(day(20, 0, offset), day(20, 40, offset)),
      sleep(day(21, 0, offset), day(21, 40, offset)),
    ]);
    const p = projectNaps({
      events: past,
      types: TYPES,
      now,
      state: { kind: 'awake', since: iso(day(20, 30)) },
      prediction: prediction(day(21, 30)),
    });
    // 21:30 + 40 min (evening) + 2 h = 00:10: the window opens 23:55 and is cut at midnight;
    // nothing after it.
    expect(windows(p)).toEqual(['23:55-00:00']);
    expect(p?.windows[0].latest).toBe(day(0, 0, 1).getTime());
  });
});
