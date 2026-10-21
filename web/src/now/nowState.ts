import type { BabyEvent, EventType } from '../db/models';
import { inferFellAsleepKind } from '../presets/status';
import type { PredictionConfidence, PredictionsDto } from '../sync/contract';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  isSleepKind,
  latestIso,
  minutesBetween,
  pastLiveEvents,
  sleepSessionKind,
  typeIdsForKey,
} from './eventFacts';
import { forgottenTimer, type ForgottenTimer } from './timers';

/*
 * The state card of the Now screen (docs/design/01-ux-strategy.md "A. Now dashboard"): awake or
 * asleep, since when, and the next nap window. Pure and language-free; texts live in nowText.ts.
 */

export type SleepKind = 'nap' | 'night';

/** The next sleep window from the server prediction (`predictions[typeKey = sleep]`). */
export interface NapWindow {
  earliest: string;
  expected: string;
  latest: string;
  confidence: PredictionConfidence;
  /** The server's structured basis (see predictions/predictionModel.ts `describeReason`). */
  basis: Record<string, unknown>;
  sampleCount: number;
}

/**
 * Why no window is shown: no sleep prediction in the response, the server needs more data, or
 * the prediction is stale (window more than 2 h past, or no sleep event in the last 24 h).
 */
export interface LearningState {
  reason: 'no_prediction' | 'insufficient_data' | 'stale';
  /** From `insufficientData[typeKey = sleep]` when the server sent it. */
  sampleCount: number | null;
  requiredSamples: number | null;
}

export interface NightWaking {
  eventId: string;
  since: string;
  minutes: number;
  forgotten?: ForgottenTimer;
}

export interface AwakeState {
  kind: 'awake';
  /** End of the last sleep (finished sleep timer or `woke_up` marker, whichever is later). */
  since: string;
  awakeMinutes: number;
  /** Kind of the sleep that ended at `since`, when known ("since 12:20, after a nap"). */
  after: SleepKind | null;
  /** Exactly one of `window` and `learning` is set. */
  window?: NapWindow;
  learning?: LearningState;
  /** Kind a sleep started now would get (see `inferFellAsleepKind`). */
  sleepKindHint: SleepKind;
}

export interface AsleepState {
  kind: 'asleep';
  sleepKind: SleepKind;
  since: string;
  minutes: number;
  /** The running sleep timer; the `fell_asleep` marker when `fromMarker`. */
  eventId: string;
  /**
   * Asleep only from a `fell_asleep` marker with no sleep timer after it (e.g. the timer was
   * deleted elsewhere): there is no timer to stop.
   */
  fromMarker: boolean;
  forgotten?: ForgottenTimer;
  /** A running `night_waking` timer that started inside this sleep. */
  nightWaking?: NightWaking;
}

export interface UnknownState {
  kind: 'unknown';
  sleepKindHint: SleepKind;
}

export type NowState = AwakeState | AsleepState | UnknownState;

/** A `fell_asleep` marker followed by a sleep timer within this long is part of that sleep. */
export const FELL_ASLEEP_ABSORB_MS = 5 * MINUTE_MS;
/** A lone `fell_asleep` marker older than this no longer means "asleep" (as SPEC bed_time pairing). */
const LONE_MARKER_MAX_AGE_MS = 16 * HOUR_MS;
const STALE_WINDOW_MS = 2 * HOUR_MS;
const STALE_LAST_SLEEP_MS = DAY_MS;

interface SleepFacts {
  sleepEvents: BabyEvent[];
  sessions: BabyEvent[];
  running: BabyEvent[];
}

