import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { dependencyOf, dropIfSuperseded, peekPendingMutation } from '../db/outbox';
import { backoffDelay } from './backoff';
import {
  apiPaths,
  fromAppointmentDto,
  fromCareProviderDto,
  fromEventDto,
  fromFormulaDto,
  fromNoteDto,
  fromPrescriptionDto,
  fromProposalDto,
  fromVaccinationDto,
  isAppointmentDtoFor,
  isCareProviderDtoFor,
  isEventDtoFor,
  isFormulaDtoFor,
  isNoteDtoFor,
  isPrescriptionDtoFor,
  isProposalDecisionFor,
  isProposalDtoFor,
  isVaccinationDtoFor,
  toUtcIso,
  type EventUpsertRequest,
  type NoteReadDto,
  type ProposalDecisionPayload,
} from './contract';
import { t } from '../i18n/i18n';
import {
  classifyFailure,
  countsTowardGiveUp,
  retryDelay,
  describeFailure,
  isNotOwnedRejection,
  isPayloadRejection,
  isProposalDecidedRejection,
  isRoleRejection,
} from './failures';
import { deadLetter } from './deadLetters';
import { deadLetterForRole, dropNotOwned } from './rejections';
import { announceRejection } from './rejectionNotice';
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

/** A parent's accept or decline: `POST .../accept {prescriptionId, acceptedOn}` or `.../decline {reason}`. */
function sendDecision(ctx: SyncContext, mutation: OutboxMutation): Promise<unknown> {
  const decision = mutation.payload as ProposalDecisionPayload;
  if (decision.action === 'accept') {
    return syncRequest<unknown>(ctx, apiPaths.proposalAccept(mutation.babyId, mutation.entityId), {
      method: 'POST',
      body: {
        prescriptionId: decision.prescriptionId,
        ...(decision.acceptedOn ? { acceptedOn: decision.acceptedOn } : {}),
      },
    });
  }
  return syncRequest<unknown>(ctx, apiPaths.proposalDecline(mutation.babyId, mutation.entityId), {
    method: 'POST',
    body: { reason: decision.reason ?? null },
  });
}

/** The first read of a shared note: `PUT .../notes/{id}/read`, no body. */
function sendNoteRead(ctx: SyncContext, mutation: OutboxMutation): Promise<unknown> {
  const { noteId } = mutation.payload as { noteId: string };
  return syncRequest<unknown>(ctx, apiPaths.noteRead(mutation.babyId, noteId), { method: 'PUT' });
}

