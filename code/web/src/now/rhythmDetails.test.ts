import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyEvent } from '../db/models';
import { activateLocale, t } from '../i18n/i18n';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { pinClock } from './ui/nowKit';
import {
  faceState,
  nowDetail,
  rhythmDetails,
  rhythmDetailText,
  rhythmLabel,
  windowPhase,
  type RhythmDetail,
  type RhythmInput,
} from './rhythmDetails';

const TYPES = [SLEEP_TYPE, FEEDING_TYPE, DIAPER_TYPE];
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 21 + dayOffset, h, m);
const MIN = 60_000;

function sleep(
  id: string,
  from: Date,
  to: Date | null,
  kind: string,
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  return {
    id,
    babyId: 'b',
    typeId: SLEEP_TYPE.id,
    startedAt: from.toISOString(),
    endedAt: to ? to.toISOString() : null,
    payload: { kind },
    notes: null,
    createdBy: null,
    createdAt: from.toISOString(),
    updatedAt: from.toISOString(),
    deletedAt: null,
    ...extra,
  };
}

const NIGHT = sleep('night', at(20, 10, -1), at(6, 5), 'night');
const WAKING = sleep('waking', at(1, 50), at(2, 10), 'night_waking');
const NAP = sleep('nap', at(12, 30), at(13, 40), 'nap');
const WINDOW = {
  earliest: at(15, 50).toISOString(),
  latest: at(16, 39).toISOString(),
  basis: {
    kind: 'AwakeWindow',
    medianGapMinutes: 135,
    lookBackDays: 7,
    ageBand: null,
    dayPhase: 'day',
    assumesEventInProgressEnds: false,
  },
};

function input(overrides: Partial<RhythmInput> = {}): RhythmInput {
  return {
    events: [NIGHT, WAKING, NAP],
    types: TYPES,
    now: at(14, 30),
    window: WINDOW,
    state: { kind: 'awake', since: at(13, 40).toISOString(), minutes: 50 },
    ...overrides,
  };
}

const textOf = (detail: RhythmDetail | undefined) =>
  detail ? rhythmLabel(rhythmDetailText(detail, t)) : '';
const byKey = (details: RhythmDetail[], key: string) => details.find((d) => d.key === key);

