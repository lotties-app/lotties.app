import { canChangeEvent } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, deleteEvent, editEvent, type CommandOptions } from '../db/eventCommands';
import type { BabyEvent, EventType } from '../db/models';
import { eventsInRange } from '../db/queries';
import { uuidV5 } from '../util/uuidV5';
import { MINUTE_MS, isSleepKind } from './eventFacts';

/*
 * A night sleep that ends logs the Wake-up marker (docs/design/20-feeding-amounts.md section 4):
 * stopping a running night (`sleep` with `kind: "night"`) also creates a `sleep` instant
 * `{kind: "woke_up"}` at the night's end, in the same local transaction (events + outbox), so the
 * ring, the day timeline, the "Last" texts and the predictions see the baby awake. Naps, pauses and
 * night wakings never log one.
 *
 * The marker's id is derived from the night's id (UUID v5, `autoWakeUpId`): a retry or a replay
 * finds it instead of logging a second one, and an id among the night's derived ids is what makes a
 * marker "automatic" (no payload flag, no new field). An undone stop soft-deletes the marker and the
 * API keeps a deleted id deleted, so the next stop of the same night takes the next generation.
 */

/** UUID v5 namespace of the automatic wake-up ids (never change it: replays would duplicate). */
export const WAKE_UP_ID_NAMESPACE = '0b7e5d2a-3c41-5f86-9a1d-6e2f8c4b7a90';

/** How many times one night may be stopped and undone before the rule stops logging. */
export const AUTO_WAKE_UP_GENERATIONS = 16;

/** A wake-up logged by hand up to this long after the night's end already counts as its wake-up. */
const EXISTING_WAKE_UP_SLACK_MS = 15 * MINUTE_MS;

/** The id of the automatic wake-up of night `sleepId`, generation `generation` (0 first). */
export function autoWakeUpId(sleepId: string, generation = 0): string {
  return uuidV5(WAKE_UP_ID_NAMESPACE, `${sleepId.toLowerCase()}|wake|${generation}`);
}

/** Whether `event` of `type` is a night sleep (the built-in sleep type, `kind: "night"`). */
export function isNightSleep(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  event: Pick<BabyEvent, 'payload'>,
): boolean {
  return type?.babyId === null && type.key === 'sleep' && isSleepKind(event as BabyEvent, 'night');
}

interface AutoWakeUpSlot {
  /** The live automatic wake-up of the night, if any. */
  live?: BabyEvent;
  /** The id a new automatic wake-up takes (absent when every generation is used up). */
  nextId?: string;
}

/** The night's automatic wake-up: the live one, or the first derived id never used. */
async function autoWakeUpSlot(db: BabyRoutineDb, sleepId: string): Promise<AutoWakeUpSlot> {
  for (let generation = 0; generation < AUTO_WAKE_UP_GENERATIONS; generation++) {
    const id = autoWakeUpId(sleepId, generation);
    const stored = await db.events.get(id);
    if (!stored) return { nextId: id };
    if (stored.deletedAt === null) return { live: stored };
  }
  return {};
}

/** A live `woke_up` marker of the sleep type between the night's start and just after its end. */
async function hasWakeUpFor(db: BabyRoutineDb, sleep: BabyEvent, end: string): Promise<boolean> {
  const until = new Date(Date.parse(end) + EXISTING_WAKE_UP_SLACK_MS + 1).toISOString();
  const markers = await eventsInRange(db, sleep.babyId, sleep.startedAt, until);
  return markers.some((e) => e.typeId === sleep.typeId && isSleepKind(e, 'woke_up'));
}

/**
 * The id the Wake-up preset gives its marker when it stops the running night `sleepId`: the night's
 * next automatic id, so the stop and the marker stay linked (`undefined`: a random id).
 */
export async function wakeUpIdForStoppedNight(
  db: BabyRoutineDb,
  sleepId: string,
): Promise<string | undefined> {
  const slot = await autoWakeUpSlot(db, sleepId);
  return slot.live ? undefined : slot.nextId;
}

