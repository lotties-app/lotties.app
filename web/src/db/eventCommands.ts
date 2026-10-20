import type { BabyRoutineDb } from './database';
import type { BabyEvent, EventPayload, MutationKind } from './models';
import { enqueueMutation } from './outbox';
import {
  EventAlreadyStoppedError,
  EventDeletedError,
  EventNotFoundError,
  InvalidEventTimeRangeError,
} from './errors';
import { toEventUpsertRequest, toUtcIso } from '../sync/contract';

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

function ensureValidRange(event: BabyEvent) {
  if (event.endedAt !== null && event.endedAt < event.startedAt) {
    throw new InvalidEventTimeRangeError(event.id);
  }
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
    deletedAt: null,
  };
  ensureValidRange(event);
  return saveWithMutation(db, event, 'upsert');
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
      updatedAt: nowIso(options),
    };
    ensureValidRange(edited);
    return saveWithMutation(db, edited, 'upsert');
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
      updatedAt: now,
    };
    ensureValidRange(stopped);
    return saveWithMutation(db, stopped, 'upsert');
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
    return saveWithMutation(db, { ...current, deletedAt: now, updatedAt: now }, 'delete');
  });
}
