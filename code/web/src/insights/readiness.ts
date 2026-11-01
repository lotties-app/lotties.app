import { addDays, dayValue, startOfDay } from '../day/dayModel';
import type { InsightDefinition, InsightId } from './catalogue';
import { dayKeyOf } from './days';

/*
 * Readiness of an insight: how many days with data it has of the days it needs, whether it is
 * open, and a friendly estimate of how long until it opens. Pure.
 *
 * Estimate rule: remaining days = needed days - days with data; they are projected at the pace of
 * the recent logging, the share of the last 7 calendar days that had data. The share only counts
 * days since the first relevant day (someone who started two days ago is not measured against a
 * whole week) and leaves today out while it has no data yet (the day is not over). No data in that
 * window, or none at all, means "start logging". Imported history counts at once: its days are
 * real dates.
 */

/** Days with data are counted over this many local days, today included. */
export const LOOK_BACK_DAYS = 30;
/** The recent pace is measured over this many local days, today included. */
export const PACE_DAYS = 7;

export type ReadinessState =
  /** Enough days and events: the insight shows. */
  | 'unlocked'
  /** Nothing logged recently (or ever): "Start logging X to unlock". */
  | 'start'
  /** Days missing: "About N more days of logging". */
  | 'days'
  /** Days are there, a few events are missing: "Log N more X to unlock". */
  | 'events';

export interface Readiness {
  id: InsightId;
  state: ReadinessState;
  daysWithData: number;
  daysNeeded: number;
  events: number;
  eventsNeeded: number;
  /** Days with data / needed, 0 to 1. */
  progress: number;
  /** Estimated calendar days until it opens (state `days` only). */
  daysLeft: number | null;
  /** Relevant events still missing (state `events` only). */
  eventsLeft: number | null;
}

/**
 * Readiness of `insight` from the start instants (UTC ISO) of its relevant live events (any age;
 * only the look-back window counts) at `now`.
 */
export function readiness(
  insight: InsightDefinition,
  starts: readonly string[],
  now: Date,
): Readiness {
  const today = startOfDay(now);
  const todayKey = dayValue(today);
  const windowFrom = addDays(today, -(LOOK_BACK_DAYS - 1)).toISOString();
  const nowIso = now.toISOString();
  const inWindow = starts.filter((iso) => iso >= windowFrom && iso <= nowIso);
  const dataDays = new Set(inWindow.map(dayKeyOf));
  const daysWithData = dataDays.size;
  const events = inWindow.length;
  const base = {
    id: insight.id,
    daysWithData,
    daysNeeded: insight.minDays,
    events,
    eventsNeeded: insight.minEvents,
    progress: Math.min(1, daysWithData / insight.minDays),
    daysLeft: null,
    eventsLeft: null,
  };

  if (daysWithData >= insight.minDays && events >= insight.minEvents) {
    return { ...base, state: 'unlocked' };
  }

  const pace = recentPace(starts, today, todayKey, nowIso);
  if (pace.withData === 0) return { ...base, state: 'start' };

  if (daysWithData < insight.minDays) {
    const remaining = insight.minDays - daysWithData;
    // Integer arithmetic: ceil(remaining / (withData / considered)).
    const daysLeft = Math.ceil((remaining * pace.considered) / pace.withData);
    return { ...base, state: 'days', daysLeft };
  }
  return { ...base, state: 'events', eventsLeft: insight.minEvents - events };
}

/** Days with data among the recent days that count for the pace, and how many count. */
function recentPace(starts: readonly string[], today: Date, todayKey: string, nowIso: string) {
  const past = starts.filter((iso) => iso <= nowIso);
  if (past.length === 0) return { withData: 0, considered: 0 };
  const first = dayKeyOf(past.reduce((min, iso) => (iso < min ? iso : min)));
  const dataDays = new Set(past.map(dayKeyOf));
  let withData = 0;
  let considered = 0;
  for (let back = 0; back < PACE_DAYS; back++) {
    const key = dayValue(addDays(today, -back));
    if (key < first) break;
    const has = dataDays.has(key);
    // Today only counts once it has data: an empty morning is not a missed day.
    if (key === todayKey && !has) continue;
    considered += 1;
    if (has) withData += 1;
  }
  return { withData, considered };
}