function sleepFacts(events: readonly BabyEvent[], types: readonly EventType[], now: Date) {
  const sleepIds = typeIdsForKey(types, 'sleep');
  const sleepEvents = pastLiveEvents(events, now).filter((e) => sleepIds.has(e.typeId));
  const sessions = sleepEvents.filter((e) => sleepSessionKind(e) !== null);
  const running = sessions
    .filter((e) => e.endedAt === null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { sleepEvents, sessions, running } satisfies SleepFacts;
}

/** The latest wake boundary: a finished session's end or a `woke_up` marker (not in the future). */
function lastWake(facts: SleepFacts, now: Date) {
  const nowIso = now.toISOString();
  const ends = facts.sessions
    .filter((e) => e.endedAt !== null && e.endedAt <= nowIso)
    .map((e) => e.endedAt as string);
  const wokeUps = facts.sleepEvents
    .filter((e) => isSleepKind(e, 'woke_up'))
    .map((e) => e.startedAt);
  return latestIso([...ends, ...wokeUps]);
}

/** Kind of the sleep that ended at `since`. */
function sleepEndedAt(facts: SleepFacts, since: string): SleepKind | null {
  const sinceMs = Date.parse(since);
  const ended = facts.sessions
    .filter((e) => e.endedAt !== null && Math.abs(Date.parse(e.endedAt) - sinceMs) <= 5 * MINUTE_MS)
    .sort((a, b) => (b.endedAt as string).localeCompare(a.endedAt as string))[0];
  if (ended) return sleepSessionKind(ended);
  // Markers only (e.g. imported): bed_time -> woke_up within 16 h is a night (docs/SPEC.md).
  const bedtime = facts.sleepEvents.some((e) => {
    const t = Date.parse(e.startedAt);
    return isSleepKind(e, 'bed_time') && t < sinceMs && sinceMs - t <= LONE_MARKER_MAX_AGE_MS;
  });
  return bedtime ? 'night' : null;
}

/** The latest `fell_asleep` marker not absorbed by a sleep timer that started right after it. */
function loneFellAsleep(facts: SleepFacts, after: string | undefined, now: Date) {
  const absorbed = (marker: BabyEvent) => {
    const t = Date.parse(marker.startedAt);
    return facts.sessions.some((s) => {
      const start = Date.parse(s.startedAt);
      return start >= t && start - t <= FELL_ASLEEP_ABSORB_MS;
    });
  };
  return facts.sleepEvents
    .filter(
      (e) =>
        isSleepKind(e, 'fell_asleep') &&
        (after === undefined || e.startedAt > after) &&
        now.getTime() - Date.parse(e.startedAt) <= LONE_MARKER_MAX_AGE_MS &&
        !absorbed(e),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

function nightWakingInside(
  sleep: BabyEvent,
  facts: SleepFacts,
  types: readonly EventType[],
  events: readonly BabyEvent[],
  now: Date,
): NightWaking | undefined {
  const waking = facts.sleepEvents
    .filter(
      (e) => e.endedAt === null && isSleepKind(e, 'night_waking') && e.startedAt >= sleep.startedAt,
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  if (!waking) return undefined;
  const forgotten = forgottenTimer(waking, types, events, now);
  return {
    eventId: waking.id,
    since: waking.startedAt,
    minutes: minutesBetween(waking.startedAt, now),
    ...(forgotten ? { forgotten } : {}),
  };
}

/** The next nap window, or why there is none. */
export function napPrediction(
  predictions: PredictionsDto | undefined,
  lastSleepEventAt: string | undefined,
  now: Date,
): { window: NapWindow } | { learning: LearningState } {
  const prediction = predictions?.predictions.find((p) => p.typeKey === 'sleep');
  if (!prediction) {
    const missing = predictions?.insufficientData.find((d) => d.typeKey === 'sleep');
    return {
      learning: missing
        ? {
            reason: 'insufficient_data',
            sampleCount: missing.sampleCount,
            requiredSamples: missing.requiredSamples,
          }
        : { reason: 'no_prediction', sampleCount: null, requiredSamples: null },
    };
  }
  const { earliest, expected, latest } = prediction.nextStart;
  const windowPast = now.getTime() - Date.parse(latest) > STALE_WINDOW_MS;
  const noRecentSleep =
    lastSleepEventAt === undefined ||
    now.getTime() - Date.parse(lastSleepEventAt) > STALE_LAST_SLEEP_MS;
  if (windowPast || noRecentSleep) {
    return { learning: { reason: 'stale', sampleCount: null, requiredSamples: null } };
  }
  return {
    window: {
      earliest,
      expected,
      latest,
      confidence: prediction.confidence,
      basis: prediction.basis,
      sampleCount: prediction.sampleCount,
    },
  };
}

function asleepFromTimer(
  timer: BabyEvent,
  facts: SleepFacts,
  types: readonly EventType[],
  events: readonly BabyEvent[],
  now: Date,
): AsleepState {
  const forgotten = forgottenTimer(timer, types, events, now);
  const nightWaking = nightWakingInside(timer, facts, types, events, now);
  return {
    kind: 'asleep',
    sleepKind: sleepSessionKind(timer) ?? 'nap',
    since: timer.startedAt,
    minutes: minutesBetween(timer.startedAt, now),
    eventId: timer.id,
    fromMarker: false,
    ...(forgotten ? { forgotten } : {}),
    ...(nightWaking ? { nightWaking } : {}),
  };
}

/**
 * The baby's current state from her events (any order; deleted and future events are ignored):
 * - asleep while a sleep timer runs (kind nap, night or none; the oldest when several run), with a
 *   running night waking inside it, and the forgotten-timer flag past the threshold;
 * - asleep since a lone `fell_asleep` marker (no sleep timer within 5 min after it) newer than the
 *   last wake-up; a marker followed by a timer is part of that sleep, never a separate state;
 * - awake since the end of the last finished sleep timer or the last `woke_up` marker;
 * - unknown when there is no sleep data at all.
 */
export function deriveNowState(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  predictions: PredictionsDto | undefined,
  now: Date,
): NowState {
  const facts = sleepFacts(events, types, now);
  const sleepKindHint = inferFellAsleepKind(facts.sleepEvents, now);
  if (facts.running.length > 0) return asleepFromTimer(facts.running[0], facts, types, events, now);

  const since = lastWake(facts, now);
  const marker = loneFellAsleep(facts, since, now);
  if (marker) {
    return {
      kind: 'asleep',
      sleepKind: inferFellAsleepKind(facts.sleepEvents, new Date(marker.startedAt)),
      since: marker.startedAt,
      minutes: minutesBetween(marker.startedAt, now),
      eventId: marker.id,
      fromMarker: true,
    };
  }
  if (since === undefined) return { kind: 'unknown', sleepKindHint };

  const lastSleepEventAt = latestIso(facts.sleepEvents.map((e) => e.endedAt ?? e.startedAt));
  return {
    kind: 'awake',
    since,
    awakeMinutes: minutesBetween(since, now),
    after: sleepEndedAt(facts, since),
    sleepKindHint,
    ...napPrediction(predictions, lastSleepEventAt, now),
  };
}
