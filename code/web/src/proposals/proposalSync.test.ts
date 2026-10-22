import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Proposal } from '../db/models';
import {
  acceptProposal,
  createProposal,
  declineProposal,
  InvalidProposalError,
  markNoteRead,
  updateProposal,
  withdrawProposal,
} from '../db/proposalCommands';
import { purgeBabyData } from '../db/purge';
import {
  BABY_ID,
  SERVER_TIME,
  fakeApi,
  httpError,
  networkError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import {
  fromPrescriptionDto,
  type NoteReadDto,
  type PrescriptionDto,
  type ProposalDecisionResponse,
  type ProposalDto,
  type ProposalUpsertRequest,
} from '../sync/contract';
import { dismissRejectionNotice, currentRejectionNotice } from '../sync/rejectionNotice';
import { SyncEngine } from '../sync/SyncEngine';
import { mergeNoteReadDelta, mergeProposalDelta } from './proposalSync';
import type { ProposalTerms } from './proposalModel';

/*
 * Prescription proposals sync (docs/design/16-doctor-access.md section 10): the Doctor writes,
 * edits and withdraws offline; a parent accepts or declines offline and the accept reaches the
 * server once, with the prescription id the device chose; a first read of a recommendation is
 * queued; pulls never overwrite a row with a queued change.
 */

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  dismissRejectionNotice();
  await db.delete();
});

function setup(handler?: ApiHandler) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: new EventTarget(),
    isOnline: () => true,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
  });
  engines.push(engine);
  return { engine, ...fake };
}

const TERMS: ProposalTerms = {
  medicationId: null,
  productId: null,
  medicationName: '  Colidis ',
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 480,
  maxDosesPer24h: null,
  indication: 'belly pain',
  intervalGroup: null,
  startDate: '2026-10-22',
  endDate: null,
  instructions: 'After the feed.',
  replacesPrescriptionId: null,
};

const ANA = {
  userId: 'doctor-1',
  displayName: 'Ana Souza',
  professional: { kind: 'doctor', displayName: 'Ana Souza', verified: false },
};

const dto = (id: string, extra: Partial<ProposalDto> = {}): ProposalDto => ({
  id,
  babyId: BABY_ID,
  authorUserId: 'doctor-1',
  author: ANA,
  medicationId: null,
  productId: null,
  medicationName: 'Colidis',
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 480,
  maxDosesPer24h: null,
  indication: 'belly pain',
  intervalGroup: null,
  startDate: '2026-10-22',
  endDate: null,
  instructions: null,
  replacesPrescriptionId: null,
  status: 'pending',
  declineReason: null,
  cancelReason: null,
  decidedBy: null,
  decidedAt: null,
  acceptedPrescriptionId: null,
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-22T09:00:00.000Z',
  clientUpdatedAt: '2026-10-22T09:00:00.000Z',
  ...extra,
});

const idIn = (path: string) => /prescription-proposals\/([^/?]+)/.exec(path)![1];

function echoProposal(call: ApiCall): ProposalDto {
  const body = call.body as ProposalUpsertRequest;
  return {
    ...dto(idIn(call.path)),
    ...body,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
  } as ProposalDto;
}

const NOW = () => new Date('2026-10-22T10:00:00.000Z');

