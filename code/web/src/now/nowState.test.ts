import { describe, expect, it } from 'vitest';
import type { BabyEvent } from '../db/models';
import { BUILT_IN_TYPES, DIAPER_T, FEEDING_T, SLEEP, event } from '../presets/presetFixtures';
import type { PredictionDto, PredictionsDto } from '../sync/contract';
import { deriveNowState, napPrediction } from './nowState';

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m, 0);
const iso = (h: number, m = 0, day = 21) => at(h, m, day).toISOString();

let seq = 0;
function sleep(kind: string | undefined, start: string, end: string | null): BabyEvent {
  seq += 1;
  return event({
    id: `s${seq}`,
    typeId: SLEEP,
    startedAt: start,
    endedAt: end,
    payload: kind === undefined ? {} : { kind },
  });
}
const marker = (kind: string, when: string) => sleep(kind, when, when);

function sleepPrediction(overrides: Partial<PredictionDto> = {}): PredictionDto {
  return {
    typeKey: 'sleep',
    nextStart: { earliest: iso(14, 5), expected: iso(14, 20), latest: iso(14, 35) },
    expectedDuration: { minutes: 70, sampleCount: 12 },
    confidence: 'Medium',
    sampleCount: 12,
    reason: 'Median gap',
    basis: { kind: 'AwakeWindow', medianGapMinutes: 110, lookBackDays: 7 },
    ...overrides,
  };
}

function response(
  predictions: PredictionDto[],
  insufficient: PredictionsDto['insufficientData'] = [],
) {
  return {
    babyId: 'baby-1',
    generatedAt: iso(12),
    predictions,
    insufficientData: insufficient,
  } satisfies PredictionsDto;
}

describe('deriveNowState: unknown', () => {
  it('is unknown without sleep data (other events do not count)', () => {
    const diaper = event({ id: 'd', typeId: DIAPER_T, startedAt: iso(10), endedAt: iso(10) });
    expect(deriveNowState([diaper], BUILT_IN_TYPES, undefined, at(12))).toEqual({
      kind: 'unknown',
      sleepKindHint: 'nap',
    });
  });

  it('hints a night sleep in the evening', () => {
    expect(deriveNowState([], BUILT_IN_TYPES, undefined, at(21)).kind).toBe('unknown');
    expect(deriveNowState([], BUILT_IN_TYPES, undefined, at(21))).toMatchObject({
      sleepKindHint: 'night',
    });
  });

  it('ignores deleted and future events', () => {
    const deleted = { ...sleep('nap', iso(10), iso(11)), deletedAt: iso(11) };
    const future = sleep('nap', iso(13), null);
    expect(deriveNowState([deleted, future], BUILT_IN_TYPES, undefined, at(12)).kind).toBe(
      'unknown',
    );
  });
});