async function send(ctx: SyncContext, mutation: OutboxMutation): Promise<unknown> {
  if (mutation.entityType === 'proposalDecision') return sendDecision(ctx, mutation);
  if (mutation.entityType === 'noteRead') return sendNoteRead(ctx, mutation);
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
    case 'appointment':
      return apiPaths.appointment(mutation.babyId, mutation.entityId);
    case 'careProvider':
      return apiPaths.careProvider(mutation.babyId, mutation.entityId);
    case 'vaccination':
      return apiPaths.vaccination(mutation.babyId, mutation.entityId);
    case 'note':
      return apiPaths.note(mutation.babyId, mutation.entityId);
    case 'proposal':
      return apiPaths.proposal(mutation.babyId, mutation.entityId);
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
  const tables = [
    db.outbox,
    db.events,
    db.prescriptions,
    db.formulas,
    db.appointments,
    db.careProviders,
    db.vaccinations,
    db.notes,
    db.proposals,
    db.noteReads,
  ];
  await db.transaction('rw', tables, async () => {
    await db.outbox.delete(mutation.id);
    if (mutation.entityType === 'proposalDecision') return adoptDecision(db, mutation, response);
    if (mutation.entityType === 'noteRead') return adoptNoteRead(db, mutation, response);
    const { entityType, entityId } = mutation;
    const eventCopy =
      entityType === 'event' && isEventDtoFor(response, entityId) ? response : undefined;
    const prescriptionCopy =
      entityType === 'prescription' && isPrescriptionDtoFor(response, entityId)
        ? response
        : undefined;
    const formulaCopy =
      entityType === 'formula' && isFormulaDtoFor(response, entityId) ? response : undefined;
    const appointmentCopy =
      entityType === 'appointment' && isAppointmentDtoFor(response, entityId)
        ? response
        : undefined;
    const careProviderCopy =
      entityType === 'careProvider' && isCareProviderDtoFor(response, entityId)
        ? response
        : undefined;
    const vaccinationCopy =
      entityType === 'vaccination' && isVaccinationDtoFor(response, entityId)
        ? response
        : undefined;
    const noteCopy =
      entityType === 'note' && isNoteDtoFor(response, entityId) ? response : undefined;
    const proposalCopy =
      entityType === 'proposal' && isProposalDtoFor(response, entityId) ? response : undefined;
    if (
      !eventCopy &&
      !prescriptionCopy &&
      !formulaCopy &&
      !appointmentCopy &&
      !careProviderCopy &&
      !vaccinationCopy &&
      !noteCopy &&
      !proposalCopy
    ) {
      return;
    }
    const stillPending = await db.outbox
      .where('entityId')
      .equals(entityId)
      .filter((m) => m.status === 'pending')
      .count();
    if (stillPending > 0) return;
    if (eventCopy) await db.events.put(fromEventDto(eventCopy));
    if (prescriptionCopy) await db.prescriptions.put(fromPrescriptionDto(prescriptionCopy));
    if (formulaCopy) await db.formulas.put(fromFormulaDto(formulaCopy));
    if (appointmentCopy) await db.appointments.put(fromAppointmentDto(appointmentCopy));
    if (careProviderCopy) await db.careProviders.put(fromCareProviderDto(careProviderCopy));
    if (vaccinationCopy) await db.vaccinations.put(fromVaccinationDto(vaccinationCopy));
    if (noteCopy) await db.notes.put(fromNoteDto(noteCopy));
    if (proposalCopy) await db.proposals.put(fromProposalDto(proposalCopy));
  });
}

/**
 * Adopts the outcome of an accepted or declined proposal: the proposal as the server stored it
 * (the local "Waiting to sync" state is over) and, on accept, the prescription it created. The pull
 * that follows in the same sync run brings the medication the accept may have added. An unexpected
 * body only ends the waiting state; the pull then brings the real one.
 */
async function adoptDecision(db: BabyRoutineDb, mutation: OutboxMutation, response: unknown) {
  const { entityId } = mutation;
  if (!isProposalDecisionFor(response, entityId)) {
    const local = await db.proposals.get(entityId);
    if (local?.decisionPending) await db.proposals.put({ ...local, decisionPending: false });
    return;
  }
  await db.proposals.put(fromProposalDto(response.proposal));
  const created = response.prescription;
  if (!created || !isPrescriptionDtoFor(created, created.id)) return;
  const queued = await db.outbox.where('entityId').equals(created.id).count();
  if (queued === 0) await db.prescriptions.put(fromPrescriptionDto(created));
}

/** Keeps the time of the first read the server stored (the device time stays on an unexpected body). */
async function adoptNoteRead(db: BabyRoutineDb, mutation: OutboxMutation, response: unknown) {
  const read = response as Partial<NoteReadDto> | undefined;
  const { noteId } = mutation.payload as { noteId: string };
  if (typeof read !== 'object' || read === null || typeof read.readAt !== 'string') return;
  if (read.noteId !== noteId || Number.isNaN(Date.parse(read.readAt))) return;
  await db.noteReads.put({ noteId, babyId: mutation.babyId, readAt: toUtcIso(read.readAt) });
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
  // A store failure (503 `store_*`) or a rate limit says when to come back: wait that long.
  const retryAt =
    ctx.now() + retryDelay(error, backoffDelay(attempts, ctx.backoff), ctx.backoff.maxMs);
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
      if (mutation.entityType === 'noteRead') {
        // A read is a convenience (the note may be gone or no longer visible): never a dead letter.
        await ctx.db.outbox.delete(mutation.id);
        return null;
      }
      if (isProposalDecidedRejection(error)) {
        // Someone decided first, or the doctor withdrew it: keep the change for inspection, show
        // the stored proposal and say so once.
        await deadLetter(ctx, mutation, {
          attempts: mutation.attempts + 1,
          failureCount: mutation.failureCount ?? 0,
          lastError,
        });
        announceRejection('proposalDecided');
        return null;
      }
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
