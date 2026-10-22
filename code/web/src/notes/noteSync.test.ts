import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createNote, deleteNote, InvalidNoteError, updateNote } from '../db/noteCommands';
import type { Note } from '../db/models';
import { purgeBabyData } from '../db/purge';
import {
  BABY_ID,
  SERVER_TIME,
  fakeApi,
  httpError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import type { NoteDto, NoteUpsertRequest } from '../sync/contract';
import { SyncEngine } from '../sync/SyncEngine';
import { mergeNoteDelta } from './noteSync';

/*
 * Notes sync like appointments (docs/design/16-doctor-access.md): written offline by the doctor,
 * pushed with the edit time, soft deleted; the pull merges only what the server sent (it never
 * sends another member's private note) and a deletion always wins.
 */

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
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

const TERMS = {
  kind: 'note',
  visibility: 'shared',
  body: '  Offer 120 ml every 3 hours. ',
} as const;

function echoNote(call: ApiCall): NoteDto {
  const id = /notes\/([^/?]+)/.exec(call.path)![1];
  const body = call.body as NoteUpsertRequest;
  return {
    id,
    babyId: BABY_ID,
    authorUserId: 'doctor-1',
    author: {
      userId: 'doctor-1',
      displayName: 'Ana Souza',
      professional: { kind: 'doctor', displayName: 'Ana Souza', verified: false },
    },
    ...body,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
    deletedAt: null,
  };
}

const echo: ApiHandler = (call) =>
  call.method === 'PUT' && call.path.includes('/notes/') ? echoNote(call) : undefined;

const dto = (id: string, extra: Partial<NoteDto> = {}): NoteDto => ({
  id,
  babyId: BABY_ID,
  authorUserId: 'doctor-1',
  author: null,
  kind: 'note',
  visibility: 'shared',
  body: 'From the server',
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
  clientUpdatedAt: '2026-10-20T09:00:00.000Z',
  deletedAt: null,
  ...extra,
});

describe('note commands', () => {
  it('writes the note locally with a trimmed body and queues its full state', async () => {
    const note = await createNote(db, BABY_ID, 'doctor-1', TERMS, {
      now: () => new Date('2026-10-20T10:00:00.000Z'),
      newId: () => 'n1',
    });

    expect(note).toMatchObject({
      id: 'n1',
      authorUserId: 'doctor-1',
      body: 'Offer 120 ml every 3 hours.',
    });
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({ entityType: 'note', kind: 'upsert', entityId: 'n1' });
    expect(queued.payload).toEqual({
      kind: 'note',
      visibility: 'shared',
      body: 'Offer 120 ml every 3 hours.',
      updatedAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('refuses an empty note, and a shared note made private', async () => {
    await expect(createNote(db, BABY_ID, null, { ...TERMS, body: '   ' })).rejects.toBeInstanceOf(
      InvalidNoteError,
    );
    const note = await createNote(db, BABY_ID, null, TERMS);
    await expect(
      updateNote(db, note.id, { ...TERMS, visibility: 'private' }),
    ).rejects.toMatchObject({
      code: 'shared',
    });
  });

  it('lets a private note become shared', async () => {
    const note = await createNote(db, BABY_ID, null, { ...TERMS, visibility: 'private' });

    const updated = await updateNote(db, note.id, { ...TERMS, visibility: 'shared' });

    expect(updated.visibility).toBe('shared');
  });

  it('is purged with the baby', async () => {
    await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Doctor' });
    await createNote(db, BABY_ID, null, TERMS);

    await purgeBabyData(db, BABY_ID);

    expect(await db.notes.count()).toBe(0);
  });
});

describe('pushing notes', () => {
  it('pushes a note written offline, adopts the server copy, and lets a delete absorb a queued edit', async () => {
    const note = await createNote(db, BABY_ID, null, TERMS);
    const { engine, writes } = setup(echo);
    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/notes/${note.id}`,
    ]);
    expect(await db.notes.get(note.id)).toMatchObject({
      authorUserId: 'doctor-1',
      author: { displayName: 'Ana Souza' },
      updatedAt: SERVER_TIME,
    });

    await updateNote(db, note.id, { ...TERMS, body: 'Changed' });
    await deleteNote(db, note.id);
    await engine.syncNow();

    expect(
      writes()
        .slice(1)
        .map((c) => `${c.method} ${c.path}`),
    ).toEqual([`DELETE /api/v1/babies/${BABY_ID}/notes/${note.id}`]);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.notes.get(note.id))?.deletedAt).not.toBeNull();
  });

  it('dead-letters a note the server refuses for the role and puts the server copy back', async () => {
    const note = await createNote(db, BABY_ID, null, TERMS);
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(403);
      if (call.method === 'GET' && call.path.endsWith(`/notes/${note.id}`)) throw httpError(404);
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
  });
});

describe('pulling notes', () => {
  it('stores what the server sent, skips a note with a queued change and moves the cursor', async () => {
    const local = await createNote(db, BABY_ID, null, TERMS);

    await mergeNoteDelta(db, BABY_ID, [
      dto('remote', { updatedAt: '2026-10-20T11:00:00.000Z' }),
      dto(local.id, { body: 'Older server copy' }),
    ]);

    expect((await db.notes.get('remote'))?.body).toBe('From the server');
    expect((await db.notes.get(local.id))?.body).toBe('Offer 120 ml every 3 hours.');
    expect(await db.syncState.get([BABY_ID, 'notes'])).toMatchObject({
      lastSyncedAt: '2026-10-20T11:00:00.000Z',
    });
  });

  it('lets a deletion win over a newer local edit and an older edit lose', async () => {
    const stored: Note = {
      id: 'n',
      babyId: BABY_ID,
      authorUserId: 'doctor-1',
      author: null,
      kind: 'note',
      visibility: 'shared',
      body: 'Local',
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
      clientUpdatedAt: '2026-10-20T12:00:00.000Z',
      deletedAt: null,
    };
    await db.notes.put(stored);

    await mergeNoteDelta(db, BABY_ID, [dto('n', { body: 'Older' })]);
    expect((await db.notes.get('n'))?.body).toBe('Local');

    await mergeNoteDelta(db, BABY_ID, [dto('n', { deletedAt: '2026-10-20T10:00:00.000Z' })]);
    expect((await db.notes.get('n'))?.deletedAt).toBe('2026-10-20T10:00:00.000Z');
  });

  it('pulls the notes of every baby with the stored cursor during a sync', async () => {
    await db.syncState.put({ babyId: BABY_ID, entity: 'notes', lastSyncedAt: SERVER_TIME });
    const { engine, calls } = setup((call) => {
      if (call.path === '/api/v1/babies') {
        return [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Doctor' }];
      }
      if (call.path.startsWith(`/api/v1/babies/${BABY_ID}/notes`)) return [dto('pulled')];
      return undefined;
    });

    await engine.syncNow();

    const pull = calls.find((c) => c.path.includes('/notes'));
    expect(pull?.path).toBe(
      `/api/v1/babies/${BABY_ID}/notes?since=${encodeURIComponent('2026-10-20T11:59:55.000Z')}`,
    );
    expect(await db.notes.get('pulled')).toBeTruthy();
  });
});