beforeEach(async () => {
  await activateLocale('en');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rhythmDetails', () => {
  it('lists every mark in time order: the night from yesterday, the waking, the nap, the window, now', () => {
    const details = rhythmDetails(input());
    expect(details.map((d) => d.key)).toEqual(['night', 'waking', 'nap', 'now', 'window']);
  });

  it('writes a finished night, night waking and nap with their real times and lengths', () => {
    const details = rhythmDetails(input());
    expect(textOf(byKey(details, 'night'))).toBe('Night sleep 20:10 to 06:05, 9h 55m.');
    expect(textOf(byKey(details, 'waking'))).toBe('Night waking 01:50, 20m.');
    expect(textOf(byKey(details, 'nap'))).toBe('Nap 12:30 to 13:40, 1h 10m.');
  });

  it('writes a running sleep from its start, with the time so far', () => {
    const run = sleep('run', at(14, 20), null, 'nap');
    const details = rhythmDetails(
      input({
        events: [run],
        now: at(15, 12),
        state: { kind: 'asleep', since: run.startedAt, minutes: 52 },
      }),
    );
    expect(textOf(byKey(details, 'run'))).toBe('Nap since 14:20, running 52m.');
    expect(byKey(details, 'run')).toMatchObject({ end: null, durationMs: 52 * MIN });
  });

  it('measures a sleep without its pauses', () => {
    const paused = sleep('paused', at(12, 0), at(13, 0), 'nap', {
      payload: { kind: 'nap', pause_count: 1, paused_seconds: 600 },
    });
    const detail = byKey(rhythmDetails(input({ events: [paused] })), 'paused');
    expect(detail).toMatchObject({ durationMs: 50 * MIN });
  });

  it('leaves out deleted, future, zero-length and non-sleep events, and yesterday', () => {
    const details = rhythmDetails(
      input({
        events: [
          sleep('gone', at(9), at(10), 'nap', { deletedAt: at(10).toISOString() }),
          sleep('later', at(15), at(16), 'nap'),
          sleep('instant', at(14, 30), null, 'nap'),
          sleep('woke', at(6, 5), at(6, 5), 'woke_up'),
          sleep('yesterday', at(13, 0, -1), at(14, 0, -1), 'nap'),
          { ...NAP, id: 'feed', typeId: FEEDING_TYPE.id },
        ],
      }),
    );
    expect(details.map((d) => d.kind)).toEqual(['now', 'window']);
  });

  it('says when the window opens, with the basis, before it opens', () => {
    const window = byKey(rhythmDetails(input()), 'window');
    expect(window).toMatchObject({ phase: 'ahead', untilMs: 80 * MIN });
    expect(textOf(window)).toBe(
      'Nap window opens 15:50, closes 16:39. Opens in 1h 20m. Based on the usual awake time of about 2h 15m.',
    );
  });

  it('says it is open and when it closes, inside the window', () => {
    const window = byKey(rhythmDetails(input({ now: at(15, 47 + 0) })), 'window');
    expect(window?.kind === 'window' && window.phase).toBe('ahead');
    const inside = byKey(rhythmDetails(input({ now: at(15, 50) })), 'window');
    expect(textOf(inside)).toMatch(
      /^Nap window opens 15:50, closes 16:39\. Open now, closes in 49m\./,
    );
  });

  it('says when it closed once it has passed', () => {
    const past = byKey(rhythmDetails(input({ now: at(17, 0) })), 'window');
    expect(textOf(past)).toMatch(
      /^Nap window opens 15:50, closes 16:39\. Window closed at 16:39\./,
    );
  });

  it('names the start interval basis, and none without a usable basis', () => {
    const interval = byKey(
      rhythmDetails(
        input({ window: { ...WINDOW, basis: { ...WINDOW.basis, kind: 'StartInterval' } } }),
      ),
      'window',
    );
    expect(textOf(interval)).toMatch(/Based on naps usually starting about every 2h 15m\.$/);
    const bare = byKey(rhythmDetails(input({ window: { ...WINDOW, basis: {} } })), 'window');
    expect(textOf(bare)).toBe('Nap window opens 15:50, closes 16:39. Opens in 1h 20m.');
  });

  it('describes now: the time, the face, how long and what is next', () => {
    const details = rhythmDetails(input());
    expect(textOf(nowDetail(details))).toBe(
      'Now, 14:30, awake. Awake for 50m. Next: nap window opens 15:50.',
    );
    const open = rhythmDetails(input({ now: at(16, 0) }));
    expect(textOf(nowDetail(open))).toMatch(
      /^Now, 16:00, awake, nap window open\. .*Next: nap window closes 16:39\.$/,
    );
  });

  it('names the bedtime window next once no nap window is ahead', () => {
    const details = rhythmDetails(
      input({
        window: undefined,
        now: at(17, 30),
        bedTime: { earliest: at(19, 20).toISOString(), latest: at(20, 10).toISOString() },
      }),
    );
    expect(textOf(nowDetail(details))).toMatch(/Next: bedtime window 19:20 to 20:10\.$/);
    const passed = rhythmDetails(
      input({
        window: undefined,
        now: at(20, 30),
        bedTime: { earliest: at(19, 20).toISOString(), latest: at(20, 10).toISOString() },
      }),
    );
    expect(nowDetail(passed)?.next).toBeNull();
  });

  it('says asleep and nothing next while a sleep runs, and night waking while one runs', () => {
    const asleep = rhythmDetails(
      input({
        window: undefined,
        state: { kind: 'asleep', since: at(14).toISOString(), minutes: 30 },
      }),
    );
    expect(textOf(nowDetail(asleep))).toBe('Now, 14:30, asleep. Asleep for 30m.');
    const waking = rhythmDetails(
      input({
        window: undefined,
        state: { kind: 'waking', since: at(14).toISOString(), minutes: 12 },
      }),
    );
    expect(textOf(nowDetail(waking))).toBe('Now, 14:30, awake. Night waking for 12m.');
  });

  it('has only now without data', () => {
    const details = rhythmDetails({ events: [], types: TYPES, now: at(9) });
    expect(details).toHaveLength(1);
    expect(textOf(details[0])).toBe('Now, 09:00, awake.');
  });

  it('clips a running night across midnight to today but keeps its real start', () => {
    pinClock(0, 40);
    const now = new Date();
    const start = new Date(now.getTime() - 4 * 60 * MIN);
    const night = sleep('tonight', start, null, 'night');
    const details = rhythmDetails({
      events: [night],
      types: TYPES,
      now,
      state: { kind: 'asleep', since: night.startedAt, minutes: 240 },
    });
    expect(details.map((d) => d.key)).toEqual(['tonight', 'now']);
    expect(textOf(details[0])).toBe('Night sleep since 20:40, running 4h.');
  });

  it('measures lengths between instants, so a day with a clock change keeps the real length', () => {
    // 9 h 55 min of elapsed time, whatever the wall clock did in between.
    const end = at(6, 5);
    const start = new Date(end.getTime() - (9 * 60 + 55) * MIN);
    const details = rhythmDetails(input({ events: [sleep('dst', start, end, 'night')] }));
    expect(byKey(details, 'dst')).toMatchObject({ durationMs: (9 * 60 + 55) * MIN });
    expect(textOf(byKey(details, 'dst'))).toMatch(/, 9h 55m\.$/);
  });

  it('writes the projected naps and the bedtime window as estimates, fading further out', () => {
    const projection = {
      wake: null,
      windows: [
        {
          index: 1,
          earliest: at(18, 0).getTime(),
          expected: at(18, 15).getTime(),
          latest: at(18, 45).getTime(),
        },
      ],
      basis: { gapKind: 'awake' as const, gapMinutes: 135, napMinutes: 60 },
    };
    const details = rhythmDetails(
      input({
        projection,
        bedTime: { earliest: at(19, 20).toISOString(), latest: at(20, 10).toISOString() },
      }),
    );
    expect(details.map((d) => d.key)).toEqual([
      'night',
      'waking',
      'nap',
      'now',
      'window',
      'projected-1',
      'bedtime',
    ]);
    const projected = byKey(details, 'projected-1');
    expect(projected).toMatchObject({ upcoming: 1, first: false });
    expect(textOf(projected)).toBe(
      'Later nap window about 18:00 to 18:45 (estimate). Based on the usual awake time of about 2h 15m and naps of about 1h.',
    );
    expect(textOf(byKey(details, 'bedtime'))).toBe('Bedtime window about 19:20 to 20:10.');
    // Without the server's window the first projected nap is the next one.
    const alone = rhythmDetails(input({ window: undefined, projection }));
    expect(textOf(byKey(alone, 'projected-1'))).toMatch(
      /^Next nap window about 18:00 to 18:45 \(estimate\)\./,
    );
    expect(textOf(nowDetail(alone))).toMatch(/Next: nap window about 18:00 \(estimate\)\.$/);
  });

  it('writes the likely wake-up of a running nap, and names it as next', () => {
    const run = sleep('run', at(14, 0), null, 'nap');
    const details = rhythmDetails(
      input({
        events: [run],
        window: undefined,
        state: { kind: 'asleep', since: run.startedAt, minutes: 30 },
        projection: {
          wake: { from: at(14, 30).getTime(), at: at(15, 10).getTime() },
          windows: [],
          basis: { gapKind: 'awake', gapMinutes: 135, napMinutes: 70 },
        },
      }),
    );
    expect(textOf(byKey(details, 'wake'))).toBe(
      'Likely to wake about 15:10 (estimate). Based on naps of about 1h 10m.',
    );
    expect(textOf(nowDetail(details))).toBe(
      'Now, 14:30, asleep. Asleep for 30m. Next: likely to wake about 15:10 (estimate).',
    );
  });

  it('speaks Portuguese', async () => {
    await activateLocale('pt-BR');
    const details = rhythmDetails(input());
    expect(textOf(byKey(details, 'nap'))).toBe('Soneca das 12:30 às 13:40, 1 h 10 min.');
    expect(textOf(byKey(details, 'window'))).toBe(
      'Janela da soneca abre às 15:50, fecha às 16:39. Abre em 1 h 20 min. Com base no tempo acordado de costume, cerca de 2 h 15 min.',
    );
    expect(textOf(nowDetail(details))).toBe(
      'Agora, 14:30, acordado. Acordado há 50 min. A seguir: janela da soneca abre às 15:50.',
    );
  });
});

