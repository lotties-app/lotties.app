import type { BabyRoutineDb } from './database';
import type { BabyEvent, EventPayload, MutationKind } from './models';
import { dropDeadUpserts, enqueueMutation } from './outbox';
import {
  EventAlreadyStoppedError,
  EventDeletedError,
  EventNotFoundError,
  InvalidEventTimeRangeError,
} from './errors';
import { toEventUpsertRequest, toUtcIso } from '../sync/contract';
import { isPaused, normalizePause, withPause, withResume } from '../timers/pauseMath';

/** Injectable clock and id source (tests); defaults to the system clock and `crypto.randomUUID`. */
export interface CommandOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface CreateEventInput {
  babyId: string;
  typeId: string;
  /** Defaults to now. */
  startedAt?: string;
  /** `null`/omitted starts a running event (timer). */
  endedAt?: string | null;
  payload?: EventPayload;
  notes?: string | null;
}

export interface EditEventChanges {
  typeId?: string;
  startedAt?: string;
  endedAt?: string | null;
  payload?: EventPayload;
  notes?: string | null;
}

function nowIso(options: CommandOptions) {
  return (options.now?.() ?? new Date()).toISOString();
}

/**
 * Marks a local edit: `clientUpdatedAt` is the edit time sent as `updatedAt` on push, and the local
 * `updatedAt` follows it until the server's copy (with its own clock) replaces the row.
 */
function editStamp(now: string): Pick<BabyEvent, 'updatedAt' | 'clientUpdatedAt'> {
  return { updatedAt: now, clientUpdatedAt: now };
}

function ensureValidRange(event: BabyEvent) {
  if (event.endedAt !== null && event.endedAt < event.startedAt) {
    throw new InvalidEventTimeRangeError(event.id);
  }
}

/**
 * The event as the API accepts it: once it ended, an open pause is folded into `paused_seconds`
 * (stopping while paused finalizes the pause) and `paused_seconds` never exceeds the length; the
 * pause keys are whole numbers. Events without pause keys are returned unchanged.
 */
function withSettledPause(event: BabyEvent): BabyEvent {
  const payload = normalizePause(event.payload, event.startedAt, event.endedAt);
  return payload === event.payload ? event : { ...event, payload };
}

/** Writes `event` and queues the matching mutation atomically. */
async function saveWithMutation(db: BabyRoutineDb, event: BabyEvent, kind: MutationKind) {
  await db.transaction('rw', db.events, db.outbox, async () => {
    await db.events.put(event);
    await enqueueMutation(db, {
      babyId: event.babyId,
      kind,
      entityType: 'event',
      entityId: event.id,
      payload: kind === 'upsert' ? toEventUpsertRequest(event) : null,
      createdAt: event.updatedAt,
    });
  });
  return event;
}

async function loadLiveEvent(db: BabyRoutineDb, id: string): Promise<BabyEvent> {
  const event = await db.events.get(id);
  if (!event) throw new EventNotFoundError(id);
  if (event.deletedAt) throw new EventDeletedError(id);
  return event;
}

export async function createEvent(
  db: BabyRoutineDb,
  input: CreateEventInput,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  const now = nowIso(options);
  const event: BabyEvent = {
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId: input.babyId,
    typeId: input.typeId,
    startedAt: input.startedAt ? toUtcIso(input.startedAt) : now,
    endedAt: input.endedAt ? toUtcIso(input.endedAt) : null,
    payload: input.payload ?? {},
    notes: input.notes ?? null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
    deletedAt: null,
  };
  ensureValidRange(event);
  return saveWithMutation(db, withSettledPause(event), 'upsert');
}

export async function editEvent(
  db: BabyRoutineDb,
  id: string,
  changes: EditEventChanges,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await loadLiveEvent(db, id);
    const edited: BabyEvent = {
      ...current,
      typeId: changes.typeId ?? current.typeId,
      startedAt: changes.startedAt ? toUtcIso(changes.startedAt) : current.startedAt,
      endedAt:
        changes.endedAt === undefined
          ? current.endedAt
          : changes.endedAt && toUtcIso(changes.endedAt),
      payload: changes.payload ?? current.payload,
      notes: changes.notes === undefined ? current.notes : changes.notes,
      ...editStamp(nowIso(options)),
    };
    ensureValidRange(edited);
    return saveWithMutation(db, withSettledPause(edited), 'upsert');
  });
}

/** Ends a running event, at `endedAt` or now. */
export async function stopEvent(
  db: BabyRoutineDb,
  id: string,
  endedAt?: string,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await loadLiveEvent(db, id);
    if (current.endedAt !== null) throw new EventAlreadyStoppedError(id);
    const now = nowIso(options);
    const stopped: BabyEvent = {
      ...current,
      endedAt: endedAt ? toUtcIso(endedAt) : now,
      ...editStamp(now),
    };
    ensureValidRange(stopped);
    return saveWithMutation(db, withSettledPause(stopped), 'upsert');
  });
}

async function loadRunning(db: BabyRoutineDb, id: string): Promise<BabyEvent> {
  const current = await loadLiveEvent(db, id);
  if (current.endedAt !== null) throw new EventAlreadyStoppedError(id);
  return current;
}

/**
 * Pauses a running timer: `paused_at` = now. Pausing a paused timer changes nothing. The elapsed
 * time stops counting from then (`effectiveElapsedSeconds`); the timer keeps running as an event.
 */
export async function pauseTimer(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await loadRunning(db, id);
    if (isPaused(current)) return current;
    const now = nowIso(options);
    return saveWithMutation(
      db,
      { ...current, payload: withPause(current.payload, Date.parse(now)), ...editStamp(now) },
      'upsert',
    );
  });
}

/**
 * Resumes a paused timer: the pause is added to `paused_seconds`, `pause_count` grows by one and
 * `paused_at` is removed. Resuming a timer that is not paused changes nothing.
 */
export async function resumeTimer(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await loadRunning(db, id);
    if (!isPaused(current)) return current;
    const now = nowIso(options);
    return saveWithMutation(
      db,
      { ...current, payload: withResume(current.payload, Date.parse(now)), ...editStamp(now) },
      'upsert',
    );
  });
}

/**
 * Completes an event with fixed details: sets `payload`, stops it now (or at `endedAt`) when it
 * still runs, and drops the dead-lettered upserts of the event in the same transaction (the new
 * upsert carries the full, fixed state and supersedes them). Used by "Finish this ..." when a
 * timer is stopped without its required fields, and by the Fix action of a rejected change.
 */
export async function finishEvent(
  db: BabyRoutineDb,
  id: string,
  payload: EventPayload,
  endedAt?: string,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await loadLiveEvent(db, id);
    const now = nowIso(options);
    const finished: BabyEvent = {
      ...current,
      payload,
      endedAt: current.endedAt ?? (endedAt ? toUtcIso(endedAt) : now),
      ...editStamp(now),
    };
    ensureValidRange(finished);
    await dropDeadUpserts(db, id);
    return saveWithMutation(db, withSettledPause(finished), 'upsert');
  });
}

/** Soft-deletes an event. Deleting an already deleted event is a no-op. */
export async function deleteEvent(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<BabyEvent> {
  return db.transaction('rw', db.events, db.outbox, async () => {
    const current = await db.events.get(id);
    if (!current) throw new EventNotFoundError(id);
    if (current.deletedAt) return current;
    const now = nowIso(options);
    return saveWithMutation(db, { ...current, deletedAt: now, ...editStamp(now) }, 'delete');
  });
}
