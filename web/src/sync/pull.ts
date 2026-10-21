import type { BabyRoutineDb } from '../db/database';
import { pendingEntityIds } from '../db/outbox';
import {
  apiPaths,
  fromBabyDto,
  fromEventDto,
  fromEventTypeDto,
  fromMedicationDto,
  type BabyDto,
  type EventDto,
  type EventsDeltaResponse,
  type EventTypeDto,
  type MedicationDto,
  NEXT_CURSOR_HEADER,
} from './contract';
import { classifyFailure, describeFailure } from './failures';
import { syncRequest, syncRequestWithMeta, type SyncContext } from './syncContext';

function get<T>(ctx: SyncContext, path: string) {
  return syncRequest<T>(ctx, path);
}

/** Replaces the local list of babies the user belongs to. */
export async function refreshBabies(ctx: SyncContext): Promise<string[]> {
  const babies = ((await get<BabyDto[]>(ctx, apiPaths.babies())) ?? []).map(fromBabyDto);
  await ctx.db.transaction('rw', ctx.db.babies, async () => {
    await ctx.db.babies.clear();
    await ctx.db.babies.bulkPut(babies);
  });
  return babies.map((b) => b.id);
}

/**
 * Replaces a baby's event types (custom + built-in templates) and medication catalog. Medications
 * with a queued local change are left alone until it is pushed, so an offline edit or delete is
 * not undone by a pull that runs before the push succeeded.
 */
export async function refreshCatalogs(ctx: SyncContext, babyId: string): Promise<void> {
  const [types, medications] = await Promise.all([
    get<EventTypeDto[]>(ctx, apiPaths.eventTypes(babyId)),
    get<MedicationDto[]>(ctx, apiPaths.medications(babyId)),
  ]);
  const { db } = ctx;
  await db.transaction('rw', db.eventTypes, db.medications, db.outbox, async () => {
    const pending = await pendingEntityIds(db, babyId);
    await db.eventTypes.where('babyId').equals(babyId).delete();
    await db.eventTypes.bulkPut((types ?? []).map(fromEventTypeDto));
    await db.medications
      .where('babyId')
      .equals(babyId)
      .filter((m) => !pending.has(m.id))
      .delete();
    await db.medications.bulkPut(
      (medications ?? []).filter((m) => !pending.has(m.id)).map(fromMedicationDto),
    );
  });
}

/** Newest raw `updatedAt` among `items` and the current cursor (never moves backwards). */
function newestCursor(items: EventDto[], current: string | undefined): string | undefined {
  let newest = current;
  for (const item of items) {
    if (!newest || Date.parse(item.updatedAt) > Date.parse(newest)) newest = item.updatedAt;
  }
  return newest;
}

/**
 * Merges a delta into the local store with last-write-wins on `updatedAt`, skipping events that
 * still have a pending local mutation (they win until pushed). The cursor is written in the same
 * transaction, so it only advances when the merge commits.
 */
export async function mergeEventDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: EventDto[],
): Promise<void> {
  await db.transaction('rw', db.events, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromEventDto);
    const locals = await db.events.bulkGet(incoming.map((e) => e.id));
    const winners = incoming.filter((e, i) => {
      const local = locals[i];
      return !local || Date.parse(e.updatedAt) >= Date.parse(local.updatedAt);
    });
    await db.events.bulkPut(winners);

    const cursor = await db.syncState.get([babyId, 'events']);
    const next = newestCursor(items, cursor?.lastSyncedAt);
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'events', lastSyncedAt: next });
    }
  });
}

/**
 * Re-pull window: rows whose transaction committed late can carry an `updatedAt` slightly older
 * than rows already received, so each pull starts this much before the stored cursor.
 */
export const PULL_OVERLAP_MS = 5_000;

export class RepeatedCursorError extends Error {
  constructor(cursor: string) {
    super(`Events delta paging returned the same cursor twice (${cursor}); stopped.`);
    this.name = 'RepeatedCursorError';
  }
}

function overlappedSince(lastSyncedAt: string | undefined): string | undefined {
  if (!lastSyncedAt) return undefined;
  const ms = Date.parse(lastSyncedAt);
  return Number.isNaN(ms) ? lastSyncedAt : new Date(ms - PULL_OVERLAP_MS).toISOString();
}

/**
 * Pulls the events delta from the stored cursor (minus the overlap) and follows `X-Next-Cursor`
 * pages until it is absent. Each page is merged in its own transaction, so the stored cursor only
 * advances with a committed page and an interrupted pull resumes where it stopped.
 */
export async function pullEvents(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'events']);
  const seen = new Set<string>();
  let path = apiPaths.eventsDelta(babyId, { since: overlappedSince(cursor?.lastSyncedAt) });
  for (;;) {
    const { data, headers } = await syncRequestWithMeta<EventsDeltaResponse>(ctx, path);
    await mergeEventDelta(ctx.db, babyId, data ?? []);
    const next = headers.get(NEXT_CURSOR_HEADER);
    if (!next) return;
    if (seen.has(next)) throw new RepeatedCursorError(next);
    seen.add(next);
    path = apiPaths.eventsDelta(babyId, { after: next });
  }
}

/**
 * Refreshes babies, then each baby's catalogs and events. A permanent (4xx) failure or a paging
 * loop for one baby is collected and the others continue; network/401/transient failures are
 * rethrown.
 */
export async function pullAll(ctx: SyncContext): Promise<string[]> {
  const errors: string[] = [];
  for (const babyId of await refreshBabies(ctx)) {
    try {
      await refreshCatalogs(ctx, babyId);
      await pullEvents(ctx, babyId);
    } catch (error) {
      const perBaby =
        error instanceof RepeatedCursorError || classifyFailure(error) === 'permanent';
      if (!perBaby) throw error;
      errors.push(`baby ${babyId}: ${describeFailure(error)}`);
    }
  }
  return errors;
}
