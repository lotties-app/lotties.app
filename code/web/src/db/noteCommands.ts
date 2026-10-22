import { NOTE_BODY_MAX, type NoteTerms } from '../notes/noteModel';
import { toNoteUpsertRequest } from '../sync/contract';
import type { BabyRoutineDb } from './database';
import type { CommandOptions } from './eventCommands';
import type { Note } from './models';
import { enqueueMutation } from './outbox';

/**
 * `body`: 1-4000 characters are required; `shared`: a shared note cannot become private again;
 * `gone`: the note is not on this device.
 */
export type InvalidNoteCode = 'body' | 'shared' | 'gone';

export class InvalidNoteError extends Error {
  readonly code: InvalidNoteCode;

  constructor(message: string, code: InvalidNoteCode) {
    super(message);
    this.name = 'InvalidNoteError';
    this.code = code;
  }
}

/** The client mirror of the API rules: a trimmed body of 1-4000 characters. */
function normalized(terms: NoteTerms): NoteTerms {
  const body = terms.body.trim();
  if (!body || body.length > NOTE_BODY_MAX) {
    throw new InvalidNoteError('A note needs 1 to 4000 characters.', 'body');
  }
  return {
    kind: terms.kind === 'recommendation' ? 'recommendation' : 'note',
    visibility: terms.visibility === 'private' ? 'private' : 'shared',
    body,
  };
}

async function queueUpsert(db: BabyRoutineDb, note: Note, now: string) {
  await enqueueMutation(db, {
    babyId: note.babyId,
    kind: 'upsert',
    entityType: 'note',
    entityId: note.id,
    payload: toNoteUpsertRequest(note),
    createdAt: now,
  });
}

/** Writes a note locally (the user is its author) and queues its upsert (`PUT /babies/{id}/notes/{id}`). */
export async function createNote(
  db: BabyRoutineDb,
  babyId: string,
  authorUserId: string | null,
  terms: NoteTerms,
  options: CommandOptions = {},
): Promise<Note> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const note: Note = {
    ...normalized(terms),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    authorUserId,
    author: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
    deletedAt: null,
  };
  await db.transaction('rw', db.notes, db.outbox, async () => {
    await db.notes.put(note);
    await queueUpsert(db, note, now);
  });
  return note;
}

/** Replaces the terms of the user's own note locally and queues its full state. */
export async function updateNote(
  db: BabyRoutineDb,
  id: string,
  terms: NoteTerms,
  options: CommandOptions = {},
): Promise<Note> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.notes, db.outbox, async () => {
    const current = await db.notes.get(id);
    if (!current || current.deletedAt !== null) {
      throw new InvalidNoteError('This note is not on this device.', 'gone');
    }
    const next = normalized(terms);
    if (current.visibility === 'shared' && next.visibility === 'private') {
      throw new InvalidNoteError('A shared note cannot become private.', 'shared');
    }
    const updated: Note = { ...current, ...next, updatedAt: now, clientUpdatedAt: now };
    await db.notes.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/** Soft deletes the user's own note locally and queues `DELETE /babies/{id}/notes/{id}`. */
export async function deleteNote(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<void> {
  const now = (options.now?.() ?? new Date()).toISOString();
  await db.transaction('rw', db.notes, db.outbox, async () => {
    const current = await db.notes.get(id);
    if (!current || current.deletedAt !== null) return;
    await db.notes.put({ ...current, deletedAt: now, updatedAt: now, clientUpdatedAt: now });
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'delete',
      entityType: 'note',
      entityId: id,
      payload: null,
      createdAt: now,
    });
  });
}
