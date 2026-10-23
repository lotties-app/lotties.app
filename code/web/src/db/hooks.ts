import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from './DatabaseContext';
import { BABIES_LISTED_KEY, type EventPayload } from './models';
import {
  cancelAppointment,
  createAppointment,
  markAppointmentDone,
  restoreAppointment,
  updateAppointment,
  type AppointmentTerms,
} from './appointmentCommands';
import {
  createCareProvider,
  deleteCareProvider,
  restoreCareProvider,
  setCareProviderFavorite,
  updateCareProvider,
  type CareProviderTerms,
} from './careProviderCommands';
import {
  allBabies,
  appointmentsFor,
  careProvidersFor,
  entitySyncStates,
  eventsInRange,
  eventsStartedSince,
  eventTypesFor,
  formulasFor,
  liveEvent,
  medicationsFor,
  latestBodyWeight,
  allPrescriptionsFor,
  oldestEventStart,
  prescriptionsFor,
  runningEvents,
} from './queries';
import {
  createEvent,
  deleteEvent,
  editEvent,
  finishEvent,
  stopEvent,
  type CreateEventInput,
  type EditEventChanges,
} from './eventCommands';
import {
  createMedication,
  deleteMedication,
  updateMedication,
  type CreateMedicationInput,
  type MedicationChanges,
} from './medicationCommands';
import {
  createPrescription,
  deletePrescription,
  setPrescriptionStatus,
  updatePrescription,
  type PrescriptionTerms,
} from './prescriptionCommands';
import type { PrescriptionStatus } from './models';
import {
  createFormula,
  setCurrentFormula,
  setFormulaArchived,
  updateFormula,
  type FormulaTerms,
} from './formulaCommands';

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

/**
 * Whether a babies fetch ever succeeded on this device (so an empty local list really means "no
 * baby yet", not "could not load"). `undefined` while loading.
 */
export function useBabiesListed() {
  const db = useDatabase();
  return useLiveQuery(
    async () => (await db.syncState.get([BABIES_LISTED_KEY, 'babies'])) !== undefined,
    [db],
  );
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
  return {
    create: (input: CreateMedicationInput) => createMedication(db, input),
    update: (id: string, changes: MedicationChanges) => updateMedication(db, id, changes),
    remove: (id: string) => deleteMedication(db, id),
  };
}

/** Event commands bound to the provided database (local write + outbox, picked up by sync). */
export function useEventCommands() {
  const db = useDatabase();
  return {
    create: (input: CreateEventInput) => createEvent(db, input),
    edit: (id: string, changes: EditEventChanges) => editEvent(db, id, changes),
    stop: (id: string, endedAt?: string) => stopEvent(db, id, endedAt),
    finish: (id: string, payload: EventPayload, endedAt?: string) =>
      finishEvent(db, id, payload, endedAt),
    remove: (id: string) => deleteEvent(db, id),
  };
}

/** The baby's prescriptions that are not deleted (`undefined` while loading). */
export function usePrescriptions(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => prescriptionsFor(db, babyId), [db, babyId]);
}

/** Every prescription of the baby, deleted ones included (they still name logged doses). */
export function useAllPrescriptions(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => allPrescriptionsFor(db, babyId), [db, babyId]);
}

/** The latest known weight of the baby; `null` when none is stored (`undefined` while loading). */
export function useBodyWeight(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(async () => (await latestBodyWeight(db, babyId)) ?? null, [db, babyId]);
}

export function usePrescriptionCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, terms: PrescriptionTerms) => createPrescription(db, babyId, terms),
    update: (id: string, terms: PrescriptionTerms) => updatePrescription(db, id, terms),
    setStatus: (id: string, status: PrescriptionStatus) => setPrescriptionStatus(db, id, status),
    remove: (id: string) => deletePrescription(db, id),
  };
}

/** Every formula of the baby, archived ones included (`undefined` while loading). */
export function useFormulas(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => formulasFor(db, babyId), [db, babyId]);
}

/** Every appointment of the baby, cancelled and done ones included, by start (`undefined` while loading). */
export function useAppointments(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => appointmentsFor(db, babyId), [db, babyId]);
}

export function useAppointmentCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, terms: AppointmentTerms) => createAppointment(db, babyId, terms),
    update: (id: string, terms: AppointmentTerms) => updateAppointment(db, id, terms),
    markDone: (id: string, outcome: string | null) => markAppointmentDone(db, id, outcome),
    cancel: (id: string) => cancelAppointment(db, id),
    restore: (id: string) => restoreAppointment(db, id),
  };
}

/** Every provider of the baby's directory, deleted ones included (`undefined` while loading). */
export function useCareProviders(babyId: string) {
  const db = useDatabase();
  return useLiveQuery(() => careProvidersFor(db, babyId), [db, babyId]);
}

export function useCareProviderCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, terms: CareProviderTerms) => createCareProvider(db, babyId, terms),
    update: (id: string, terms: CareProviderTerms) => updateCareProvider(db, id, terms),
    setFavorite: (id: string, favorite: boolean) => setCareProviderFavorite(db, id, favorite),
    remove: (id: string) => deleteCareProvider(db, id),
    restore: (id: string) => restoreCareProvider(db, id),
  };
}

export function useFormulaCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, terms: FormulaTerms) => createFormula(db, babyId, terms),
    update: (id: string, terms: FormulaTerms) => updateFormula(db, id, terms),
    setCurrent: (id: string) => setCurrentFormula(db, id),
    setArchived: (id: string, archived: boolean) => setFormulaArchived(db, id, archived),
  };
}
