import {
  DECLINE_REASON_MAX,
  PROPOSAL_NAME_MAX,
  isOpen,
  type ProposalTerms,
} from '../proposals/proposalModel';
import { toProposalUpsertRequest, type ProposalDecisionPayload } from '../sync/contract';
import type { BabyRoutineDb } from './database';
import type { CommandOptions } from './eventCommands';
import type { Proposal } from './models';
import { enqueueMutation } from './outbox';

/**
 * `name`: the medication name needs 1-100 characters; `gone`: the proposal is not on this device;
 * `decided`: it is no longer open (decided, withdrawn or waiting for its decision to sync).
 */
export type InvalidProposalCode = 'name' | 'gone' | 'decided';

export class InvalidProposalError extends Error {
  readonly code: InvalidProposalCode;

  constructor(message: string, code: InvalidProposalCode) {
    super(message);
    this.name = 'InvalidProposalError';
    this.code = code;
  }
}

/** The client mirror of the API rule: a trimmed medication name of 1-100 characters. */
function normalized(terms: ProposalTerms): ProposalTerms {
  const medicationName = terms.medicationName.trim();
  if (!medicationName || medicationName.length > PROPOSAL_NAME_MAX) {
    throw new InvalidProposalError(
      'A proposal needs a medication name of 1 to 100 characters.',
      'name',
    );
  }
  return { ...terms, medicationName };
}

/** The local calendar day of `date` as `yyyy-mm-dd` (the day a replaced prescription ends). */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function queueUpsert(db: BabyRoutineDb, proposal: Proposal, now: string) {
  await enqueueMutation(db, {
    babyId: proposal.babyId,
    kind: 'upsert',
    entityType: 'proposal',
    entityId: proposal.id,
    payload: toProposalUpsertRequest(proposal),
    createdAt: now,
  });
}

/**
 * Writes a pending proposal locally (the user is its author, the baby's Doctor) and queues its
 * upsert (`PUT /babies/{id}/prescription-proposals/{id}`).
 */
export async function createProposal(
  db: BabyRoutineDb,
  babyId: string,
  authorUserId: string | null,
  terms: ProposalTerms,
  options: CommandOptions = {},
): Promise<Proposal> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const proposal: Proposal = {
    ...normalized(terms),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    authorUserId,
    author: null,
    status: 'pending',
    declineReason: null,
    cancelReason: null,
    decidedBy: null,
    decidedAt: null,
    acceptedPrescriptionId: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
  };
  await db.transaction('rw', db.proposals, db.outbox, async () => {
    await db.proposals.put(proposal);
    await queueUpsert(db, proposal, now);
  });
  return proposal;
}

/** Replaces the terms of her own pending proposal locally and queues its full state. */
export async function updateProposal(
  db: BabyRoutineDb,
  id: string,
  terms: ProposalTerms,
  options: CommandOptions = {},
): Promise<Proposal> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.proposals, db.outbox, async () => {
    const current = await db.proposals.get(id);
    if (!current) throw new InvalidProposalError('This proposal is not on this device.', 'gone');
    if (!isOpen(current)) {
      throw new InvalidProposalError('A decided proposal cannot be edited.', 'decided');
    }
    const updated: Proposal = {
      ...current,
      ...normalized(terms),
      updatedAt: now,
      clientUpdatedAt: now,
    };
    await db.proposals.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/**
 * Withdraws her pending proposal: cancelled locally with the reason `withdrawn` and
 * `DELETE .../prescription-proposals/{id}` queued (it absorbs a queued edit). A decided proposal is
 * left as it is: the server treats the withdraw as a no-op too.
 */
export async function withdrawProposal(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<void> {
  const now = (options.now?.() ?? new Date()).toISOString();
  await db.transaction('rw', db.proposals, db.outbox, async () => {
    const current = await db.proposals.get(id);
    if (!current || !isOpen(current)) return;
    await db.proposals.put({
      ...current,
      status: 'cancelled',
      cancelReason: 'withdrawn',
      updatedAt: now,
      clientUpdatedAt: now,
    });
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'delete',
      entityType: 'proposal',
      entityId: id,
      payload: null,
      createdAt: now,
    });
  });
}

async function decide(
  db: BabyRoutineDb,
  id: string,
  now: string,
  payload: ProposalDecisionPayload,
  change: Partial<Proposal>,
): Promise<void> {
  await db.transaction('rw', db.proposals, db.outbox, async () => {
    const current = await db.proposals.get(id);
    if (!current) throw new InvalidProposalError('This suggestion is not on this device.', 'gone');
    if (!isOpen(current)) {
      throw new InvalidProposalError('This suggestion was already decided.', 'decided');
    }
    await db.proposals.put({
      ...current,
      ...change,
      decidedAt: now,
      decisionPending: true,
    });
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'upsert',
      entityType: 'proposalDecision',
      entityId: id,
      payload,
      createdAt: now,
    });
  });
}

/**
 * A parent accepts a pending proposal. The device picks the id of the prescription the server will
 * create (so a replay of the queued request creates it once) and the local day it ends a replaced
 * prescription on. Locally the proposal reads accepted and "Waiting to sync"; the prescription
 * itself appears when the accept reaches the server (it resolves the medication there).
 */
export async function acceptProposal(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<{ prescriptionId: string }> {
  const clock = options.now?.() ?? new Date();
  const prescriptionId = options.newId?.() ?? crypto.randomUUID();
  await decide(
    db,
    id,
    clock.toISOString(),
    { action: 'accept', prescriptionId, acceptedOn: localDay(clock) },
    { status: 'accepted', acceptedPrescriptionId: prescriptionId },
  );
  return { prescriptionId };
}

/** A parent declines a pending proposal, with an optional reason (up to 500 characters) the doctor sees. */
export async function declineProposal(
  db: BabyRoutineDb,
  id: string,
  reason: string | null,
  options: CommandOptions = {},
): Promise<void> {
  const clock = options.now?.() ?? new Date();
  const trimmed = reason?.trim().slice(0, DECLINE_REASON_MAX) || null;
  await decide(
    db,
    id,
    clock.toISOString(),
    { action: 'decline', reason: trimmed },
    { status: 'declined', declineReason: trimmed },
  );
}

/**
 * Marks a shared note read by this user (the recommendations inbox): stored locally at once and
 * queued (`PUT .../notes/{id}/read`). Marking a note again changes nothing.
 */
export async function markNoteRead(
  db: BabyRoutineDb,
  babyId: string,
  noteId: string,
  options: CommandOptions = {},
): Promise<void> {
  const now = (options.now?.() ?? new Date()).toISOString();
  await db.transaction('rw', db.noteReads, db.outbox, async () => {
    if (await db.noteReads.get(noteId)) return;
    await db.noteReads.put({ noteId, babyId, readAt: now });
    await enqueueMutation(db, {
      babyId,
      kind: 'upsert',
      entityType: 'noteRead',
      entityId: `read:${noteId}`,
      payload: { noteId },
      createdAt: now,
    });
  });
}
