/**
 * Local (IndexedDB) models. They mirror the SPEC domain shapes; the wire DTOs live in
 * `src/sync/contract.ts` and are mapped onto these. All timestamps are UTC ISO-8601 strings
 * (`Date#toISOString()`, e.g. `2026-10-20T08:15:00.000Z`) so string order equals time order.
 */

import type { DoctorScope } from '../doctor/scopes';
import type { ProductDto } from '../sync/contract';
import type { VaccineNetwork, VaccineSchedule } from '../vaccines/vaccineSchedule';
import type { AgeNormSet } from '../ageNorms/ageNorms';

/**
 * Owner > Parent > Caregiver > Viewer (docs/SPEC.md "Roles and permissions"); `Doctor` is outside that
 * order: reads like a Viewer and writes only her notes and consultation measurements
 * (docs/design/16-doctor-access.md).
 */
export type BabyRole = 'Owner' | 'Parent' | 'Caregiver' | 'Viewer' | 'Doctor';

/** Which vaccine recommendations the baby's schedule shows: the public network only, or also private clinics. */
export type VaccineProfileSetting = 'public' | 'public+private';

/** The answer to "did the mother get the RSV vaccine in pregnancy?". */
export type RsvMaternalAnswer = 'unknown' | 'yes' | 'no';

export interface Baby {
  id: string;
  name: string;
  /** Calendar date `yyyy-mm-dd`. */
  birthDate: string;
  /** The current user's role for this baby (from `GET /babies`). */
  role: BabyRole;
  /** Vaccine schedule profile (from `GET /babies`); absent on rows stored before it existed (= `public`). */
  vaccineProfile?: VaccineProfileSetting;
  /** Weeks of pregnancy at birth (20-44); `null` or absent = not told. */
  gestationalAgeWeeks?: number | null;
  /** Maternal RSV vaccination answer; `null` or absent = not answered. */
  rsvMaternalVaccination?: RsvMaternalAnswer | null;
  /**
   * The current user's server id (from `GET /babies`; the `createdBy` of the events they log).
   * `null`/absent until a babies refresh from a server that sends it.
   */
  userId?: string | null;
  /**
   * The sections the family shared with the user when her role is `Doctor` (from `GET /babies`,
   * docs/design/19-doctor-dashboard.md); absent for every other role and on older rows (= all).
   */
  doctorScopes?: DoctorScope[];
}

export type EventFieldKind = 'text' | 'number' | 'select' | 'bool';

/** Shows a field only while the select field `field` of the same type holds one of `equals`. */
export interface FieldVisibility {
  field: string;
  equals: string[];
}

export interface EventFieldDefinition {
  /** Lower snake_case property name inside the event payload. */
  key: string;
  label: string;
  kind: EventFieldKind;
  isRequired: boolean;
  /** Only for `select`. */
  options: string[];
  /** Only for `number`. */
  min: number | null;
  max: number | null;
  unit: string | null;
  /** `null`/absent = always shown (types stored before this existed have no value). */
  visibleWhen?: FieldVisibility | null;
  /** Forms never render a hidden field (pause keys, deprecated fields); its value is kept on edits. */
  hidden?: boolean;
  /** Number fields only: whole numbers only. */
  integer?: boolean;
  /** Number fields only: at most this many decimal places (absent = any). */
  decimals?: number;
}

export interface EventType {
  id: string;
  /** Owning baby; `null` for built-in templates. */
  babyId: string | null;
  key: string;
  name: string;
  icon: string;
  color: string;
  hasDuration: boolean;
  fields: EventFieldDefinition[];
}

export interface Dosage {
  amount: number;
  unit: string;
}

export interface Medication {
  id: string;
  babyId: string;
  name: string;
  defaultDosage: Dosage | null;
  notes: string | null;
  isUsual: boolean;
  /** Link to the shared catalog product (`null`: a plain, local medication). */
  productId?: string | null;
  createdAt: string;
}

