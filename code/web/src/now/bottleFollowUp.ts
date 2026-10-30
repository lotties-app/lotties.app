import type { BabyEvent, EventType } from '../db/models';
import { preparedMl } from '../events/bottleAmounts';
import { hasUnknownFinish } from '../events/bottlePatterns';
import { readSegments } from '../events/bottleSegments';
import { getOwn } from '../util/ownProperty';
import { dismissalStore } from './dismissalStore';
import { typeIdsForKey } from './eventFacts';

/*
 * "She fell asleep during the bottle. How much was left in it?" (docs/design/20-feeding-amounts.md
 * section 5): asked once on Now, as a small row, after a starting sleep stopped a bottle whose
 * amount nobody gave. Answering fills the last drinking stretch and the drunk total; dismissing
 * leaves it unknown, and it never comes back for that bottle. Pure.
 */

/** Asked only this long after the sleep stopped the bottle. */
export const FOLLOW_UP_HOURS = 12;
const HOUR_MS = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Skip" of the follow-up: the id of the bottle it was asked for, per baby (per account). */
export const bottleFollowUpDismissal = dismissalStore(
  'baby-routine.bottle-follow-up-dismissed.',
  UUID,
);

export interface BottleFollowUp {
  event: BabyEvent;
  /** The prepared amount (ml): the chips are relative to it. */
  preparedMl: number;
  /** No choice above this level (where the last stretch started). */
  ceilingMl: number | null;
  /** The bottle's stretches now (the answer fills the last one). */
  count: number;
}

/**
 * The bottle to ask about, or `null`: the baby's latest feed is a bottle a sleep stopped
 * (`ended_by: "sleep"`) within `FOLLOW_UP_HOURS`, with a prepared amount and no known finish, and it
 * is not the one dismissed (`dismissedId`).
 */
export function bottleFollowUp(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
  dismissedId: string | null,
): BottleFollowUp | null {
  const feedingIds = typeIdsForKey(types, 'feeding');
  const builtIn = new Set(types.filter((t) => t.babyId === null).map((t) => t.id));
  const latest = events
    .filter(
      (e) =>
        e.deletedAt === null &&
        feedingIds.has(e.typeId) &&
        Date.parse(e.startedAt) <= now.getTime(),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!latest || latest.endedAt === null || latest.id === dismissedId) return null;
  if (!builtIn.has(latest.typeId) || getOwn(latest.payload, 'method') !== 'bottle') return null;
  if (!hasUnknownFinish(latest.payload)) return null;
  const prepared = preparedMl(latest.payload);
  if (prepared === undefined || prepared <= 0) return null;
  const sinceEnd = now.getTime() - Date.parse(latest.endedAt);
  if (sinceEnd < 0 || sinceEnd > FOLLOW_UP_HOURS * HOUR_MS) return null;
  const segments = readSegments(latest.payload);
  const last = segments[segments.length - 1];
  return {
    event: latest,
    preparedMl: prepared,
    ceilingMl: last ? last.startMl : null,
    count: segments.length,
  };
}

/** How the sleep began, when a feeding was running into it: `null` when it was not. */
export type FedToSleep = 'bottle' | 'nursing' | null;

/**
 * Whether `sleep` began while she was feeding: a feeding a starting sleep stopped
 * (`ended_by: "sleep"`) that ended at the sleep's start (same instant). Derived only, nothing is
 * written on the sleep. `feedings`: the baby's feeding events (any order).
 */
export function fedToSleep(
  sleep: Pick<BabyEvent, 'startedAt' | 'deletedAt'>,
  feedings: readonly BabyEvent[],
): FedToSleep {
  if (sleep.deletedAt !== null) return null;
  const start = Date.parse(sleep.startedAt);
  const feed = feedings.find(
    (e) =>
      e.deletedAt === null &&
      e.endedAt !== null &&
      Date.parse(e.endedAt) === start &&
      getOwn(e.payload, 'ended_by') === 'sleep',
  );
  if (!feed) return null;
  const method = getOwn(feed.payload, 'method');
  return method === 'bottle' ? 'bottle' : method === 'breast' ? 'nursing' : null;
}
