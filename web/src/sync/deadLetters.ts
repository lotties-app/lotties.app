import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { applyServerCopy, fetchServerCopy, serverCopyTables, type ServerCopy } from './serverCopy';
import type { TransportContext } from './syncContext';

type DeadLetterPatch = Pick<OutboxMutation, 'attempts' | 'failureCount' | 'lastError'>;

/**
 * Dead-letters a rejected mutation and, in the same transaction, puts the server copy of its
 * entity back in the local store: a pull skipped the entity while the mutation was pending and has
 * moved its cursor on, so without this the rejected local state would stay forever. Loading the
 * copy is best effort here (offline, 5xx): `discardDeadLetter` loads it again.
 */
export async function deadLetter(
  ctx: TransportContext & { db: BabyRoutineDb },
  mutation: OutboxMutation,
  patch: DeadLetterPatch,
): Promise<void> {
  const copy: ServerCopy | null = await fetchServerCopy(ctx, mutation).catch(() => null);
  const { db } = ctx;
  await db.transaction('rw', serverCopyTables(db), async () => {
    await db.outbox.update(mutation.id, { ...patch, status: 'dead', nextAttemptAt: null });
    if (copy) await applyServerCopy(db, mutation, copy);
  });
}

/**
 * Drops a dead-lettered mutation and replaces the local row with the server's copy (or removes a
 * create the server never stored), in one transaction. Loading the copy needs the server: when it
 * fails the error is thrown and nothing is discarded.
 */
export async function discardDeadLetter(
  ctx: TransportContext & { db: BabyRoutineDb },
  id: number,
): Promise<void> {
  const { db } = ctx;
  const mutation = await db.outbox.get(id);
  if (!mutation || mutation.status !== 'dead') return;
  const copy = await fetchServerCopy(ctx, mutation);
  await db.transaction('rw', serverCopyTables(db), async () => {
    const current = await db.outbox.get(id);
    if (!current || current.status !== 'dead') return;
    await db.outbox.delete(id);
    await applyServerCopy(db, current, copy);
  });
}