describe('the Doctor writes proposals', () => {
  it('queues a trimmed pending proposal and pushes the last edit with the server copy adopted', async () => {
    const created = await createProposal(db, BABY_ID, 'doctor-1', TERMS, {
      now: NOW,
      newId: () => 'p1',
    });
    await updateProposal(db, created.id, { ...TERMS, medicationName: 'Colidis drops' });
    const { engine, writes } = setup((call) =>
      call.method === 'PUT' && call.path.includes('/prescription-proposals/')
        ? echoProposal(call)
        : undefined,
    );

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/prescription-proposals/p1`,
    ]);
    expect(writes()[0].body).toMatchObject({
      medicationName: 'Colidis drops',
      kind: 'asNeeded',
      replacesPrescriptionId: null,
      instructions: 'After the feed.',
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.proposals.get('p1')).toMatchObject({
      status: 'pending',
      author: { displayName: 'Ana Souza' },
      updatedAt: SERVER_TIME,
    });
  });

  it('refuses a missing name, and an edit of a proposal that is no longer open', async () => {
    await expect(
      createProposal(db, BABY_ID, null, { ...TERMS, medicationName: '   ' }),
    ).rejects.toMatchObject({ code: 'name' });
    await expect(
      createProposal(db, BABY_ID, null, { ...TERMS, medicationName: 'x'.repeat(101) }),
    ).rejects.toBeInstanceOf(InvalidProposalError);
    await db.proposals.put(fromDto(dto('done', { status: 'accepted' })));

    await expect(updateProposal(db, 'done', TERMS)).rejects.toMatchObject({ code: 'decided' });
    await expect(updateProposal(db, 'nope', TERMS)).rejects.toMatchObject({ code: 'gone' });
  });

  it('lets a withdraw absorb the queued edits and sends one DELETE', async () => {
    const created = await createProposal(db, BABY_ID, 'doctor-1', TERMS, { newId: () => 'p2' });
    await updateProposal(db, created.id, { ...TERMS, indication: 'colic' });
    await withdrawProposal(db, created.id);
    const { engine, writes } = setup();

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /api/v1/babies/${BABY_ID}/prescription-proposals/p2`,
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.proposals.get('p2')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'withdrawn',
    });
  });

  it('leaves a decided proposal alone when it is withdrawn', async () => {
    await db.proposals.put(fromDto(dto('done', { status: 'declined' })));

    await withdrawProposal(db, 'done');

    expect((await db.proposals.get('done'))?.status).toBe('declined');
    expect(await db.outbox.count()).toBe(0);
  });

  it('dead-letters an edit the server refuses because it was decided, shows the stored proposal and says so once', async () => {
    const created = await createProposal(db, BABY_ID, 'doctor-1', TERMS, { newId: () => 'p3' });
    const decided = dto('p3', { status: 'accepted', decidedAt: '2026-10-22T11:00:00.000Z' });
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(409, 'proposal_decided');
      if (call.method === 'GET' && call.path.endsWith('/prescription-proposals/p3')) return decided;
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
    expect(await db.proposals.get(created.id)).toMatchObject({ status: 'accepted' });
    expect(currentRejectionNotice()?.kind).toBe('proposalDecided');
  });
});

/** The DTO as a local row (what a pull stores). */
function fromDto(value: ProposalDto): Proposal {
  return {
    ...(value as unknown as Proposal),
    author: null,
    cancelReason: (value.cancelReason as Proposal['cancelReason']) ?? null,
  } as Proposal;
}

const prescriptionDto = (id: string): PrescriptionDto => ({
  id,
  babyId: BABY_ID,
  medicationId: 'm1',
  status: 'active',
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops' },
  minIntervalMinutes: 480,
  startDate: '2026-10-22',
  prescriber: 'Ana Souza',
  prescribedByUserId: 'doctor-1',
  prescribedByName: 'Ana Souza',
  prescribedBy: ANA,
  proposalId: 'p5',
  changedByParent: false,
  original: {
    medicationName: 'Colidis',
    kind: 'asNeeded',
    dose: { amount: 5, unit: 'drops' },
    minIntervalMinutes: 480,
    startDate: '2026-10-22',
  },
  createdAt: SERVER_TIME,
  updatedAt: SERVER_TIME,
  clientUpdatedAt: SERVER_TIME,
});