describe('faceState and windowPhase', () => {
  const window = { earliest: at(15, 50).toISOString(), latest: at(16, 39).toISOString() };

  it('follows the nap sheet guidance: wind-down and soon are ahead', () => {
    expect(windowPhase(window, at(14))).toBe('ahead');
    expect(windowPhase(window, at(15, 40))).toBe('ahead');
    expect(windowPhase(window, at(16))).toBe('open');
    expect(windowPhase(window, at(16, 39))).toBe('open');
    expect(windowPhase(window, at(16, 40))).toBe('past');
  });

  it('is asleep while a sleep runs, tired in the heads-up, drowsy in the window, else awake', () => {
    const awake = { kind: 'awake', since: at(13).toISOString(), minutes: 60 } as const;
    expect(faceState({ kind: 'asleep', since: '', minutes: 1 }, 'open', true)).toBe('asleep');
    expect(faceState(awake, 'open', true)).toBe('tired');
    expect(faceState(awake, 'open')).toBe('drowsy');
    expect(faceState(awake, 'ahead')).toBe('awake');
    expect(faceState(awake, 'past')).toBe('awake');
    expect(faceState({ kind: 'waking', since: '', minutes: 1 }, 'open', true)).toBe('awake');
    expect(faceState(undefined, null)).toBe('awake');
  });
});
