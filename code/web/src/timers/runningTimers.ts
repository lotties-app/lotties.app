import type { BabyEvent, EventType } from '../db/models';
import { isSleepKind, sleepSessionKind } from '../now/eventFacts';
import { isNursingEvent } from '../now/nursing';

/*
 * The running timers of a baby as the mini bar and the timer sheet see them: which one is the
 * main one (it gets the target and the big controls) and what each is called. Pure.
 */

export type TimerKind = 'sleep' | 'nursing' | 'waking' | 'other';

export interface RunningTimer {
  event: BabyEvent;
  type: EventType | undefined;
  kind: TimerKind;
  /** Nap or night for a sleep timer. */
  sleepKind: 'nap' | 'night' | null;
}

/** Lower comes first: sleep, nursing, other timers, then a night waking. */
const PRIORITY: Record<TimerKind, number> = { sleep: 0, nursing: 1, other: 2, waking: 3 };

export function timerKindOf(event: BabyEvent, type: EventType | undefined): TimerKind {
  if (type?.key === 'sleep') {
    if (isSleepKind(event, 'night_waking')) return 'waking';
    return sleepSessionKind(event) === null ? 'other' : 'sleep';
  }
  if (type?.key === 'feeding' && isNursingEvent(event, type.id)) return 'nursing';
  return 'other';
}

/**
 * Every running timer, the main one first: a sleep, else the nursing session, else the others,
 * each group oldest first. Deleted and stopped events are left out.
 */
export function runningTimers(
  running: readonly BabyEvent[],
  types: readonly EventType[],
): RunningTimer[] {
  return running
    .filter((event) => event.endedAt === null && event.deletedAt === null)
    .map((event) => {
      const type = types.find((candidate) => candidate.id === event.typeId);
      const kind = timerKindOf(event, type);
      return {
        event,
        type,
        kind,
        sleepKind: kind === 'sleep' ? sleepSessionKind(event) : null,
      };
    })
    .sort(
      (a, b) =>
        PRIORITY[a.kind] - PRIORITY[b.kind] || a.event.startedAt.localeCompare(b.event.startedAt),
    );
}
