import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { dependencyOf, dropIfSuperseded, peekPendingMutation } from '../db/outbox';
import { backoffDelay } from './backoff';
import {
  apiPaths,
  fromEventDto,
  fromFormulaDto,
  fromPrescriptionDto,
  isEventDtoFor,
  isFormulaDtoFor,
  isPrescriptionDtoFor,
  type EventUpsertRequest,
} from './contract';
import { t } from '../i18n/i18n';
import {
  classifyFailure,
  countsTowardGiveUp,
  describeFailure,
  isNotOwnedRejection,
  isPayloadRejection,
  isRoleRejection,
} from './failures';
import { deadLetter } from './deadLetters';
import { deadLetterForRole, dropNotOwned } from './rejections';
import { syncRequest, type SyncContext } from './syncContext';

/**
 * Consecutive server failures (HTTP 500, unknown errors) after which a mutation is dead-lettered,
 * so one request the server can never accept does not block the queue forever.
 */
export const MAX_SERVER_FAILURES = 8;

export type PushOutcome =
  | { kind: 'drained' }
  /** The queue head is waiting for its backoff to elapse. */
  | { kind: 'backoff'; retryAt: number; error: string | null }
  | { kind: 'offline'; error: string }
  /** The access token is being renewed: nothing was sent, retry once it is. */
  | { kind: 'waitingForToken' }
  | { kind: 'unauthorized' };

/**
 * Pushes pending mutations strictly in queue order. A head superseded by a later mutation of the
 * same entity is coalesced into it first (only the latest full state is sent). Stops at the first
 * network error, 401 or transient failure (so later mutations never overtake earlier ones);
 * permanently rejected mutations, and ones that failed `MAX_SERVER_FAILURES` times in a row, are
 * dead-lettered and skipped. A change to someone else's event that the user's role does not allow
 * (403 `event_not_owned`) is dropped and the entry put back (`dropNotOwned`).
 */
export async function pushOutbox(ctx: SyncContext): Promise<PushOutcome> {
  for (;;) {
    const head = await peekPendingMutation(ctx.db);
    if (!head) return { kind: 'drained' };
    if (await dropIfSuperseded(ctx.db, head)) continue;
    const retryAt = head.nextAttemptAt ? Date.parse(head.nextAttemptAt) : 0;
    if (retryAt > ctx.now()) return { kind: 'backoff', retryAt, error: head.lastError };
    const outcome = await pushOne(ctx, await firstDependency(ctx, head));
    if (outcome) return outcome;
  }
}

/**
 * The mutation to send for `head`: its dependencies first (event -> prescription -> medication,
 * bottle -> formula).
 */
async function firstDependency(ctx: SyncContext, head: OutboxMutation): Promise<OutboxMutation> {
  let target = head;
  for (let depth = 0; depth < 3; depth += 1) {
    const dependency = await dependencyOf(ctx.db, target);
    if (!dependency) break;
    target = dependency;
  }
  return target;
}

/**
 * The server rejected an event because a prescription or formula it names is missing, while that
 * one is still queued: not a dead letter, the loop pushes it and retries the event.
 */
async function waitsForDependency(ctx: SyncContext, mutation: OutboxMutation, error: unknown) {
  if (mutation.entityType !== 'event' || !isPayloadRejection(error)) return false;
  if (!/prescriptionId|formula_id/.test(error.problem?.field ?? '')) return false;
  return (await dependencyOf(ctx.db, mutation)) !== undefined;
}

async function pushOne(ctx: SyncContext, mutation: OutboxMutation): Promise<PushOutcome | null> {
  let response: unknown;
  try {
    response = await send(ctx, mutation);
  } catch (error) {
    if (await waitsForDependency(ctx, mutation, error)) return null;
    if (!isAlreadyDeleted(mutation, error)) return recordFailure(ctx, mutation, error);
  }
  await acknowledge(ctx.db, mutation, response);
  return null;
}

async function send(ctx: SyncContext, mutation: OutboxMutation): Promise<unknown> {
  const path = pathOf(mutation);
  if (mutation.kind === 'upsert') {
    return syncRequest<unknown>(ctx, path, { method: 'PUT', body: upsertBody(mutation) });
  }
  await syncRequest<unknown>(ctx, path, { method: 'DELETE' });
  return undefined;
}

function pathOf(mutation: OutboxMutation): string {
  switch (mutation.entityType) {
    case 'medication':
      return apiPaths.medication(mutation.babyId, mutation.entityId);
    case 'prescription':
      return apiPaths.prescription(mutation.babyId, mutation.entityId);
    case 'formula':
      return apiPaths.formula(mutation.babyId, mutation.entityId);
    default:
      return apiPaths.event(mutation.babyId, mutation.entityId);
  }
}

