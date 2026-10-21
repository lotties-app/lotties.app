import type { BabyEvent, EventType } from '../db/models';
import { getOwn } from '../util/ownProperty';

/*
 * Small, language-free facts about events shared by the Now logic (state, tiles, catch-up).
 * Server-provided payload keys are read through `getOwn` (never the prototype chain).
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A payload member, or `undefined` when absent (own properties only). */
export function payloadValue(event: Pick<BabyEvent, 'payload'>, key: string): unknown {
  return getOwn(event.payload, key);
}

/** A string payload member, or `undefined`. */
export function payloadString(event: Pick<BabyEvent, 'payload'>, key: string): string | undefined {
  const value = payloadValue(event, key);
  return typeof value === 'string' ? value : undefined;
}

/** A finite number payload member, or `undefined`. */
export function payloadNumber(event: Pick<BabyEvent, 'payload'>, key: string): number | undefined {
  const value = payloadValue(event, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Ids of the event types with `key` (built-in keys are unique, so normally one). */
export function typeIdsForKey(types: readonly EventType[], key: string): Set<string> {
  return new Set(types.filter((type) => type.key === key).map((type) => type.id));
}

/** The type with `key`: the baby's own wins over a built-in template with the same key. */
export function typeForKey(types: readonly EventType[], key: string): EventType | undefined {
  const matches = types.filter((type) => type.key === key);
  return matches.find((type) => type.babyId !== null) ?? matches[0];
}

/** Live (not deleted) events that started at or before `now`. */
export function pastLiveEvents(events: readonly BabyEvent[], now: Date): BabyEvent[] {
  const nowIso = now.toISOString();
  return events.filter((e) => e.deletedAt === null && e.startedAt <= nowIso);
}

/** Sleep `kind` values that are sessions; a missing kind (older timers) counts as a nap. */
export function sleepSessionKind(event: BabyEvent): 'nap' | 'night' | null {
  const kind = payloadValue(event, 'kind');
  if (kind === undefined || kind === null || kind === 'nap') return 'nap';
  return kind === 'night' ? 'night' : null;
}

export function isSleepKind(event: BabyEvent, kind: string): boolean {
  return payloadValue(event, 'kind') === kind;
}

export const minutesBetween = (fromIso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / MINUTE_MS));

export const latestIso = (values: readonly string[]): string | undefined =>
  values.reduce<string | undefined>(
    (max, v) => (max === undefined || v > max ? v : max),
    undefined,
  );