/**
 * Logs the Wake-up marker of a night that just stopped (`sleep` as stored after the stop), at its
 * end, unless it is not a night, still runs, or already has a wake-up (its automatic one, or one
 * logged by hand from its start to 15 minutes after its end). The marker is the current user's.
 * Returns the created id (for Undo), else `null`. Call inside the transaction that stops the night;
 * it must include the `events`, `outbox` and `eventTypes` tables.
 */
export async function logWakeUpForStoppedNight(
  db: BabyRoutineDb,
  sleep: BabyEvent,
  options: CommandOptions = {},
): Promise<string | null> {
  const end = sleep.endedAt;
  if (end === null || sleep.deletedAt !== null) return null;
  if (!isNightSleep(await db.eventTypes.get(sleep.typeId), sleep)) return null;
  const slot = await autoWakeUpSlot(db, sleep.id);
  if (slot.live || !slot.nextId || (await hasWakeUpFor(db, sleep, end))) return null;
  const id = slot.nextId;
  const created = await createEvent(
    db,
    {
      babyId: sleep.babyId,
      typeId: sleep.typeId,
      startedAt: end,
      endedAt: end,
      payload: { kind: 'woke_up' },
    },
    { ...options, newId: () => id },
  );
  return created.id;
}

/**
 * Keeps the automatic wake-up in step with an edit of a sleep (`before` and `after` the edit):
 * - a running night the edit ends: logs the wake-up (`logWakeUpForStoppedNight`);
 * - a finished night whose end moved: moves its automatic wake-up to the new end (a wake-up logged
 *   by hand, or none, is left alone: nothing is created for a past night);
 * - a finished night that is no longer a night or runs again: soft-deletes its automatic wake-up.
 * Only what the current user may change is touched (a Caregiver: her own events). Returns the
 * created id, else `null`. Call inside the transaction of the edit; it must include the `events`,
 * `outbox`, `eventTypes` and `babies` tables.
 */
export async function followSleepEdit(
  db: BabyRoutineDb,
  before: BabyEvent,
  after: BabyEvent,
  options: CommandOptions = {},
): Promise<string | null> {
  if (before.endedAt === null) return logWakeUpForStoppedNight(db, after, options);
  const type = await db.eventTypes.get(before.typeId);
  if (!isNightSleep(type, before)) return null;
  const { live } = await autoWakeUpSlot(db, after.id);
  if (!live) return null;
  const baby = await db.babies.get(after.babyId);
  if (baby && !canChangeEvent(baby, live)) return null;
  const night = isNightSleep(await db.eventTypes.get(after.typeId), after);
  if (!night || after.endedAt === null) {
    await deleteEvent(db, live.id, options);
  } else if (after.endedAt !== live.startedAt) {
    await editEvent(db, live.id, { startedAt: after.endedAt, endedAt: after.endedAt }, options);
  }
  return null;
}

/**
 * Runs `stop` (a command that ends a running event and returns it as stored) and, when it ended a
 * night, logs the wake-up, all in one transaction. Returns the stopped event and the created
 * wake-up id (`null` when none), for Undo.
 */
export async function stopLoggingWakeUp(
  db: BabyRoutineDb,
  stop: () => Promise<BabyEvent>,
  options: CommandOptions = {},
): Promise<{ stopped: BabyEvent; wakeUpId: string | null }> {
  return db.transaction('rw', db.events, db.outbox, db.eventTypes, db.babies, async () => {
    const stopped = await stop();
    return { stopped, wakeUpId: await logWakeUpForStoppedNight(db, stopped, options) };
  });
}

/**
 * Runs `edit` (a command that changes the stored `before` and returns it as stored) and keeps the
 * automatic wake-up in step (`followSleepEdit`), all in one transaction.
 */
export async function editFollowingWakeUp(
  db: BabyRoutineDb,
  before: BabyEvent,
  edit: () => Promise<BabyEvent>,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, db.eventTypes, db.babies, async () => {
    const after = await edit();
    await followSleepEdit(db, before, after, options);
    return after;
  });
}