describe('deriveNowState: asleep', () => {
  it('is asleep while a nap timer runs', () => {
    const nap = sleep('nap', iso(11), null);
    expect(deriveNowState([nap], BUILT_IN_TYPES, undefined, at(11, 42))).toEqual({
      kind: 'asleep',
      sleepKind: 'nap',
      since: iso(11),
      minutes: 42,
      eventId: nap.id,
      fromMarker: false,
    });
  });

  it('treats a kind-less sleep timer as a nap and a night timer as night', () => {
    expect(
      deriveNowState([sleep(undefined, iso(11), null)], BUILT_IN_TYPES, undefined, at(12)),
    ).toMatchObject({ kind: 'asleep', sleepKind: 'nap' });
    expect(
      deriveNowState([sleep('night', iso(20), null)], BUILT_IN_TYPES, undefined, at(22)),
    ).toMatchObject({ kind: 'asleep', sleepKind: 'night' });
  });

  it('uses the oldest of several running sleep timers', () => {
    const a = sleep('nap', iso(11, 10), null);
    const b = sleep('nap', iso(11, 0), null);
    expect(deriveNowState([a, b], BUILT_IN_TYPES, undefined, at(12))).toMatchObject({
      eventId: b.id,
    });
  });

  it('reports a night waking running inside the night sleep', () => {
    const night = sleep('night', iso(20, 0, 20), null);
    const waking = sleep('night_waking', iso(3, 6), null);
    expect(deriveNowState([night, waking], BUILT_IN_TYPES, undefined, at(3, 10))).toMatchObject({
      kind: 'asleep',
      sleepKind: 'night',
      eventId: night.id,
      nightWaking: { eventId: waking.id, since: iso(3, 6), minutes: 4 },
    });
  });

  it('ignores a night waking that started before the sleep, or one already stopped', () => {
    const night = sleep('night', iso(22, 0, 20), null);
    const before = sleep('night_waking', iso(21, 0, 20), null);
    const stopped = sleep('night_waking', iso(1), iso(1, 20));
    const state = deriveNowState([night, before, stopped], BUILT_IN_TYPES, undefined, at(2));
    expect(state).toMatchObject({ kind: 'asleep' });
    expect(state).not.toHaveProperty('nightWaking');
  });

  it('does not count a night waking alone as asleep', () => {
    const woke = marker('woke_up', iso(6));
    const waking = sleep('night_waking', iso(7), null);
    expect(deriveNowState([woke, waking], BUILT_IN_TYPES, undefined, at(7, 30)).kind).toBe('awake');
  });

  it('flags a forgotten nap after 4 h, suggesting the next activity as its end', () => {
    const nap = sleep('nap', iso(9), null);
    const diaper = event({
      id: 'd',
      typeId: DIAPER_T,
      startedAt: iso(10, 25),
      endedAt: iso(10, 25),
    });
    expect(deriveNowState([nap, diaper], BUILT_IN_TYPES, undefined, at(12, 59))).not.toHaveProperty(
      'forgotten',
    );
    expect(deriveNowState([nap, diaper], BUILT_IN_TYPES, undefined, at(13, 1))).toMatchObject({
      forgotten: { thresholdMinutes: 240, suggestedEnd: iso(10, 25) },
    });
  });

  it('suggests start + typical length when nothing was logged after (night: never by activity)', () => {
    const nap = sleep('nap', iso(9), null);
    expect(deriveNowState([nap], BUILT_IN_TYPES, undefined, at(14))).toMatchObject({
      forgotten: { suggestedEnd: iso(10, 20) },
    });
    const night = sleep('night', iso(19, 0, 20), null);
    const feed = event({ id: 'f', typeId: FEEDING_T, startedAt: iso(2), endedAt: iso(2) });
    expect(deriveNowState([night, feed], BUILT_IN_TYPES, undefined, at(9, 30))).toMatchObject({
      forgotten: { thresholdMinutes: 840, suggestedEnd: iso(5) },
    });
  });

  it('flags a forgotten night waking after 3 h', () => {
    const night = sleep('night', iso(20, 0, 20), null);
    const waking = sleep('night_waking', iso(1), null);
    expect(deriveNowState([night, waking], BUILT_IN_TYPES, undefined, at(4, 1))).toMatchObject({
      nightWaking: { forgotten: { thresholdMinutes: 180, suggestedEnd: iso(1, 20) } },
    });
  });
});

describe('deriveNowState: fell_asleep markers', () => {
  it('a marker followed by a timer within 5 min is part of that sleep', () => {
    const fell = marker('fell_asleep', iso(13));
    const nap = sleep('nap', iso(13, 4), iso(14));
    const state = deriveNowState([fell, nap], BUILT_IN_TYPES, undefined, at(15));
    expect(state).toMatchObject({ kind: 'awake', since: iso(14), after: 'nap' });
  });

  it('a lone marker newer than the last wake-up means asleep since the marker', () => {
    const woke = marker('woke_up', iso(7));
    const fell = marker('fell_asleep', iso(13));
    expect(deriveNowState([woke, fell], BUILT_IN_TYPES, undefined, at(13, 30))).toEqual({
      kind: 'asleep',
      sleepKind: 'nap',
      since: iso(13),
      minutes: 30,
      eventId: fell.id,
      fromMarker: true,
    });
  });

  it('a lone marker older than the last wake-up, or older than 16 h, is ignored', () => {
    const fell = marker('fell_asleep', iso(13));
    const woke = marker('woke_up', iso(14));
    expect(deriveNowState([fell, woke], BUILT_IN_TYPES, undefined, at(15)).kind).toBe('awake');
    expect(deriveNowState([fell], BUILT_IN_TYPES, undefined, at(6, 0, 22)).kind).toBe('unknown');
  });

  it('a marker absorbed by a timer that is still running', () => {
    const fell = marker('fell_asleep', iso(13));
    const nap = sleep('nap', iso(13), null);
    expect(deriveNowState([fell, nap], BUILT_IN_TYPES, undefined, at(13, 10))).toMatchObject({
      kind: 'asleep',
      eventId: nap.id,
      fromMarker: false,
    });
  });
});

