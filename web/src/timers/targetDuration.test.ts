import { describe, expect, it } from 'vitest';
import { event, SLEEP } from '../presets/presetFixtures';
import type { PredictionDto, PredictionsDto } from '../sync/contract';
import { runningSleepTarget, targetProgress } from './targetDuration';

const START = '2026-10-21T13:00:00.000Z';
const at = (minutesAfterStart: number) =>
  new Date(Date.parse(START) + minutesAfterStart * 60_000).toISOString();

function prediction(overrides: Partial<PredictionDto> = {}): PredictionDto {
  return {
    typeKey: 'sleep',
    // The nap is expected to end 45 min in; the next sleep comes a 120 min awake window later.
    nextStart: { earliest: at(150), expected: at(165), latest: at(180) },
    expectedDuration: null,
    confidence: 'Medium',
    sampleCount: 9,
    reason: 'x',
    basis: {
      kind: 'AwakeWindow',
      medianGapMinutes: 120,
      lookBackDays: 14,
      dayPhase: 'day',
      assumesEventInProgressEnds: true,
    },
    ...overrides,
  };
}

const response = (p: PredictionDto | null, generatedMinutesAfterStart = 10): PredictionsDto => ({
  babyId: 'b',
  generatedAt: at(generatedMinutesAfterStart),
  predictions: p ? [p] : [],
  insufficientData: [],
});

const nap = (payload: Record<string, unknown> = { kind: 'nap' }) =>
  event({ id: 'n', typeId: SLEEP, startedAt: START, endedAt: null, payload });

describe('runningSleepTarget', () => {
  it("reads the kind-aware expected end of the running sleep from the server's window", () => {
    expect(runningSleepTarget(nap(), response(prediction()))).toEqual({ minutes: 45, kind: 'nap' });
  });

  it('adds back the pauses the sleep already had (the server counts them on top)', () => {
    // start + 45 effective + 15 paused = expected end at 60.
    const p = prediction({ nextStart: { earliest: at(170), expected: at(180), latest: at(190) } });
    const timer = nap({ kind: 'nap', paused_seconds: 900, pause_count: 1 });
    expect(runningSleepTarget(timer, response(p))?.minutes).toBe(45);
  });

  it('rounds to 5 minutes', () => {
    const p = prediction({ nextStart: { earliest: at(150), expected: at(167), latest: at(180) } });
    expect(runningSleepTarget(nap(), response(p))?.minutes).toBe(45);
  });

  it('gives a night its own kind', () => {
    const p = prediction({
      nextStart: { earliest: at(0), expected: at(10 * 60 + 120), latest: at(14 * 60) },
    });
    expect(runningSleepTarget(nap({ kind: 'night' }), response(p))).toEqual({
      minutes: 600,
      kind: 'night',
    });
  });

  it('shows nothing when the end was clamped to the moment of the request', () => {
    // The sleep already outlasted the typical length: the server's end is "now".
    const p = prediction({ nextStart: { earliest: at(120), expected: at(130), latest: at(140) } });
    expect(runningSleepTarget(nap(), response(p, 10))).toBeNull();
  });

  it('falls back to the typical next sleep length only for the same day phase and enough samples', () => {
    const base = prediction({
      basis: { kind: 'StartInterval', medianGapMinutes: 180, lookBackDays: 14, dayPhase: 'day' },
      expectedDuration: { minutes: 62, sampleCount: 8 },
    });
    expect(runningSleepTarget(nap(), response(base))?.minutes).toBe(60);
    // A daytime figure never becomes the target of a night.
    expect(runningSleepTarget(nap({ kind: 'night' }), response(base))).toBeNull();
    const thin = { ...base, expectedDuration: { minutes: 62, sampleCount: 2 } };
    expect(runningSleepTarget(nap(), response(thin))).toBeNull();
  });

  it('is hidden without data, for markers, for stopped timers and for other kinds', () => {
    expect(runningSleepTarget(nap(), undefined)).toBeNull();
    expect(runningSleepTarget(nap(), response(null))).toBeNull();
    expect(runningSleepTarget(nap({ kind: 'night_waking' }), response(prediction()))).toBeNull();
    expect(runningSleepTarget({ ...nap(), endedAt: at(30) }, response(prediction()))).toBeNull();
  });
});

describe('targetProgress', () => {
  it('is the share of the target, capped, and never an alarm', () => {
    expect(targetProgress(22 * 60 + 30, 45)).toEqual({ fraction: 0.5, past: false });
    expect(targetProgress(45 * 60, 45)).toEqual({ fraction: 1, past: false });
    expect(targetProgress(50 * 60, 45)).toEqual({ fraction: 1, past: true });
    expect(targetProgress(0, 45).fraction).toBe(0);
  });
});
