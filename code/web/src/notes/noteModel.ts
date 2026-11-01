import type { Baby, Note, NoteKind, NoteVisibility, PersonSummary } from '../db/models';

/*
 * Notes about a baby (docs/design/16-doctor-access.md): written by the baby's Doctor, read by every
 * member when shared, by the author only when private (the server never sends a private note to
 * anyone else). Pure helpers, no I/O.
 */

/** The longest note the API accepts (characters after trimming). */
export const NOTE_BODY_MAX = 4000;

export const NOTE_KINDS: readonly NoteKind[] = ['note', 'recommendation'];
export const NOTE_VISIBILITIES: readonly NoteVisibility[] = ['shared', 'private'];

/** The editable part of a note. */
export interface NoteTerms {
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
}

export function noteTermsOf(note: Note): NoteTerms {
  return { kind: note.kind, visibility: note.visibility, body: note.body };
}

/** The notes to list, newest written first; deleted ones are gone. */
export function timelineOf(notes: readonly Note[]): Note[] {
  return notes
    .filter((note) => note.deletedAt === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Whether the note is the user's own: written on this device (no author yet) or by `baby.userId`. */
export function isOwnNote(baby: Pick<Baby, 'userId'>, note: Pick<Note, 'authorUserId'>): boolean {
  if (note.authorUserId === null) return true;
  return !!baby.userId && note.authorUserId === baby.userId;
}

/** A shared note stays shared: the server refuses to make it private again. */
export function canMakePrivate(note: Pick<Note, 'visibility'> | undefined): boolean {
  return note === undefined || note.visibility === 'private';
}

/**
 * The name to show after "Dr." for a professional: the name she declared, without a title she may
 * have typed herself ("Dra. Ana" -> "Ana"), so the screen never reads "Dr. Dra. Ana".
 */
export function doctorNameOf(person: Pick<PersonSummary, 'displayName' | 'professional'>): string {
  const name = person.professional?.displayName ?? person.displayName;
  return (
    name.replace(/^\s*(dr\(a\)|dra|dr|doctor|doutora|doutor)\.?\s+/i, '').trim() || name.trim()
  );
}

/** Shared notes `userId` wrote on the baby that are not deleted (the Patients list count). */
export function sharedNotesBy(notes: readonly Note[], userId: string | null | undefined): number {
  if (!userId) return 0;
  return notes.filter(
    (note) =>
      note.deletedAt === null && note.visibility === 'shared' && note.authorUserId === userId,
  ).length;
}