describe('deriveNowState: awake', () => {
  it('is awake since the end of the last finished sleep timer', () => {
    const nap = sleep('nap', iso(11), iso(12, 20));
    expect(deriveNowState([nap], BUILT_IN_TYPES, undefined, at(14, 12))).toMatchObject({
      kind: 'awake',
      since: iso(12, 20),
      awakeMinutes: 112,
      after: 'nap',
      sleepKindHint: 'nap',
      learning: { reason: 'no_prediction' },
    });
  });

  it('uses the later of the last sleep end and the last woke_up marker', () => {
    const night = sleep('night', iso(20, 0, 20), iso(6, 30));
    const woke = marker('woke_up', iso(6, 40));
    expect(deriveNowState([night, woke], BUILT_IN_TYPES, undefined, at(8))).toMatchObject({
      since: iso(6, 40),
      after: null,
    });
    const laterNap = sleep('nap', iso(9), iso(10));
    expect(
      deriveNowState([night, woke, laterNap], BUILT_IN_TYPES, undefined, at(11)),
    ).toMatchObject({ since: iso(10) });
  });

  it('names the night for markers-only data (bed_time then woke_up)', () => {
    const bed = marker('bed_time', iso(19, 30, 20));
    const woke = marker('woke_up', iso(6, 10));
    expect(deriveNowState([bed, woke], BUILT_IN_TYPES, undefined, at(7))).toMatchObject({
      since: iso(6, 10),
      after: 'night',
    });
  });

  it('marks the wake-up that stopped a timer with the timer kind', () => {
    const night = sleep('night', iso(20, 0, 20), iso(6, 30));
    const woke = marker('woke_up', iso(6, 30));
    expect(deriveNowState([night, woke], BUILT_IN_TYPES, undefined, at(7))).toMatchObject({
      after: 'night',
    });
  });

  it('hints night after a bedtime marker', () => {
    const nap = sleep('nap', iso(15), iso(16));
    const bed = marker('bed_time', iso(18, 30));
    expect(deriveNowState([nap, bed], BUILT_IN_TYPES, undefined, at(18, 40))).toMatchObject({
      kind: 'awake',
      sleepKindHint: 'night',
    });
  });
});

describe('deriveNowState: nap window', () => {
  const nap = sleep('nap', iso(11), iso(12, 20));

  it('exposes the sleep prediction window', () => {
    const state = deriveNowState([nap], BUILT_IN_TYPES, response([sleepPrediction()]), at(14, 12));
    expect(state).toMatchObject({
      kind: 'awake',
      window: {
        earliest: iso(14, 5),
        expected: iso(14, 20),
        latest: iso(14, 35),
        confidence: 'Medium',
        sampleCount: 12,
        basis: { kind: 'AwakeWindow' },
      },
    });
    expect(state).not.toHaveProperty('learning');
  });

  it('ignores predictions of other types', () => {
    const feed = { ...sleepPrediction(), typeKey: 'feeding' };
    expect(deriveNowState([nap], BUILT_IN_TYPES, response([feed]), at(14))).toMatchObject({
      learning: { reason: 'no_prediction' },
    });
  });

  it('is learning with the sample counts when the server needs more data', () => {
    const insufficient = [{ typeKey: 'sleep', sampleCount: 2, requiredSamples: 5, reason: 'x' }];
    expect(deriveNowState([nap], BUILT_IN_TYPES, response([], insufficient), at(14))).toMatchObject(
      {
        learning: { reason: 'insufficient_data', sampleCount: 2, requiredSamples: 5 },
      },
    );
  });

  it('is stale when the window ended more than 2 h ago', () => {
    const data = response([sleepPrediction()]);
    expect(deriveNowState([nap], BUILT_IN_TYPES, data, at(16, 35))).toHaveProperty('window');
    expect(deriveNowState([nap], BUILT_IN_TYPES, data, at(16, 36))).toMatchObject({
      learning: { reason: 'stale' },
    });
  });

  it('is stale when the last sleep event is older than 24 h', () => {
    const old = sleep('nap', iso(11, 0, 19), iso(12, 0, 19));
    const prediction = sleepPrediction({
      nextStart: { earliest: iso(13, 0, 20), expected: iso(13, 30, 20), latest: iso(14, 0, 20) },
    });
    expect(napPrediction(response([prediction]), old.endedAt!, at(12, 0, 20))).toHaveProperty(
      'window',
    );
    expect(napPrediction(response([prediction]), old.endedAt!, at(12, 1, 20))).toEqual({
      learning: { reason: 'stale', sampleCount: null, requiredSamples: null },
    });
  });
});
