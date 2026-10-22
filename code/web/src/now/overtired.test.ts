import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import type { PredictionsDto, WakeWindowDto } from '../sync/contract';
import { BABY_ID } from '../test/fakeApi';
import { eventType } from '../presets/presetFixtures';
import { deriveNowState } from './nowState';
import { nightWakingSince, overtiredSuggestion, wakeWindowOf } from './overtired';

/*
 * The overtired heads-up (docs/design/11-patterns.md section 6): the limit comes from the server;
 * the current awake stretch is measured from local events.
 */

const SLEEP = eventType({ id: 't-sleep', key: 'sleep', name: 'Sleep', hasDuration: true });
const TYPES = [SLEEP];

/** Local time on 2026-10-21. */
const at = (hour: number, minute = 0) => new Date(2026, 9, 21, hour, minute);

function wakeWindow(over: Partial<WakeWindowDto> = {}): WakeWindowDto {
  return {
    limitMinutes: 150,
    sampleCount: 6,
    awakeSince: null,
    awakeMinutes: null,
    timeZone: 'America/Sao_Paulo',
    stretches: [],
    rule: {
      lookBackDays: 14,
      dayStartsAt: '05:00',
      dayEndsAt: '18:00',
      percentile: 75,
      minimumStretches: 5,
      leadMinutes: 15,
      graceMinutes: 30,
    },
    ...over,
  };
}

const predictions = (wake: WakeWindowDto | null | undefined): PredictionsDto => ({
  babyId: BABY_ID,
  generatedAt: '2026-10-21T12:00:00Z',
  predictions: [],
  insufficientData: [],
  ...(wake !== undefined ? { wakeWindow: wake } : {}),
});

let counter = 0;
function sleep(start: Date, end: Date | null, kind = 'nap'): BabyEvent {
  counter += 1;
  return {
    id: `s-${counter}`,
    babyId: BABY_ID,
    typeId: SLEEP.id,
    startedAt: start.toISOString(),
    endedAt: end?.toISOString() ?? null,
    payload: { kind },
    notes: null,
    createdBy: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  };
}

/** A nap from 11:00 to 12:00: awake since 12:00, usual limit 14:30. */
const NAP = sleep(at(11), at(12));

function suggest(
  now: Date,
  events: BabyEvent[] = [NAP],
  wake: WakeWindowDto | null | undefined = wakeWindow(),
  dismissedSince: string | null = null,
) {
  const dto = predictions(wake);
  return overtiredSuggestion({
    predictions: dto,
    state: deriveNowState(events, TYPES, dto, now),
    events,
    types: TYPES,
    now,
    dismissedSince,
  });
}

describe('wakeWindowOf', () => {
  it('accepts a well-formed wake window and ignores missing or malformed ones', () => {
    expect(wakeWindowOf(predictions(wakeWindow()))?.limitMinutes).toBe(150);
    expect(wakeWindowOf(predictions(undefined))).toBeNull();
    expect(wakeWindowOf(predictions(null))).toBeNull();
    expect(wakeWindowOf(predictions(wakeWindow({ limitMinutes: 0 })))).toBeNull();
    expect(wakeWindowOf(predictions(wakeWindow({ limitMinutes: 12.5 })))).toBeNull();
    expect(wakeWindowOf(predictions(wakeWindow({ limitMinutes: 13 * 60 })))).toBeNull();
    expect(
      wakeWindowOf(predictions({ ...wakeWindow(), stretches: 'x' } as unknown as WakeWindowDto)),
    ).toBeNull();
  });
});

describe('overtiredSuggestion', () => {
  it('shows from 15 min before the usual limit until 30 min after it', () => {
    expect(suggest(at(14, 14))).toBeNull();
    const shown = suggest(at(14, 15));
    expect(shown).toMatchObject({
      since: at(12).toISOString(),
      awakeMinutes: 135,
      limitMinutes: 150,
      limitAt: at(14, 30),
    });
    expect(suggest(at(14, 59))?.awakeMinutes).toBe(179);
    expect(suggest(at(15, 0))).toBeNull();
  });

  it('follows the server lead and grace', () => {
    const wide = wakeWindow({ rule: { ...wakeWindow().rule, leadMinutes: 30, graceMinutes: 5 } });
    expect(suggest(at(14, 0), [NAP], wide)).not.toBeNull();
    expect(suggest(at(14, 35), [NAP], wide)).toBeNull();
  });

  it('is hidden without a wake window (too few stretches)', () => {
    expect(suggest(at(14, 20), [NAP], null)).toBeNull();
    const older = predictions(undefined);
    expect(
      overtiredSuggestion({
        predictions: older,
        state: deriveNowState([NAP], TYPES, older, at(14, 20)),
        events: [NAP],
        types: TYPES,
        now: at(14, 20),
        dismissedSince: null,
      }),
    ).toBeNull();
  });

  it('is hidden while a sleep runs and starts over after the next nap', () => {
    const running = sleep(at(14, 10), null);
    expect(suggest(at(14, 20), [NAP, running])).toBeNull();
    const finished = sleep(at(14, 10), at(14, 40));
    expect(suggest(at(14, 50), [NAP, finished])).toBeNull();
    expect(suggest(at(16, 55), [NAP, finished])?.since).toBe(at(14, 40).toISOString());
  });

  it('is hidden after a night waking since the last sleep', () => {
    const night = sleep(at(2), at(3), 'night');
    const waking = sleep(at(3), at(3, 30), 'night_waking');
    const before = sleep(at(1), at(1, 10), 'night_waking');
    expect(suggest(at(5, 20), [night])).not.toBeNull();
    expect(suggest(at(5, 20), [night, waking])).toBeNull();
    expect(suggest(at(5, 20), [night, before])).not.toBeNull();
    expect(nightWakingSince(at(3).toISOString(), [waking], TYPES, at(5))).toBe(true);
  });

  it('is hidden for the stretch "Not now" was chosen for', () => {
    expect(suggest(at(14, 20), [NAP], wakeWindow(), at(12).toISOString())).toBeNull();
    const later = sleep(at(14, 30), at(15));
    expect(suggest(at(17, 20), [NAP, later], wakeWindow(), at(12).toISOString())).not.toBeNull();
  });
});