describe('a parent decides', () => {
  beforeEach(async () => {
    await db.proposals.put(fromDto(dto('p5', { createdAt: '2026-10-22T09:00:00.000Z' })));
  });

  it('shows the accept at once as waiting to sync and queues one request with the prescription id', async () => {
    const { prescriptionId } = await acceptProposal(db, 'p5', {
      now: () => new Date(2026, 9, 22, 23, 30),
      newId: () => 'rx-new',
    });

    expect(prescriptionId).toBe('rx-new');
    expect(await db.proposals.get('p5')).toMatchObject({
      status: 'accepted',
      decisionPending: true,
      acceptedPrescriptionId: 'rx-new',
    });
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({
      entityType: 'proposalDecision',
      entityId: 'p5',
      kind: 'upsert',
      payload: { action: 'accept', prescriptionId: 'rx-new', acceptedOn: '2026-10-22' },
    });
    await expect(acceptProposal(db, 'p5')).rejects.toMatchObject({ code: 'decided' });
  });

  it('applies an offline accept once: a replay reuses the prescription id, then the server outcome is adopted', async () => {
    await acceptProposal(db, 'p5', { newId: () => 'rx-new' });
    let online = false;
    const outcome: ProposalDecisionResponse = {
      proposal: dto('p5', {
        status: 'accepted',
        acceptedPrescriptionId: 'rx-new',
        decidedAt: SERVER_TIME,
        updatedAt: SERVER_TIME,
      }),
      prescription: { ...prescriptionDto('rx-new') },
    };
    const { engine, writes, calls } = setup((call) => {
      if (call.method !== 'POST') return undefined;
      if (!online) throw networkError();
      return outcome;
    });

    await engine.syncNow();
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1);
    expect((await db.proposals.get('p5'))?.decisionPending).toBe(true);

    online = true;
    await engine.syncNow();
    await engine.syncNow();

    const posts = writes().filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual([
      `/api/v1/babies/${BABY_ID}/prescription-proposals/p5/accept`,
      `/api/v1/babies/${BABY_ID}/prescription-proposals/p5/accept`,
    ]);
    expect(posts.map((c) => c.body)).toEqual([
      expect.objectContaining({ prescriptionId: 'rx-new' }),
      expect.objectContaining({ prescriptionId: 'rx-new' }),
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.proposals.get('p5'))?.decisionPending).toBeFalsy();
    expect(await db.prescriptions.count()).toBe(1);
    expect(await db.prescriptions.get('rx-new')).toMatchObject({
      prescribedByName: 'Ana Souza',
      proposalId: 'p5',
      changedByParent: false,
    });
    // The pull of the same run brings the medication the accept may have added.
    expect(calls.some((c) => c.method === 'GET' && c.path.endsWith('/medications'))).toBe(true);
  });

  it('declines with the trimmed reason and adopts the stored proposal', async () => {
    await declineProposal(db, 'p5', '  We will wait.  ');
    const { engine, writes } = setup((call) =>
      call.method === 'POST'
        ? {
            proposal: dto('p5', {
              status: 'declined',
              declineReason: 'We will wait.',
              updatedAt: SERVER_TIME,
            }),
            prescription: null,
          }
        : undefined,
    );
    expect(await db.proposals.get('p5')).toMatchObject({
      status: 'declined',
      declineReason: 'We will wait.',
      decisionPending: true,
    });

    await engine.syncNow();

    expect(writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: `/api/v1/babies/${BABY_ID}/prescription-proposals/p5/decline`,
        body: { reason: 'We will wait.' },
      }),
    ]);
    expect(await db.proposals.get('p5')).toMatchObject({ status: 'declined' });
    expect((await db.proposals.get('p5'))?.decisionPending).toBeFalsy();
  });

  it('dead-letters a decision on a proposal that is no longer pending and shows what the server has', async () => {
    await acceptProposal(db, 'p5');
    const { engine } = setup((call) => {
      if (call.method === 'POST') throw httpError(409, 'proposal_not_pending');
      if (call.method === 'GET' && call.path.endsWith('/prescription-proposals/p5')) {
        return dto('p5', {
          status: 'cancelled',
          cancelReason: 'withdrawn',
          updatedAt: SERVER_TIME,
        });
      }
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
    expect(await db.proposals.get('p5')).toMatchObject({
      status: 'cancelled',
      cancelReason: 'withdrawn',
    });
    expect((await db.proposals.get('p5'))?.decisionPending).toBeFalsy();
    expect(currentRejectionNotice()?.kind).toBe('proposalDecided');
  });

  it('retries a lost race (409 concurrent_modification) with backoff instead of giving up', async () => {
    await acceptProposal(db, 'p5');
    const { engine } = setup((call) => {
      if (call.method === 'POST') throw httpError(409, 'concurrent_modification');
      return undefined;
    });

    await engine.syncNow();

    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({ status: 'pending', attempts: 1 });
    expect(queued.nextAttemptAt).not.toBeNull();
    expect(currentRejectionNotice()).toBeNull();
  });
});

describe('a first read of a recommendation', () => {
  it('is stored at once, queued once, and keeps the time the server stored', async () => {
    await markNoteRead(db, BABY_ID, 'n1', { now: NOW });
    await markNoteRead(db, BABY_ID, 'n1', { now: NOW });
    expect(await db.outbox.count()).toBe(1);
    expect(await db.noteReads.get('n1')).toMatchObject({ readAt: '2026-10-22T10:00:00.000Z' });
    const { engine, writes } = setup((call) =>
      call.method === 'PUT' ? { noteId: 'n1', readAt: '2026-10-22T10:00:03.000Z' } : undefined,
    );

    await engine.syncNow();

    expect(writes()).toEqual([
      expect.objectContaining({ method: 'PUT', path: `/api/v1/babies/${BABY_ID}/notes/n1/read` }),
    ]);
    expect(writes()[0].body).toBeUndefined();
    expect(await db.noteReads.get('n1')).toMatchObject({ readAt: '2026-10-22T10:00:03.000Z' });
    expect(await db.outbox.count()).toBe(0);
  });

  it('is dropped without a dead letter when the note is gone', async () => {
    await markNoteRead(db, BABY_ID, 'gone');
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(404, 'note_not_found');
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.count()).toBe(0);
    expect(currentRejectionNotice()).toBeNull();
  });
});

