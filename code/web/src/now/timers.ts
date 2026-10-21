import type { BabyEvent, EventType } from '../db/models';
import {
  currentPauseSeconds,
  effectiveElapsedSeconds,
  LONG_PAUSE_SECONDS,
  pausedSince,
} from '../timers/pauseMath';
import { MINUTE_MS, payloadValue, typeIdsForKey } from './eventFacts';

/*
 * Forgotten timers: a running timer older than a per-kind threshold is probably one somebody forgot
 * to stop. The UI offers "Ended <suggestedEnd>" and "Still going" (docs/design/03-interaction.md
 * section 3). Thresholds are fixed defaults for now (the doc's "2 x the baby's median" needs
 * per-baby duration statistics: a later improvement).
 */

/** Which threshold/typical-duration bucket a running timer falls in. */
export type TimerBucket = 'nap' | 'night' | 'night_waking' | 'feeding' | 'other';

const THRESHOLD_MINUTES: Record<TimerBucket, number> = {
  nap: 4 * 60,
  night: 14 * 60,
  night_waking: 3 * 60,
  feeding: 90,
  other: 6 * 60,
};

/** Typical lengths used to suggest an end when no later activity tells it. */
const TYPICAL_MINUTES: Record<TimerBucket, number> = {
  nap: 80,
  night: 10 * 60,
  night_waking: 20,
  feeding: 20,
  other: 30,
};

export interface ForgottenTimer {
  /** The threshold the timer passed, in minutes. */
  thresholdMinutes: number;
  /**
   * Suggested end (UTC ISO): the start of the next logged activity after the timer started (not
   * for night sleep, where feeds and wakings are normal), else start + a typical length; never
   * before start + 1 min nor after now.
   */
  suggestedEnd: string;
}

export function timerBucket(typeKey: string | undefined, event: BabyEvent): TimerBucket {
  if (typeKey === 'sleep') {
    const kind = payloadValue(event, 'kind');
    if (kind === 'night') return 'night';
    if (kind === 'night_waking') return 'night_waking';
    return 'nap';
  }
  return typeKey === 'feeding' ? 'feeding' : 'other';
}

export function timerThresholdMinutes(bucket: TimerBucket): number {
  return THRESHOLD_MINUTES[bucket];
}

function nextActivityStart(
  timer: BabyEvent,
  events: readonly BabyEvent[],
  excludedTypeIds: ReadonlySet<string>,
  now: Date,
): number | undefined {
  const start = Date.parse(timer.startedAt);
  let next: number | undefined;
  for (const e of events) {
    if (e.id === timer.id || e.deletedAt !== null || excludedTypeIds.has(e.typeId)) continue;
    const t = Date.parse(e.startedAt);
    if (t > start && t <= now.getTime() && (next === undefined || t < next)) next = t;
  }
  return next;
}

/**
 * The forgotten state of a running timer, or `undefined` while it is within its threshold (or not
 * running). `events` are the baby's recent events (for the next-activity suggestion).
 */
export function forgottenTimer(
  timer: BabyEvent,
  types: readonly EventType[],
  events: readonly BabyEvent[],
  now: Date,
): ForgottenTimer | undefined {
  if (timer.endedAt !== null || timer.deletedAt !== null) return undefined;
  const typeKey = types.find((t) => t.id === timer.typeId)?.key;
  const bucket = timerBucket(typeKey, timer);
  const start = Date.parse(timer.startedAt);
  const threshold = THRESHOLD_MINUTES[bucket];
  // Effective elapsed time (a pause does not count); a pause that lasts over 2 h is forgotten too.
  const longPause = currentPauseSeconds(timer, now) > LONG_PAUSE_SECONDS;
  if (!longPause && effectiveElapsedSeconds(timer, now) <= threshold * 60) return undefined;

  // Sleep timers end at the next non-sleep activity; others at the next activity of another type.
  const excluded = typeIdsForKey(types, typeKey === 'sleep' ? 'sleep' : (typeKey ?? ''));
  excluded.add(timer.typeId);
  const next = bucket === 'night' ? undefined : nextActivityStart(timer, events, excluded, now);
  // A long pause suggests ending where it began (the baby stopped being asleep or fed then).
  const pausedAt = longPause ? pausedSince(timer) : null;
  const suggested =
    next ?? (pausedAt ? Date.parse(pausedAt) : start + TYPICAL_MINUTES[bucket] * MINUTE_MS);
  const clamped = Math.min(now.getTime(), Math.max(start + MINUTE_MS, suggested));
  return { thresholdMinutes: threshold, suggestedEnd: new Date(clamped).toISOString() };
}

/** Forgotten state of every running timer in `events`, by event id. */
export function forgottenTimers(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): Map<string, ForgottenTimer> {
  const result = new Map<string, ForgottenTimer>();
  for (const e of events) {
    const forgotten = forgottenTimer(e, types, events, now);
    if (forgotten) result.set(e.id, forgotten);
  }
  return result;
}

/**
 * The running timers that have no card of their own on Now: everything except sleep (the state
 * card) and the nursing session (the nursing card), oldest first as given.
 */
export function otherTimers(
  running: readonly BabyEvent[],
  types: readonly EventType[],
  nursingId: string | null,
): BabyEvent[] {
  const sleepIds = typeIdsForKey(types, 'sleep');
  return running.filter((e) => !sleepIds.has(e.typeId) && e.id !== nursingId);
}