export type PrescriptionKind = 'scheduled' | 'asNeeded';
export type PrescriptionStatus = 'active' | 'stopped';
/** A part of the baby's day (windows in medications/dayParts.ts, same as the API). */
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** The local reminder time (`HH:mm`, inside the part's window) of one part of the day. */
export interface DayPartReminder {
  part: DayPart;
  time: string;
}

/** The doctor's dose rule; with `perKg` the amount is per kg of body weight. */
export interface PrescriptionDose {
  amount: number;
  unit: string;
  perKg: boolean;
  /** Rounding of the per-kg amount to a multiple of this step; only with `perKg`. */
  roundingStep: number | null;
}

/**
 * The content of a prescription without its identity: the dose rule, the schedule, the course and
 * the doctor's instructions. Proposals and the "original" of a doctor-sourced prescription carry it
 * with the same rules and validation as a prescription's (docs/design/16-doctor-access.md section 10).
 */
export interface PrescriptionContent {
  kind: PrescriptionKind;
  dose: PrescriptionDose;
  timesOfDay: string[] | null;
  everyMinutes: number | null;
  dayParts: DayPart[] | null;
  dayPartReminders: DayPartReminder[] | null;
  minIntervalMinutes: number | null;
  maxDosesPer24h: number | null;
  indication: string | null;
  intervalGroup: string | null;
  /** Calendar dates `yyyy-mm-dd`. */
  startDate: string;
  endDate: string | null;
  instructions: string | null;
}

/** What the doctor sent, as the doctor sent it (kept on an accepted prescription). */
export interface PrescriptionOriginal extends PrescriptionContent {
  medicationName: string;
  productId: string | null;
}

/** What the doctor prescribed for one medication of a baby (synced like events). */
export interface Prescription {
  id: string;
  babyId: string;
  medicationId: string;
  status: PrescriptionStatus;
  kind: PrescriptionKind;
  dose: PrescriptionDose;
  /** `HH:mm` local times of a scheduled prescription (sorted). */
  timesOfDay: string[] | null;
  /** Scheduled "every N minutes" alternative to `timesOfDay`. */
  everyMinutes: number | null;
  /**
   * Scheduled by part of the day ("1 drop in the morning"): one dose per chosen part per day, in
   * day order. Absent on rows stored before this field existed (= `null`).
   */
  dayParts?: DayPart[] | null;
  /** Optional reminder times of chosen parts; `null` or absent = reminders off (the default). */
  dayPartReminders?: DayPartReminder[] | null;
  /** As needed: the shortest wait between doses. */
  minIntervalMinutes: number | null;
  maxDosesPer24h: number | null;
  indication: string | null;
  /** Normalised group label: a dose of any member restarts the wait of all. */
  intervalGroup: string | null;
  /** Calendar dates `yyyy-mm-dd`. */
  startDate: string;
  endDate: string | null;
  prescriber: string | null;
  instructions: string | null;
  /**
   * Provenance of a prescription a doctor suggested and the parents accepted (all absent on one the
   * parents entered; docs/design/16-doctor-access.md section 10.2). The server fills them.
   */
  prescribedByUserId?: string | null;
  /** The doctor's name without a title ("Ana Souza"): screens add "Dr.". */
  prescribedByName?: string | null;
  /** The doctor as the family sees her (the verified or self-declared badge). */
  prescribedBy?: PersonSummary | null;
  proposalId?: string | null;
  /** A parent edited the content after accepting it (never reset). */
  changedByParent?: boolean;
  /** The proposal as the doctor sent it. */
  original?: PrescriptionOriginal | null;
  createdBy: string | null;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
  deletedAt: string | null;
}

/**
 * An infant formula of a baby (per-baby list, synced like prescriptions; docs/design/14-formulas.md).
 * Never deleted: archived instead, because bottles name it. At most one is current per baby (the
 * server enforces it; on the device `currentFormula` picks the newest edit if a pull lags).
 */
export interface Formula {
  id: string;
  babyId: string;
  /** 1-60 characters. */
  name: string;
  brand: string | null;
  /** Short text such as `2` or `1+`. */
  stage: string | null;
  notes: string | null;
  /** Calendar date `yyyy-mm-dd` the baby started it. */
  startedOn: string | null;
  isCurrent: boolean;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
}

/** What an appointment is (docs/design/15-appointments.md). */
export type AppointmentType = 'consultation' | 'vaccine' | 'exam' | 'other';

/** `cancelled` is the soft delete (kept and synced, never reminded); `done` only once it started. */
export type AppointmentStatus = 'upcoming' | 'done' | 'cancelled';

/** Reminder offsets in minutes before the start: 1 week, 1 day, 2 hours, 30 minutes. */
export type ReminderOffset = 10080 | 1440 | 120 | 30;

/**
 * A doctor appointment of a baby (per-baby calendar, synced like formulas; docs/design/15-appointments.md).
 * Never deleted: cancelling is the soft delete. All instants are UTC; the device zone only shows them.
 */
export interface Appointment {
  id: string;
  babyId: string;
  /** 1-80 characters. */
  title: string;
  type: AppointmentType;
  /** UTC ISO instant; may be in the past (a visit logged after the fact). */
  startsAt: string;
  /** 5-480 minutes, or unknown. */
  durationMinutes: number | null;
  location: string | null;
  doctorName: string | null;
  notes: string | null;
  /** What came out of the visit (filled after it). */
  outcome: string | null;
  status: AppointmentStatus;
  /** Minutes before the start, largest first; `[]` = no reminders. */
  reminderOffsetsMinutes: ReminderOffset[];
  /**
   * The care provider picked from the baby's directory (docs/design/22-care-providers.md), or
   * absent/`null`. Only a link: `location` and `doctorName` hold the copied text, so editing or
   * deleting the provider never rewrites the appointment.
   */
  providerId?: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
}

/**
 * One entry of the baby's directory of care providers, "My doctors" (docs/design/22-care-providers.md):
 * contact details only, shared by the family members who may see appointments. Synced like
 * formulas; `deleted` is the soft delete (kept so the delete reaches the other devices).
 */
export interface CareProvider {
  id: string;
  babyId: string;
  /** 1-80 characters. */
  name: string;
  /** Free text; the form suggests common specialties. */
  specialty: string | null;
  /** Council, number and region as free text (e.g. CRM, 123456, SP). */
  registrationCouncil: string | null;
  registrationNumber: string | null;
  registrationRegion: string | null;
  /** Clinic or hospital. */
  clinicName: string | null;
  /** One multi-line text. */
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  favorite: boolean;
  deleted: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
}

/**
 * A vaccine given to the baby (per-baby record, synced like prescriptions; docs/design/18-vaccines.md).
 * `vaccineKey`/`doseId` name the schedule entry it satisfies; a custom vaccine has a `customName`
 * instead. `doseLabel` is the dose's name as it read when recorded, so the history survives schedule
 * updates.
 */
export interface Vaccination {
  id: string;
  babyId: string;
  vaccineKey: string | null;
  doseId: string | null;
  /** 1-80 characters; only without a `vaccineKey`. */
  customName: string | null;
  /** Up to 80 characters. */
  doseLabel: string | null;
  /** Calendar date `yyyy-mm-dd` it was given. */
  givenOn: string;
  /** Where it was given. */
  network: VaccineNetwork;
  clinic: string | null;
  lot: string | null;
  administeredBy: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
  /** Soft delete marker. */
  deletedAt: string | null;
}

/** The vaccine schedule served by the API, kept on the device for offline use (one row per profile). */
export interface VaccineScheduleCache {
  /** Schedule profile, `BR`. */
  profile: string;
  /** The `ETag` the server sent with it (sent back as `If-None-Match`); `null` when it sent none. */
  etag: string | null;
  schedule: VaccineSchedule;
  /** UTC ISO instant the content last changed on this device. */
  fetchedAt: string;
  /** UTC ISO instant the server was last asked (and agreed it is current). */
  checkedAt: string;
}

/** The published age norms served by the API (docs/design/28-age-norms.md), one row. */
export interface AgeNormsCache {
  /** Always `current`: the API serves one file for everybody. */
  key: string;
  /** The `ETag` the server sent with it (sent back as `If-None-Match`); `null` when it sent none. */
  etag: string | null;
  norms: AgeNormSet;
  /** UTC ISO instant the content last changed on this device. */
  fetchedAt: string;
  /** UTC ISO instant the server was last asked (and agreed it is current). */
  checkedAt: string;
}

/** What a note is; `recommendation` gets the parents' inbox in step 2 (docs/design/16-doctor-access.md). */
export type NoteKind = 'note' | 'recommendation';

/** `shared`: every member of the baby reads it; `private`: only its author (the server never sends it to others). */
export type NoteVisibility = 'shared' | 'private';

/** A healthcare professional as the family sees her. v1 profiles are self-declared (`verified: false`). */
export interface ProfessionalSummary {
  kind: 'doctor';
  displayName: string;
  specialty: string | null;
  registrationNumber: string | null;
  verified: boolean;
}

/** A person named on the baby's data: the professional name when she declared one. */
export interface PersonSummary {
  userId: string;
  displayName: string;
  professional: ProfessionalSummary | null;
}

/**
 * A note about a baby, written by its Doctor (synced like appointments, soft deleted;
 * docs/design/16-doctor-access.md). Only the author edits or deletes it.
 */
export interface Note {
  id: string;
  babyId: string;
  /** The author's server id; `null` while written on this device and not echoed yet. */
  authorUserId: string | null;
  /** The author as the server named her at the last pull (`null` for a note not synced yet). */
  author: PersonSummary | null;
  kind: NoteKind;
  visibility: NoteVisibility;
  /** 1-4000 characters, line breaks kept. */
  body: string;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
  /** Soft delete marker. */
  deletedAt: string | null;
}

/** The first read of a shared note by this user (the recommendations inbox; one row per note). */
export interface NoteRead {
  noteId: string;
  babyId: string;
  /** Device time until the server echoed its own; the earlier one is kept. */
  readAt: string;
}

/** `pending` is the only open state; the others are final (docs/design/16-doctor-access.md 10.1). */
export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'superseded';

/** Why a proposal was cancelled: the doctor withdrew it, or her access to the baby ended. */
export type ProposalCancelReason = 'withdrawn' | 'access_removed';

/**
 * A prescription the baby's Doctor suggests (synced; only the author and the Owners and Parents
 * ever receive it). Nothing is active, reminded or calculated before a parent accepts it
 * (docs/design/16-doctor-access.md section 10).
 */
export interface Proposal extends PrescriptionContent {
  id: string;
  babyId: string;
  /** The doctor's server id; `null` while written on this device and not echoed yet. */
  authorUserId: string | null;
  /** The doctor as the server named her at the last pull (`null` until synced). */
  author: PersonSummary | null;
  /** A medication of the baby's list, when the doctor picked one. */
  medicationId: string | null;
  /** A shared catalog product, when the doctor picked one. */
  productId: string | null;
  /** What the family reads: 1-100 characters. */
  medicationName: string;
  /** The prescription this proposes to change. */
  replacesPrescriptionId: string | null;
  status: ProposalStatus;
  /** The parent's words when declined. */
  declineReason: string | null;
  cancelReason: ProposalCancelReason | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** The prescription the accept created (the id the accepting device generated). */
  acceptedPrescriptionId: string | null;
  /** An accept or decline made on this device that has not reached the server yet ("Waiting to sync"). */
  decisionPending?: boolean;
  createdAt: string;
  /** Local edit time until pushed; afterwards the server receive time (the delta cursor). */
  updatedAt: string;
  clientUpdatedAt?: string;
}

/** A shared catalog product kept on the device (recently used or found), for offline search. */
export interface CachedProduct {
  id: string;
  /** The `ProductDto` as the API returned it. */
  product: ProductDto;
  /** Compact matching key of the name (no case, diacritics, punctuation or repeated letters). */
  key: string;
  /** Last time it was found or linked (UTC ISO), newest are kept. */
  usedAt: string;
}

/** The latest known weight of a baby (from the growth measurements), for per-kg suggestions. */
export interface BodyWeightRow {
  babyId: string;
  kg: number;
  /** Calendar date `yyyy-mm-dd`. */
  date: string;
}

/** Type-specific event data (a JSON object). */
export type EventPayload = Record<string, unknown>;

/** Payload of a medication event: the catalog entries the parent selected. */
export interface MedicationEventPayload extends EventPayload {
  /** `name` is a snapshot so the timeline stays readable if the catalog entry changes. */
  medications: {
    medicationId: string;
    name: string;
    dose?: Dosage;
    /** The prescription this dose follows. */
    prescriptionId?: string;
    /** Body weight (kg) a per-kg dose was computed from. */
    kgUsed?: number;
    /** Logged before the allowed time and confirmed by the parent. */
    override?: true;
  }[];
}

/** A logged event. Named `BabyEvent` to avoid clashing with the DOM `Event`. */
export interface BabyEvent {
  /** Client-generated GUID (`crypto.randomUUID()`). */
  id: string;
  babyId: string;
  typeId: string;
  startedAt: string;
  /** `null` while the event is running (timer). */
  endedAt: string | null;
  payload: EventPayload;
  notes: string | null;
  /** Server user id; `null` until the server has echoed the event back. */
  createdBy: string | null;
  createdAt: string;
  /**
   * Local edit time until pushed; once synced, the server's receive time (the delta cursor clock).
   * Never compare it with a local edit time: use `editTimeOf` for last-write-wins.
   */
  updatedAt: string;
  /**
   * Client clock of the last edit (set by every local command and echoed by the server as
   * `clientUpdatedAt`). Optional: rows from older code or servers fall back to `updatedAt`.
   */
  clientUpdatedAt?: string;
  /** Soft delete marker. */
  deletedAt: string | null;
}

/** The time of a prescription's last edit on the client clock. */
export function prescriptionEditTime(p: Pick<Prescription, 'clientUpdatedAt' | 'updatedAt'>) {
  return p.clientUpdatedAt ?? p.updatedAt;
}

/** The time of the event's last edit on the client clock, for last-write-wins comparisons. */
export function editTimeOf(event: Pick<BabyEvent, 'clientUpdatedAt' | 'updatedAt'>): string {
  return event.clientUpdatedAt ?? event.updatedAt;
}

export type MutationKind = 'upsert' | 'delete';
/**
 * `proposal`: the Doctor's suggestion (upsert = `PUT`, delete = withdraw); `proposalDecision`: a
 * parent's accept or decline (`POST`, entity id = the proposal's); `noteRead`: a first read of a
 * shared note (`PUT .../read`, entity id = `read:{noteId}` so a pull of the note is never held back).
 */
export type MutationEntityType =
  | 'event'
  | 'medication'
  | 'prescription'
  | 'formula'
  | 'appointment'
  | 'careProvider'
  | 'vaccination'
  | 'note'
  | 'proposal'
  | 'proposalDecision'
  | 'noteRead';
/** `dead` = permanently rejected by the server; kept for inspection, never blocks the queue. */
export type MutationStatus = 'pending' | 'dead';

/** A queued local change waiting to be pushed. Pushed in ascending `id` order. */
export interface OutboxMutation {
  /** Auto-incremented; defines push order. */
  id: number;
  babyId: string;
  kind: MutationKind;
  entityType: MutationEntityType;
  entityId: string;
  /** Request body snapshot for `upsert`; `null` for `delete`. */
  payload: unknown;
  createdAt: string;
  /** Failed push attempts (drives the backoff delay). */
  attempts: number;
  /**
   * Consecutive server-side failures (HTTP 500 and unknown errors) counted toward giving up; the
   * mutation is dead-lettered at `MAX_SERVER_FAILURES`. Offline errors never count. Optional for
   * rows queued before it existed.
   */
  failureCount?: number;
  lastError: string | null;
  /**
   * The server rejected the event's details (400 `validation_failed`, e.g. a timer stopped without
   * a required field): the user has to fix the event (Settings > Sync > Fix). Optional.
   */
  needsAttention?: boolean;
  /** Field key the server named in that rejection, if any. */
  rejectedField?: string | null;
  status: MutationStatus;
  /** Earliest time the next attempt may run (backoff); `null` = now. */
  nextAttemptAt: string | null;
}

/**
 * `events`: the per-baby delta cursor. `babies`: stored under `BABIES_LISTED_KEY` once a babies
 * fetch succeeded on this device (an empty local list then really means "no baby yet").
 */
export type SyncEntity =
  | 'events'
  | 'babies'
  | 'prescriptions'
  | 'formulas'
  | 'appointments'
  | 'careProviders'
  | 'vaccinations'
  | 'notes'
  | 'proposals'
  | 'noteReads';

/** `babyId` of the `babies` marker row (not a baby id). */
export const BABIES_LISTED_KEY = '*';

/** Delta-pull cursor per baby and entity. */
export interface SyncCursor {
  babyId: string;
  entity: SyncEntity;
  /** Raw `updatedAt` of the newest item received from the server (sent back as `since`). */
  lastSyncedAt: string;
}
