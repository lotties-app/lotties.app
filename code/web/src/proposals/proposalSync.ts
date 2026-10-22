import type { BabyRoutineDb } from '../db/database';
import type { Proposal } from '../db/models';
import { pendingEntityIds } from '../db/outbox';
import {
  apiPaths,
  fromNoteReadDto,
  fromProposalDto,
  type NoteReadDto,
  type ProposalDto,
} from '../sync/contract';
import { syncRequest, type SyncContext } from '../sync/syncContext';

/** Re-pull window before the stored cursor, as `PULL_OVERLAP_MS` of the other pulls (sync/pull.ts). */
const OVERLAP_MS = 5_000;

function overlappedSince(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  const ms = Date.parse(cursor);
  return Number.isNaN(ms) ? cursor : new Date(ms - OVERLAP_MS).toISOString();
}

const editTime = (proposal: Proposal) => Date.parse(proposal.clientUpdatedAt ?? proposal.updatedAt);

/**
 * Merges pulled proposals like notes: a copy with a queued local change (the doctor's edit or
 * withdraw, or a parent's accept or decline waiting to sync) is skipped until it is pushed,
 * otherwise the newer client edit time wins; a decision made by someone else changes only the
 * server's status, so the server copy wins the tie. The server only sends the proposals this user
 * may see. The cursor moves in the same transaction.
 */
export async function mergeProposalDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: ProposalDto[],
): Promise<void> {
  await db.transaction('rw', db.proposals, db.outbox, db.syncState, async () => {
    const pending = await pendingEntityIds(db, babyId);
    const incoming = items.filter((dto) => !pending.has(dto.id)).map(fromProposalDto);
    const locals = await db.proposals.bulkGet(incoming.map((p) => p.id));
    const wins = (remote: Proposal, local: Proposal | undefined) =>
      !local || editTime(remote) >= editTime(local);
    await db.proposals.bulkPut(incoming.filter((p, i) => wins(p, locals[i])));

    const cursor = await db.syncState.get([babyId, 'proposals']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.updatedAt) > Date.parse(next)) next = item.updatedAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'proposals', lastSyncedAt: next });
    }
  });
}

/** Pulls the proposals changed since the stored cursor (minus the overlap), every status included. */
export async function pullProposals(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'proposals']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await syncRequest<ProposalDto[]>(ctx, apiPaths.proposals(babyId, since));
  await mergeProposalDelta(ctx.db, babyId, Array.isArray(items) ? items : []);
}

/** Stores the caller's own first reads of shared notes; the cursor is the newest `readAt`. */
export async function mergeNoteReadDelta(
  db: BabyRoutineDb,
  babyId: string,
  items: NoteReadDto[],
): Promise<void> {
  await db.transaction('rw', db.noteReads, db.syncState, async () => {
    await db.noteReads.bulkPut(items.map((dto) => fromNoteReadDto(babyId, dto)));

    const cursor = await db.syncState.get([babyId, 'noteReads']);
    let next = cursor?.lastSyncedAt;
    for (const item of items) {
      if (!next || Date.parse(item.readAt) > Date.parse(next)) next = item.readAt;
    }
    if (next && next !== cursor?.lastSyncedAt) {
      await db.syncState.put({ babyId, entity: 'noteReads', lastSyncedAt: next });
    }
  });
}

/** Pulls the reads recorded since the stored cursor (minus the overlap). */
export async function pullNoteReads(ctx: SyncContext, babyId: string): Promise<void> {
  const cursor = await ctx.db.syncState.get([babyId, 'noteReads']);
  const since = overlappedSince(cursor?.lastSyncedAt);
  const items = await syncRequest<NoteReadDto[]>(ctx, apiPaths.noteReads(babyId, since));
  await mergeNoteReadDelta(ctx.db, babyId, Array.isArray(items) ? items : []);
}
