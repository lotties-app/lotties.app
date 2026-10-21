import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import {
  apiPaths,
  fromEventDto,
  fromMedicationDto,
  isEventDtoFor,
  type EventDto,
  type MedicationDto,
} from './contract';
import { syncRequest, type TransportContext } from './syncContext';

/** The server's current copy of a mutation's entity; `dto: null` = the server has none. */
export type ServerCopy =
  | { entityType: 'event'; dto: EventDto | null }
  | { entityType: 'medication'; dto: MedicationDto | null };

async function fetchEvent(ctx: TransportContext, babyId: string, id: string) {
  let body: unknown;
  try {
    body = await syncRequest<unknown>(ctx, apiPaths.event(babyId, id));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  // Never read an unexpected body as "the server has none": that would delete the local row.
  if (!isEventDtoFor(body, id)) throw new Error(`Unexpected response for event ${id}.`);
  return body;
}

async function fetchMedication(ctx: TransportContext, babyId: string, id: string) {
  const list = await syncRequest<unknown>(ctx, apiPaths.medications(babyId));
  if (!Array.isArray(list)) throw new Error('Unexpected response for the medication list.');
  return (list as MedicationDto[]).find((m) => m?.id === id) ?? null;
}

/**
 * Loads the server copy of the entity a mutation touched (`GET /events/{id}`, or the medication
 * list). Network and server failures are thrown to the caller.
 */
export async function fetchServerCopy(
  ctx: TransportContext,
  mutation: OutboxMutation,
): Promise<ServerCopy> {
  const { babyId, entityId } = mutation;
  return mutation.entityType === 'event'
    ? { entityType: 'event', dto: await fetchEvent(ctx, babyId, entityId) }
    : { entityType: 'medication', dto: await fetchMedication(ctx, babyId, entityId) };
}

/** Tables a transaction must include to use `applyServerCopy`. */
export function serverCopyTables(db: BabyRoutineDb) {
  return [db.outbox, db.events, db.medications];
}

/**
 * Replaces the local row with the server copy, or removes it when the server has none and the
 * local row never reached the server (a create: events without `createdBy`; medications have no
 * such marker, so a medication the server lacks is removed). Rows with other pending mutations
 * are left alone: those newer local edits still win until pushed. Run inside a `rw` transaction
 * over `serverCopyTables`.
 */
export async function applyServerCopy(
  db: BabyRoutineDb,
  mutation: OutboxMutation,
  copy: ServerCopy,
): Promise<void> {
  const otherPending = await db.outbox
    .where('entityId')
    .equals(mutation.entityId)
    .filter(
      (m) => m.id !== mutation.id && m.status === 'pending' && m.entityType === mutation.entityType,
    )
    .count();
  if (otherPending > 0) return;

  if (copy.entityType === 'medication') {
    if (copy.dto) await db.medications.put(fromMedicationDto(copy.dto));
    else await db.medications.delete(mutation.entityId);
    return;
  }
  if (copy.dto) {
    await db.events.put(fromEventDto(copy.dto));
    return;
  }
  const local = await db.events.get(mutation.entityId);
  if (local && local.createdBy === null) await db.events.delete(local.id);
}
