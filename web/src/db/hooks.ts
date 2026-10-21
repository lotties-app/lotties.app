import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from './DatabaseContext';
import {
  allBabies,
  entitySyncStates,
  eventsInRange,
  eventsStartedSince,
  eventTypesFor,
  liveEvent,
  medicationsFor,
  oldestEventStart,
  runningEvents,
} from './queries';
import {
  createEvent,
  deleteEvent,
  editEvent,
  stopEvent,
  type CreateEventInput,
  type EditEventChanges,
} from './eventCommands';
import { createMedication, type CreateMedicationInput } from './medicationCommands';

/*
 * Reads come straight from Dexie through `useLiveQuery`, which re-runs on any local or synced
 * change. Events are deliberately NOT mirrored in the TanStack Query cache: Dexie is the single
 * source of truth and the sync engine is the only thing that talks to the events API.
 * Each hook returns `undefined` while the first query is loading.
 */

export function useBabies() {
  const db = useDatabase();
  return useLiveQuery(() => allBabies(db), [db]);
}

export function useEventTypes(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => eventTypesFor(db, babyId), [db, babyId]);
}

export function useMedications(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => medicationsFor(db, babyId), [db, babyId]);
}

/** Live events with `from <= startedAt < to` (UTC ISO strings). */
export function useEventsInRange(babyId: string, from: string, to: string) {
  const db = useDatabase();
  return useLiveQuery(() => eventsInRange(db, babyId, from, to), [db, babyId, from, to]);
}

/** Live events with `startedAt >= from` (UTC ISO), newest first. */
export function useEventsStartedSince(babyId: string, from: string) {
  const db = useDatabase();
  return useLiveQuery(() => eventsStartedSince(db, babyId, from), [db, babyId, from]);
}

/** `startedAt` of the oldest live event; `null` when there is none (`undefined` while loading). */
export function useOldestEventStart(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(async () => (await oldestEventStart(db, babyId)) ?? null, [db, babyId]);
}

/** Pending / dead-lettered outbox state per entity id (absent = synced). */
export function useEntitySyncStates(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => entitySyncStates(db, babyId), [db, babyId]);
}

export function useRunningEvents(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => runningEvents(db, babyId), [db, babyId]);
}

export function useEvent(id: string) {
  const db = useDatabase();
  return useLiveQuery(() => liveEvent(db, id), [db, id]);
}

export function useMedicationCommands() {
  const db = useDatabase();
  return { create: (input: CreateMedicationInput) => createMedication(db, input) };
}

/** Event commands bound to the provided database (local write + outbox, picked up by sync). */
export function useEventCommands() {
  const db = useDatabase();
  return {
    create: (input: CreateEventInput) => createEvent(db, input),
    edit: (id: string, changes: EditEventChanges) => editEvent(db, id, changes),
    stop: (id: string, endedAt?: string) => stopEvent(db, id, endedAt),
    remove: (id: string) => deleteEvent(db, id),
  };
}
