import type { BabyEvent, EventType } from '../db/models';
import type { PredictionsDto, WakeWindowDto } from '../sync/contract';
import { MINUTE_MS, isSleepKind, pastLiveEvents, typeIdsForKey } from './eventFacts';
import type { NowState } from './nowState';

/*
 * The overtired heads-up on Now ("hora da bruxa", docs/design/11-patterns.md section 6): the
 * usual longest comfortable awake stretch comes from the server (the predictions response, cached
 * for offline like the nap window); the current awake stretch is measured on the device from local
 * events, as the awake/asleep state is. Pure and language-free; never a diagnosis.
 */

/** The heads-up shows this long before the limit when the server does not say. */
export const DEFAULT_LEAD_MINUTES = 15;
/** ...and stays this long after it. */
export const DEFAULT_GRACE_MINUTES = 30;
/** No server sends a longer limit; anything else is ignored as malformed. */
const MAX_LIMIT_MINUTES = 12 * 60;

const isWholeMinutes = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

/** The well-formed wake window of a predictions response, if any. */
export function wakeWindowOf(predictions: PredictionsDto | null | undefined): WakeWindowDto | null {
  const wake = predictions?.wakeWindow;
  if (!wake || typeof wake !== 'object') return null;
  const valid =
    isWholeMinutes(wake.limitMinutes, MAX_LIMIT_MINUTES) &&
    wake.limitMinutes > 0 &&
    Array.isArray(wake.stretches) &&
    typeof wake.rule === 'object' &&
    wake.rule !== null;
  return valid ? wake : null;
}

const leadOf = (wake: WakeWindowDto) =>
  isWholeMinutes(wake.rule.leadMinutes, 180) ? wake.rule.leadMinutes : DEFAULT_LEAD_MINUTES;

const graceOf = (wake: WakeWindowDto) =>
  isWholeMinutes(wake.rule.graceMinutes, 180) ? wake.rule.graceMinutes : DEFAULT_GRACE_MINUTES;

/**
 * A night waking that ended at or after `since` (or is still running): the baby is up in the
 * night, so this is no awake stretch for the heads-up.
 */
export function nightWakingSince(
  since: string,
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): boolean {
  const sleepIds = typeIdsForKey(types, 'sleep');
  const sinceMs = Date.parse(since);
  return pastLiveEvents(events, now).some(
    (event) =>
      sleepIds.has(event.typeId) &&
      isSleepKind(event, 'night_waking') &&
      (event.endedAt === null ? now.getTime() : Date.parse(event.endedAt)) >= sinceMs,
  );
}

export interface OvertiredInput {
  predictions: PredictionsDto | null | undefined;
  state: NowState;
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** The awake stretch start (UTC ISO) "Not now" was chosen for, if any. */
  dismissedSince: string | null;
}

export interface OvertiredSuggestion {
  wakeWindow: WakeWindowDto;
  /** Start of the current awake stretch (UTC ISO): one heads-up and one "Not now" per stretch. */
  since: string;
  awakeMinutes: number;
  limitMinutes: number;
  /** When the current stretch reaches the usual limit. */
  limitAt: Date;
}

/**
 * The heads-up to show now, or `null`: no wake window (too few stretches), not awake (a sleep
 * runs, or no sleep data), a night waking since the last sleep, outside the time (from the lead
 * before the limit until the grace after it), or "Not now" for this stretch.
 */
export function overtiredSuggestion(input: OvertiredInput): OvertiredSuggestion | null {
  const wake = wakeWindowOf(input.predictions);
  if (!wake || input.state.kind !== 'awake') return null;
  const since = new Date(input.state.since).toISOString();
  if (since === input.dismissedSince) return null;
  if (nightWakingSince(since, input.events, input.types, input.now)) return null;
  const awakeMs = input.now.getTime() - Date.parse(since);
  const limitMs = wake.limitMinutes * MINUTE_MS;
  const showing = awakeMs >= limitMs - leadOf(wake) * MINUTE_MS;
  const over = awakeMs >= limitMs + graceOf(wake) * MINUTE_MS;
  if (!showing || over) return null;
  return {
    wakeWindow: wake,
    since,
    awakeMinutes: Math.floor(awakeMs / MINUTE_MS),
    limitMinutes: wake.limitMinutes,
    limitAt: new Date(Date.parse(since) + limitMs),
  };
}