/**
 * Event upserts carry the local edit time as `updatedAt` so the server's last-write-wins can drop
 * stale replays. Mutations queued before that field existed fall back to their enqueue time,
 * which is the event's edit time at the moment of the edit.
 */
function upsertBody(mutation: OutboxMutation): unknown {
  if (mutation.entityType === 'medication') return mutation.payload;
  const body = mutation.payload as Partial<EventUpsertRequest>;
  return body.updatedAt ? body : { ...body, updatedAt: mutation.createdAt };
}

/** A DELETE answered with 404 means the server has nothing to delete: the goal is met. */
function isAlreadyDeleted(mutation: OutboxMutation, error: unknown) {
  return mutation.kind === 'delete' && error instanceof ApiError && error.status === 404;
}

/**
 * Removes the pushed mutation and adopts the server's copy unless newer local changes are queued.
 * The server copy wins even when it differs from what was sent (a stale `updatedAt` was ignored
 * and the stored copy returned, or the event was already deleted on the server).
 */
async function acknowledge(db: BabyRoutineDb, mutation: OutboxMutation, response: unknown) {
  await db.transaction('rw', [db.outbox, db.events, db.prescriptions, db.formulas], async () => {
    await db.outbox.delete(mutation.id);
    const { entityType, entityId } = mutation;
    const eventCopy =
      entityType === 'event' && isEventDtoFor(response, entityId) ? response : undefined;
    const prescriptionCopy =
      entityType === 'prescription' && isPrescriptionDtoFor(response, entityId)
        ? response
        : undefined;
    const formulaCopy =
      entityType === 'formula' && isFormulaDtoFor(response, entityId) ? response : undefined;
    if (!eventCopy && !prescriptionCopy && !formulaCopy) return;
    const stillPending = await db.outbox
      .where('entityId')
      .equals(entityId)
      .filter((m) => m.status === 'pending')
      .count();
    if (stillPending > 0) return;
    if (eventCopy) await db.events.put(fromEventDto(eventCopy));
    if (prescriptionCopy) await db.prescriptions.put(fromPrescriptionDto(prescriptionCopy));
    if (formulaCopy) await db.formulas.put(fromFormulaDto(formulaCopy));
  });
}

function giveUpMessage(lastError: string) {
  return t('sync.gaveUp', { attempts: MAX_SERVER_FAILURES, error: lastError });
}

async function recordTransient(
  ctx: SyncContext,
  mutation: OutboxMutation,
  error: unknown,
  lastError: string,
): Promise<PushOutcome | null> {
  const attempts = mutation.attempts + 1;
  const failureCount = (mutation.failureCount ?? 0) + (countsTowardGiveUp(error) ? 1 : 0);
  if (failureCount >= MAX_SERVER_FAILURES) {
    await deadLetter(ctx, mutation, {
      attempts,
      failureCount,
      lastError: giveUpMessage(lastError),
    });
    return null;
  }
  const retryAt = ctx.now() + backoffDelay(attempts, ctx.backoff);
  await ctx.db.outbox.update(mutation.id, {
    attempts,
    failureCount,
    lastError,
    nextAttemptAt: new Date(retryAt).toISOString(),
  });
  return { kind: 'backoff', retryAt, error: lastError };
}

async function recordFailure(
  ctx: SyncContext,
  mutation: OutboxMutation,
  error: unknown,
): Promise<PushOutcome | null> {
  const kind = classifyFailure(error);
  const lastError = describeFailure(error);
  switch (kind) {
    case 'unauthorized':
      return { kind: 'unauthorized' };
    case 'waitingForToken':
      return { kind: 'waitingForToken' };
    case 'network':
      await ctx.db.outbox.update(mutation.id, { lastError });
      return { kind: 'offline', error: lastError };
    case 'transient':
      return recordTransient(ctx, mutation, error, lastError);
    case 'permanent':
      if (mutation.entityType === 'event' && isNotOwnedRejection(error)) {
        await dropNotOwned(ctx, mutation, lastError);
        return null;
      }
      if (isRoleRejection(error)) {
        await deadLetterForRole(ctx, mutation, lastError);
        return null;
      }
      await deadLetter(ctx, mutation, {
        attempts: mutation.attempts + 1,
        failureCount: mutation.failureCount ?? 0,
        lastError,
        ...(isPayloadRejection(error) && mutation.entityType === 'event'
          ? { needsAttention: true, rejectedField: error.problem?.field ?? null }
          : {}),
      });
      return null;
  }
}
