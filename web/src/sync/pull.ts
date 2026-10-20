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
} from './contract';
import { classifyFailure, describeFailure } from './failures';
import { requestSignal, type SyncContext } from './syncContext';

function get<T>(ctx: SyncContext, path: string) {
  return ctx.api.request<T>(path, { signal: requestSignal(ctx) });
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

/** Replaces a baby's event types (custom + built-in templates) and medication catalog. */
export async function refreshCatalogs(ctx: SyncContext, babyId: string): Promise<void> {
  const [types, medications] = await Promise.all([
    get<EventTypeDto[]>(ctx, apiPaths.eventTypes(babyId)),
    get<MedicationDto[]>(ctx, apiPaths.medications(babyId)),
  ]);
  const { db } = ctx;
  await db.transaction('rw', db.eventTypes, db.medications, async () => {
    await db.eventTypes.where('babyId').equals(babyId).delete();
    await db.eventTypes.bulkPut((types ?? []).map(fromEventTypeDto));
    await db.medications.where('babyId').equals(babyId).delete();
    await db.medications.bulkPut((medications ?? []).map(fromMedicationDto));
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

/** Pulls the events delta since the stored cursor and merges it. */
export async function pullEvents(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'events']);
  const items = await get<EventsDeltaResponse>(
    ctx,
    apiPaths.eventsDelta(babyId, cursor?.lastSyncedAt),
  );
  await mergeEventDelta(ctx.db, babyId, items ?? []);
}

/**
 * Refreshes babies, then each baby's catalogs and events. A permanent (4xx) failure for one
 * baby is collected and the others continue; network/401/transient failures are rethrown.
 */
export async function pullAll(ctx: SyncContext): Promise<string[]> {
  const errors: string[] = [];
  for (const babyId of await refreshBabies(ctx)) {
    try {
      await refreshCatalogs(ctx, babyId);
      await pullEvents(ctx, babyId);
    } catch (error) {
      if (classifyFailure(error) !== 'permanent') throw error;
      errors.push(`baby ${babyId}: ${describeFailure(error)}`);
    }
  }
  return errors;
}
