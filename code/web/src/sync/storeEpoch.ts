import type { BabyRoutineDb } from '../db/database';
import { SYNC_EPOCH_HEADER } from './contract';

/*
 * The baby's store epoch (docs/SPEC.md "Store epoch", docs/design/47-bring-your-own-database.md
 * section 2.3): a per-baby counter the server sends in `X-Sync-Epoch` that changes only when the
 * baby's records move to another data store (Lotties' database or the family's own). A store can
 * also go backwards (a restored database), so the delta cursors of the old store mean nothing in
 * the new one: when the epoch changes, every cursor of that baby is dropped and the next pulls
 * fetch everything again. The outbox is never touched. The epoch is not a time and is never
 * compared with `updatedAt`.
 */

/** The epoch every baby has until its records move for the first time. */
export const INITIAL_STORE_EPOCH = '0';

/** A decimal integer as the server sends it; anything else is ignored (an older server sends none). */
export function readStoreEpoch(headers: Headers): string | null {
  const value = headers.get(SYNC_EPOCH_HEADER)?.trim();
  return value && /^\d{1,20}$/.test(value) ? value : null;
}

/**
 * Compares `epoch` with the one stored for `babyId` and, when it differs, drops the baby's delta
 * cursors in the same transaction as the new epoch is stored. A first sighting of a moved baby
 * (no stored epoch, epoch not `0`: this device synced before the move with an older app) also
 * resets. Returns whether the cursors were dropped (a full pull follows).
 */
export async function adoptStoreEpoch(
  db: BabyRoutineDb,
  babyId: string,
  epoch: string | null,
): Promise<boolean> {
  if (epoch === null) return false;
  return db.transaction('rw', db.syncState, async () => {
    const stored = await db.syncState.get([babyId, 'storeEpoch']);
    if (stored?.lastSyncedAt === epoch) return false;
    const reset = (stored?.lastSyncedAt ?? INITIAL_STORE_EPOCH) !== epoch;
    if (reset) {
      await db.syncState
        .where('babyId')
        .equals(babyId)
        .filter((row) => row.entity !== 'storeEpoch')
        .delete();
    }
    await db.syncState.put({ babyId, entity: 'storeEpoch', lastSyncedAt: epoch });
    return reset;
  });
}
