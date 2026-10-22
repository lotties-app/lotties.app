import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import { createNote, deleteNote, updateNote } from '../db/noteCommands';
import type { NoteTerms } from './noteModel';

/** The baby's notes on this device (deleted ones included; `timelineOf` drops them). */
export function useNotes(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => db.notes.where('babyId').equals(babyId).toArray(), [db, babyId]);
}

/** Note commands bound to the account's database (offline first: saved, then queued for sync). */
export function useNoteCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, authorUserId: string | null, terms: NoteTerms) =>
      createNote(db, babyId, authorUserId, terms),
    update: (id: string, terms: NoteTerms) => updateNote(db, id, terms),
    remove: (id: string) => deleteNote(db, id),
  };
}
