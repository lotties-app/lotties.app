import type { BabyRoutineDb } from '../db/database';
import type { Note } from '../db/models';
import { pendingEntityIds } from '../db/outbox';
import { apiPaths, fromNoteDto, type NoteDto } from '../sync/contract';
import { syncRequest, type SyncContext } from '../sync/syncContext';

/** Re-pull window before the stored cursor, as `PULL_OVERLAP_MS` of the other pulls (sync/pull.ts). */
const OVERLAP_MS = 5_000;

function overlappedSince(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const ms = Date.parse(cursor);
  return Number.isNaN(ms) ? cursor : new Date(ms - OVERLAP_MS).toISOString();
}

const editTime = (note: Note) => Date.parse(note.clientUpdatedAt ?? note.updatedAt);

/**
 * Merges pulled notes like appointments: a copy with a queued local change is skipped until it is
 * pushed, a deletion always wins, otherwise the newer client edit time wins. The server only sends
 * the notes this user may see. The cursor moves in the same transaction.
 */
export async function mergeNoteDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: NoteDto[],
): Promise<void> {
  await db.transaction('rw', db.notes, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromNoteDto);
    const locals = await db.notes.bulkGet(incoming.map((n) => n.id));
    const wins = (remote: Note, local: Note | undefined) =>
      !local || remote.deletedAt !== null || editTime(remote) >= editTime(local);
    await db.notes.bulkPut(incoming.filter((n, i) => wins(n, locals[i])));

    const cursor = await db.syncState.get([babyId, 'notes']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'notes', lastSyncedAt: next });
    }
  });
}

/** Pulls the notes changed since the stored cursor (minus the overlap), deleted included. */
export async function pullNotes(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'notes']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await syncRequest<NoteDto[]>(ctx, apiPaths.notes(babyId, since));
  await mergeNoteDelta(ctx.db, babyId, Array.isArray(items) ? items : []);
}
