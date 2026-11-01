import { canChangeEvent, isRunningControlChange } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import {
  createEvent,
  finishEvent,
  type CommandOptions,
  type CreateEventInput,
} from '../db/eventCommands';
import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { runningEvents } from '../db/queries';
import { ENDED_BY_KEY, ENDED_BY_SLEEP } from '../events/bottleAmounts';
import { validatePayload, withoutHiddenValues } from '../events/payloadRules';
import type { EditedEvent } from '../presets/actions';
import { toUtcIso } from '../sync/contract';
import { setOwn } from '../util/ownProperty';
import { payloadString, typeForKey } from './eventFacts';
import { isNursingEvent, stoppedNursingPayload } from './nursing';

/*
 * A sleep that starts ends any running feeding timer (docs/design/20-feeding-amounts.md): the
 * baby fell asleep, so the feed is over. The feeding stops at the moment the sleep starts and
 * records `ended_by: "sleep"` in its payload so the timeline can say so. Everything is local
 * (events + outbox), so it syncs like any stop: an idempotent upsert per event.
 */

/** Sleep `kind` values that start a sleep (a missing kind, older timers, is a nap). */
const SLEEP_START_KINDS: readonly unknown[] = ['nap', 'night', undefined];

/** Whether an event of `type` with `payload` is a sleep that starts (a nap or a night). */
export function startsSleep(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  payload: EventPayload,
): boolean {
  if (type?.babyId !== null || type.key !== 'sleep') return false;
  return SLEEP_START_KINDS.includes(Object.hasOwn(payload, 'kind') ? payload.kind : undefined);
}

export interface FeedingStops {
  /** The feeding timers stopped, with their state before (undo restores them). */
  edited: EditedEvent[];
  /** Running feedings left running because their payload needs details first. */
  needsFinish: string[];
}

/** The payload a feeding timer is stopped with by a sleep; `null` when the stop needs details. */
function stopPayload(event: BabyEvent, type: EventType, end: string): EventPayload | null {
  const base = isNursingEvent(event, type.id)
    ? stoppedNursingPayload(event, end)
    : { ...event.payload };
  if (validatePayload(type, base, true).some((problem) => problem.code !== 'hidden')) return null;
  const payload = withoutHiddenValues(type, base);
  setOwn<unknown>(payload, ENDED_BY_KEY, ENDED_BY_SLEEP);
  return payload;
}

/**
 * Stops every running feeding timer of the baby that started at or before `sleepStartedAt`, at
 * that moment. A Caregiver stops only what the server lets her: her own timers, and someone else's
 * only when the stop changes nothing but the end and `ended_by` (a nursing session of someone else
 * stays running). Call inside the transaction that creates the sleep; it must include the
 * `events`, `outbox`, `eventTypes` and `babies` tables.
 */
export async function stopFeedingForSleep(
  db: BabyRoutineDb,
  babyId: string,
  sleepStartedAt: string,
  options: CommandOptions = {},
): Promise<FeedingStops> {
  const result: FeedingStops = { edited: [], needsFinish: [] };
  const type = typeForKey(await db.eventTypes.toArray(), 'feeding');
  if (!type) return result;
  const baby = await db.babies.get(babyId);
  const feedings = (await runningEvents(db, babyId)).filter(
    (event) => event.typeId === type.id && event.startedAt <= sleepStartedAt,
  );
  for (const event of feedings) {
    const payload = stopPayload(event, type, sleepStartedAt);
    if (payload === null) {
      result.needsFinish.push(event.id);
      continue;
    }
    const mine = !baby || canChangeEvent(baby, event);
    const allowed =
      mine ||
      (payloadString(event, 'method') !== 'breast' &&
        isRunningControlChange(event, { ...event, endedAt: sleepStartedAt, payload }));
    if (!allowed) continue;
    const after = await finishEvent(db, event.id, payload, sleepStartedAt, options);
    result.edited.push({
      id: event.id,
      before: { startedAt: event.startedAt, endedAt: event.endedAt, payload: event.payload },
      stamp: after.clientUpdatedAt ?? after.updatedAt,
      stops: true,
    });
  }
  return result;
}

/**
 * Creates an event like `createEvent`; when it is a sleep that starts (see `startsSleep`) the
 * running feeding timers stop at its start, in the same transaction. Used by the event sheet.
 */
export async function createEventStoppingFeeding(
  db: BabyRoutineDb,
  input: CreateEventInput,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, db.eventTypes, db.babies, async () => {
    const type = await db.eventTypes.get(input.typeId);
    if (startsSleep(type, input.payload ?? {})) {
      const startedAt = toUtcIso(input.startedAt ?? (options.now?.() ?? new Date()).toISOString());
      await stopFeedingForSleep(db, input.babyId, startedAt, options);
    }
    return createEvent(db, input, options);
  });
}
