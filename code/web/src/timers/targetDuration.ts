import type { BabyEvent } from '../db/models';
import { sleepSessionKind } from '../now/eventFacts';
import type { PredictionDto, PredictionsDto } from '../sync/contract';
import { readPause } from './pauseMath';

/*
 * The quiet target of a running sleep timer ("usual nap about 45 min", docs/design/SYNTHESIS.md
 * section 6.2): the baby's typical length of THIS kind of sleep, taken from the predictions
 * response (docs/SPEC.md "Predictions"), never invented. It is only a flag and a progress bar:
 * reaching it alarms nothing and stops nothing. Without a usable figure there is no target.
 */

/** `bottle`: the drinking time of a running bottle at her pace (events/bottlePatterns.ts). */
export type TargetKind = 'nap' | 'night' | 'bottle';

export interface SleepTarget {
  /** Typical effective length of the sleep, in minutes, rounded to 5. */
  minutes: number;
  kind: TargetKind;
}

const MS = 60_000;
const ROUND_TO_MINUTES = 5;
/** Below this the figure is noise (the heuristic needs a few samples; a clamped end is ~now). */
const MIN_TARGET_MINUTES = 10;
const MAX_TARGET_MINUTES = 16 * 60;

const roundMinutes = (minutes: number) => Math.round(minutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function usable(minutes: number): number | null {
  const rounded = roundMinutes(minutes);
  return rounded >= MIN_TARGET_MINUTES && rounded <= MAX_TARGET_MINUTES ? rounded : null;
}

/**
 * While a sleep runs the server measures the next sleep from its expected end (start + the typical
 * effective length of the same kind + the pauses it already had), so that end is the next start
 * minus the typical awake window (`basis.medianGapMinutes`). Returns the typical length, or `null`
 * when the end was clamped to the moment of the request (the sleep already outlasted the typical).
 */
function fromRunningExpectation(
  timer: BabyEvent,
  prediction: PredictionDto,
  generatedAt: number,
): number | null {
  const { basis } = prediction;
  if (basis.kind !== 'AwakeWindow' || basis.assumesEventInProgressEnds !== true) return null;
  const gap = basis.medianGapMinutes;
  if (!finite(gap)) return null;
  const expectedEnd = Date.parse(prediction.nextStart.expected) - gap * MS;
  if (!Number.isFinite(expectedEnd)) return null;
  // "Never earlier than now": an end at (or before) the request moment is the clamp, not a figure.
  if (Number.isFinite(generatedAt) && expectedEnd <= generatedAt + MS) return null;
  const pausedMinutes = readPause(timer.payload).pausedSeconds / 60;
  return usable((expectedEnd - Date.parse(timer.startedAt)) / MS - pausedMinutes);
}

/**
 * `expectedDuration` of the sleep prediction: the typical length of the next sleep, narrowed by
 * day/night phase but not by kind. Used only when its phase fits the kind (a daytime figure for a
 * nap, a night one for a night) and it rests on a few sessions.
 */
function fromExpectedDuration(prediction: PredictionDto, kind: TargetKind): number | null {
  const duration = prediction.expectedDuration;
  if (!duration || !finite(duration.minutes) || duration.sampleCount < 3) return null;
  const phase = prediction.basis.dayPhase;
  const fits = kind === 'nap' ? phase === 'day' : phase === 'night';
  return fits ? usable(duration.minutes) : null;
}

/** The target of a running sleep timer, or `null` (no data, not a nap or a night). */
export function runningSleepTarget(
  timer: BabyEvent,
  predictions: PredictionsDto | undefined,
): SleepTarget | null {
  const kind = sleepSessionKind(timer);
  if (kind === null || timer.endedAt !== null) return null;
  const prediction = predictions?.predictions.find((p) => p.typeKey === 'sleep');
  if (!prediction) return null;
  const generatedAt = Date.parse(predictions?.generatedAt ?? '');
  const minutes =
    fromRunningExpectation(timer, prediction, generatedAt) ??
    fromExpectedDuration(prediction, kind);
  return minutes === null ? null : { minutes, kind };
}

export interface TargetProgress {
  /** 0 to 1, capped: the bar never overflows. */
  fraction: number;
  /** The effective time went past the target (shown calmly, never as an alarm). */
  past: boolean;
}

export function targetProgress(effectiveSeconds: number, targetMinutes: number): TargetProgress {
  const ratio = targetMinutes > 0 ? effectiveSeconds / (targetMinutes * 60) : 0;
  return { fraction: Math.min(1, Math.max(0, ratio)), past: ratio > 1 };
}
