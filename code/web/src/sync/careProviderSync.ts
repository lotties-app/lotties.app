import { canSeeFamilyRecords } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import type { CareProvider } from '../db/models';
import { pendingEntityIds } from '../db/outbox';
import { apiPaths, fromCareProviderDto, type CareProviderDto } from './contract';
import { syncRequest, type SyncContext } from './syncContext';

/** Re-pull window before the stored cursor, as `PULL_OVERLAP_MS` of the other pulls (sync/pull.ts). */
const OVERLAP_MS = 5_000;

function overlappedSince(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const ms = Date.parse(cursor);
  return Number.isNaN(ms) ? cursor : new Date(ms - OVERLAP_MS).toISOString();
}

const editTime = (p: CareProvider) => Date.parse(p.clientUpdatedAt ?? p.updatedAt);

/**
 * Merges pulled providers like appointments: a copy with a queued local change is skipped until
 * it is pushed, otherwise the newer client edit time wins (a deleted one arrives like any edit).
 * The cursor moves in the same transaction.
 */
export async function mergeCareProviderDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: CareProviderDto[],
): Promise<void> {
  await db.transaction('rw', db.careProviders, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromCareProviderDto);
    const locals = await db.careProviders.bulkGet(incoming.map((p) => p.id));
    const wins = (remote: CareProvider, local: CareProvider | undefined) =>
      !local || editTime(remote) >= editTime(local);
    await db.careProviders.bulkPut(incoming.filter((p, i) => wins(p, locals[i])));

    const cursor = await db.syncState.get([babyId, 'careProviders']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'careProviders', lastSyncedAt: next });
    }
  });
}

/** Pulls the providers changed since the stored cursor (minus the overlap), deleted included. */
export async function pullCareProviders(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'careProviders']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await syncRequest<CareProviderDto[]>(ctx, apiPaths.careProviders(babyId, since));
  await mergeCareProviderDelta(ctx.db, babyId, Array.isArray(items) ? items : []);
}

/**
 * Removes a baby's providers and their cursor from this device. Run for a Doctor on every pull:
 * she never holds the family's directory (docs/design/22-care-providers.md), so copies stored
 * while the user had a family role are purged as soon as the role is Doctor.
 */
export async function dropCareProviders(db: BabyRoutineDb, babyId: string): Promise<void> {
  await db.transaction('rw', db.careProviders, db.syncState, async () => {
    await db.careProviders.where('babyId').equals(babyId).delete();
    await db.syncState.delete([babyId, 'careProviders']);
  });
}

/** Pulls the directory for the family roles; for a Doctor, never asks and drops local copies. */
export async function syncCareProviders(ctx: SyncContext, babyId: string): Promise<void> {
  const baby = await ctx.db.babies.get(babyId);
  if (baby && !canSeeFamilyRecords(baby)) {
    await dropCareProviders(ctx.db, babyId);
    return;
  }
  await pullCareProviders(ctx, babyId);
}