describe('pulling proposals and reads', () => {
  it('stores what the server sent, skips a row with a queued decision, and moves the cursor', async () => {
    await db.proposals.put(fromDto(dto('mine')));
    await acceptProposal(db, 'mine');

    await mergeProposalDelta(db, BABY_ID, [
      dto('remote', { updatedAt: '2026-10-22T12:00:00.000Z', medicationName: 'From the server' }),
      dto('mine', { status: 'pending', medicationName: 'Older server copy' }),
    ]);

    expect((await db.proposals.get('remote'))?.medicationName).toBe('From the server');
    expect(await db.proposals.get('mine')).toMatchObject({
      status: 'accepted',
      decisionPending: true,
    });
    expect(await db.syncState.get([BABY_ID, 'proposals'])).toMatchObject({
      lastSyncedAt: '2026-10-22T12:00:00.000Z',
    });
  });

  it('lets a decision made elsewhere replace the local pending copy', async () => {
    await db.proposals.put(fromDto(dto('p')));

    await mergeProposalDelta(db, BABY_ID, [
      dto('p', { status: 'declined', declineReason: 'No', updatedAt: '2026-10-22T13:00:00.000Z' }),
    ]);

    expect(await db.proposals.get('p')).toMatchObject({ status: 'declined', declineReason: 'No' });
  });

  it('reads an unknown status as cancelled, never offered for a decision', async () => {
    await mergeProposalDelta(db, BABY_ID, [dto('p', { status: 'frozen' })]);

    expect((await db.proposals.get('p'))?.status).toBe('cancelled');
  });

  it('stores the reads of the user and moves the cursor to the newest', async () => {
    const reads: NoteReadDto[] = [
      { noteId: 'a', readAt: '2026-10-22T08:00:00Z' },
      { noteId: 'b', readAt: '2026-10-22T09:00:00Z' },
    ];

    await mergeNoteReadDelta(db, BABY_ID, reads);

    expect((await db.noteReads.toArray()).map((r) => r.noteId).sort()).toEqual(['a', 'b']);
    expect(await db.syncState.get([BABY_ID, 'noteReads'])).toMatchObject({
      lastSyncedAt: '2026-10-22T09:00:00Z',
    });
  });

  it.each([
    ['Owner', true, true],
    ['Parent', true, true],
    ['Doctor', true, false],
    ['Caregiver', false, false],
    ['Viewer', false, false],
  ])('pulls for a %s: proposals %s, reads %s', async (role, proposals, reads) => {
    await db.syncState.put({
      babyId: BABY_ID,
      entity: 'proposals',
      lastSyncedAt: '2026-10-22T09:00:00.000Z',
    });
    const { engine, calls } = setup((call) =>
      call.path === '/api/v1/babies'
        ? [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }]
        : undefined,
    );

    await engine.syncNow();

    const proposalPull = calls.find((c) => c.path.includes('/prescription-proposals'));
    expect(!!proposalPull).toBe(proposals);
    if (proposalPull) {
      expect(proposalPull.path).toBe(
        `/api/v1/babies/${BABY_ID}/prescription-proposals?since=${encodeURIComponent('2026-10-22T08:59:55.000Z')}`,
      );
    }
    expect(calls.some((c) => c.path.includes('/note-reads'))).toBe(reads);
  });
});

describe('proposal data on the device', () => {
  it('is purged with the baby', async () => {
    await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
    await db.proposals.put(fromDto(dto('p')));
    await markNoteRead(db, BABY_ID, 'n1');

    await purgeBabyData(db, BABY_ID);

    expect(await db.proposals.count()).toBe(0);
    expect(await db.noteReads.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('maps the provenance of a prescription, and none for one the parents entered', () => {
    const sourced = fromPrescriptionDto(prescriptionDto('rx1'));
    const own = fromPrescriptionDto({
      ...prescriptionDto('rx2'),
      prescribedByUserId: null,
      prescribedByName: null,
      prescribedBy: null,
      proposalId: null,
      original: null,
    });
    const old = fromPrescriptionDto({
      id: 'rx3',
      babyId: BABY_ID,
      medicationId: 'm1',
      status: 'active',
      kind: 'asNeeded',
      dose: { amount: 1, unit: 'ml' },
      startDate: '2026-10-22',
      createdAt: SERVER_TIME,
      updatedAt: SERVER_TIME,
    });

    expect(sourced).toMatchObject({
      prescribedByName: 'Ana Souza',
      prescribedBy: { displayName: 'Ana Souza' },
      proposalId: 'p5',
      changedByParent: false,
      original: { medicationName: 'Colidis', dose: { amount: 5, unit: 'drops', perKg: false } },
    });
    expect(own).toMatchObject({ prescribedByName: null, proposalId: null, original: null });
    expect(old.prescribedByName).toBeUndefined();
  });
});
