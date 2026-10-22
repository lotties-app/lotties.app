import { isOwnEvent } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { deadLetter } from './deadLetters';
import { announceRejection } from './rejectionNotice';
import { applyServerCopy, fetchServerCopy, serverCopyTables, type ServerCopy } from './serverCopy';
import type { TransportContext } from './syncContext';

/*
 * Role rejections of queued changes (docs/SPEC.md "Roles and permissions"). Each refused change
 * leaves the queue, so the rest syncs, and the notice is raised once per rejection.
 */

type Ctx = TransportContext & { db: BabyRoutineDb };

/**
 * A change to an event someone else logged (a Caregiver, 403 `event_not_owned`) is dropped from
 * the queue and the server copy is put back (the edit or delete is reverted; a running timer it
 * stopped runs again, as it still does on the server). The user's own entries are never touched:
 * the server only refuses other people's. When the copy cannot be loaded (offline, 5xx) the change
 * is dead-lettered instead, so Settings > Sync can reload it on Discard.
 */
export async function dropNotOwned(
  ctx: Ctx,
  mutation: OutboxMutation,
  lastError: string,
): Promise<void> {
  let copy: ServerCopy;
  try {
    copy = await fetchServerCopy(ctx, mutation);
  } catch {
    await deadLetter(ctx, mutation, {
      attempts: mutation.attempts + 1,
      failureCount: mutation.failureCount ?? 0,
      lastError,
    });
    announceRejection('notOwned');
    return;
  }
  const { db } = ctx;
  await db.transaction('rw', serverCopyTables(db), async () => {
    await db.outbox.delete(mutation.id);
    await applyServerCopy(db, mutation, copy);
  });
  announceRejection('notOwned');
}

/**
 * Whether the mutation is about the user's own event: not synced yet (no `createdBy`) or created
 * by the user (`Baby.userId`). Such entries are kept on screen when a role change refuses them.
 */
export async function isOwnLocalEvent(db: BabyRoutineDb, mutation: OutboxMutation) {
  if (mutation.entityType !== 'event') return false;
  const [event, baby] = await Promise.all([
    db.events.get(mutation.entityId),
    db.babies.get(mutation.babyId),
  ]);
  if (!event) return false;
  return isOwnEvent({ userId: baby?.userId ?? null }, event);
}

/**
 * A change the user's role no longer allows (403 without a code): dead-lettered (out of the queue,
 * kept for Retry once the role is back, or Discard), keeping the user's own entries on screen;
 * other entries go back to the server copy.
 */
export async function deadLetterForRole(
  ctx: Ctx,
  mutation: OutboxMutation,
  lastError: string,
): Promise<void> {
  const keepLocal = await isOwnLocalEvent(ctx.db, mutation);
  await deadLetter(
    ctx,
    mutation,
    { attempts: mutation.attempts + 1, failureCount: mutation.failureCount ?? 0, lastError },
    { keepLocal },
  );
  announceRejection('role');
}
