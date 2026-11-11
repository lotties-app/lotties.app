import {
  isAppointmentStatus,
  isAppointmentType,
  normalizeReminders,
} from '../appointments/appointmentModel';
import { isProposalStatus } from '../proposals/proposalModel';
import { parseScopes, type DoctorScope } from '../doctor/scopes';
import {
  editTimeOf,
  type Appointment,
  type CareProvider,
  type Note,
  type NoteRead,
  type PrescriptionContent,
  type PrescriptionOriginal,
  type Proposal,
  type ProposalCancelReason,
  type NoteKind,
  type NoteVisibility,
  type PersonSummary,
  type ProfessionalSummary,
  type AppointmentStatus,
  type AppointmentType,
  type ReminderOffset,
  type Baby,
  type BabyEvent,
  type BabyRole,
  type DayPart,
  type DayPartReminder,
  type Dosage,
  type EventFieldDefinition,
  type EventFieldKind,
  type FieldVisibility,
  type EventPayload,
  type EventType,
  type Formula,
  type Medication,
  type Prescription,
  type PrescriptionDose,
  type PrescriptionKind,
  type PrescriptionStatus,
  type RsvMaternalAnswer,
  type Vaccination,
  type VaccineProfileSetting,
} from '../db/models';
import { isVaccineNetwork } from '../vaccines/vaccinationModel';
import type { VaccineNetwork } from '../vaccines/vaccineSchedule';

/*
 * API wire contract (`/api/v1`) used by the sync engine. This is the ONLY place the client
 * assumes the API shapes (events: docs/SPEC.md "Events sync contract"; others still assumed until
 * PLAN tasks 4-5 land):
 * - JSON is camelCase; timestamps are ISO-8601 with any offset and are normalized to UTC `Z`.
 *   Errors are RFC 7807 problem details with a stable `code` extension.
 * - PUT    /babies/{id}/events/{eventId}  body EventUpsertRequest incl. the local edit time as
 *          `updatedAt` (server last-write-wins on client clocks: it is compared with the stored
 *          `clientUpdatedAt`; an older one is ignored and the stored copy is returned). Replies
 *          200/201 with the stored EventDto (an empty body is tolerated); the server stamps
 *          `updatedAt` on receipt (the delta cursor) and echoes the edit time as
 *          `clientUpdatedAt` (optional: absent on older servers). 409 `event_baby_mismatch`, 422
 *          `event_type_not_available`, 400 validation.
 * - GET    /babies/{id}/events/{eventId}  EventDto (soft-deleted included); 404 when unknown.
 * - DELETE /babies/{id}/events/{eventId}  soft delete, always 204; 404 is treated as "already gone".
 * - GET    /babies/{id}/events?since=<updatedAt>&after=<cursor>  EventDto[] with
 *          `updatedAt >= since` (inclusive, so boundary rows repeat; merge is idempotent),
 *          INCLUDING soft-deleted ones, ordered by (updatedAt, id), up to 500 per page. While more
 *          rows follow, header `X-Next-Cursor` holds an opaque cursor passed back as `after`.
 * - GET    /babies -> BabyDto[]; /babies/{id}/event-types -> EventTypeDto[] (built-ins + custom);
 *          /babies/{id}/medications -> MedicationDto[].
 * - PUT    /babies/{id}/medications/{medicationId}  body MedicationUpsertRequest; idempotent upsert
 *          (client GUID); any 2xx body is ignored. Medication pulls are not delta-based yet.
 * - PUT    /babies/{id}/medications/{medicationId} also carries `productId` (shared catalog link).
 * - Prescriptions (docs/SPEC.md "Medications: catalog, prescriptions, status"): GET
 *          /babies/{id}/prescriptions?since= (incl. soft-deleted), PUT/DELETE
 *          /babies/{id}/prescriptions/{id}. A prescription must reach the server before the events
 *          that name it (`medications[i].prescriptionId`), and its medication before it.
 * - Formulas (docs/SPEC.md "Formulas"): GET /babies/{id}/formulas?since= (archived included, no
 *          delete), PUT /babies/{id}/formulas/{id} (Owner/Parent). Making one current makes the
 *          others not current on the server (they come back in the delta). A formula must reach the
 *          server before the bottles that name it (feeding payload `formula_id`, `formula_name`).
 * - Notes (docs/design/16-doctor-access.md): GET /babies/{id}/notes?since= (deleted included; only
 *          the notes the caller may see: shared ones and her own private ones), GET/PUT/DELETE
 *          /babies/{id}/notes/{id} (writes: the Doctor, her own notes only). A shared note never
 *          becomes private (422 `note_already_shared`).
 * - Prescription proposals (docs/design/16-doctor-access.md section 10): GET
 *          /babies/{id}/prescription-proposals?since= (the Doctor's own, or every one for Owners and
 *          Parents, none for others; all statuses), GET /prescription-proposals/{id}, PUT (the
 *          Doctor, client GUID; 409 `proposal_decided` once decided), DELETE (withdraw, 204),
 *          POST .../accept `{prescriptionId, acceptedOn}` and .../decline `{reason}` (Owner,
 *          Parent; 200 `{proposal, prescription}`; 409 `proposal_not_pending`). PUT
 *          /babies/{id}/notes/{id}/read marks a shared note read, GET /babies/{id}/note-reads?since=
 *          lists the caller's own reads.
 * - Doctor access: GET/PUT /me/professional-profile (404 `professional_profile_not_found` before
 *          one is declared; a Doctor invite needs one: 422 `professional_profile_required`), GET
 *          /babies/{id}/access-log (Owner).
 * - Care providers (docs/SPEC.md "Care providers"): GET /babies/{id}/care-providers?since= (deleted
 *          included, no DELETE), PUT /babies/{id}/care-providers/{id} (Owner/Parent). Family roles only.
 * - Address lookup (docs/design/23-address-lookup.md): GET /address/lookup?cep= (a Brazilian CEP:
 *          street, neighborhood, city, state; 404 `address_not_found`) and GET /address/search?q=&lang=
 *          (OpenStreetMap places). Any signed-in user, online only, user-triggered, rate limited;
 *          502 `address_lookup_unavailable` / 503 `address_lookup_disabled` leave the manual field.
 * - Appointments (docs/SPEC.md "Appointments"): GET /babies/{id}/appointments?since= (cancelled and
 *          done included, no delete), PUT /babies/{id}/appointments/{id} (Owner/Parent). `done` is
 *          refused (422 `appointment_not_started`) while the start is in the future.
 * - Vaccinations (docs/design/18-vaccines.md): GET /babies/{id}/vaccinations?since= (deleted
 *          included), PUT/DELETE /babies/{id}/vaccinations/{id} (Owner/Parent; a PUT to a deleted id
 *          returns the stored deleted copy, 409 `vaccination_baby_mismatch`). GET /vaccine-schedule
 *          (any signed-in user; `ETag` + `If-None-Match`, 304 without a body) serves the schedule
 *          the device caches. PUT /babies/{id}/vaccine-profile (Owner/Parent, online) replaces the
 *          baby's vaccine profile (`vaccineProfile`, `gestationalAgeWeeks`, `rsvMaternalVaccination`).
 * - Shared catalog: GET /catalog/products?q=, POST /catalog/products (409 `product_exists` carries
 *          the existing `product`), GET /catalog/products/{id} (a product a medication links to; pulled
 *          for the family's linked products only, the catalog itself is never synced: official ANVISA
 *          products are searched online, see docs/design/13-anvisa-catalog.md).
 * - Medication event payload: { medications: [{ medicationId, name, dose?, prescriptionId?, kgUsed?,
 *          override? }] }.
 * - Enum values (field kind, role) are strings, compared case-insensitively.
 */

export const API_PREFIX = '/api/v1';

export const apiPaths = {
  babies: () => `${API_PREFIX}/babies`,
  baby: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}`,
  members: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/members`,
  member: (babyId: string, userId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/members/${enc(userId)}`,
  invites: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/invites`,
  invite: (babyId: string, inviteId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/invites/${enc(inviteId)}`,
  /** Body `{ token }`; the deprecated `/invites/{token}/accept` path is no longer used. */
  acceptInvite: () => `${API_PREFIX}/invites/accept`,
  eventTypes: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/event-types`,
  eventType: (babyId: string, typeId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/event-types/${enc(typeId)}`,
  medications: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/medications`,
  event: (babyId: string, eventId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/events/${enc(eventId)}`,
  medication: (babyId: string, medicationId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/medications/${enc(medicationId)}`,
  /** `after` (a paging cursor) takes precedence over `since` on the server. */
  eventsDelta: (babyId: string, page: { since?: string; after?: string } = {}) =>
    `${API_PREFIX}/babies/${enc(babyId)}/events` + query(page),
  prescriptions: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescriptions` + query({ since }),
  prescription: (babyId: string, prescriptionId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescriptions/${enc(prescriptionId)}`,
  formulas: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/formulas` + query({ since }),
  formula: (babyId: string, formulaId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/formulas/${enc(formulaId)}`,
  appointments: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/appointments` + query({ since }),
  appointment: (babyId: string, appointmentId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/appointments/${enc(appointmentId)}`,
  careProviders: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/care-providers` + query({ since }),
  careProvider: (babyId: string, providerId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/care-providers/${enc(providerId)}`,
  addressLookup: (cep: string) => `${API_PREFIX}/address/lookup` + query({ cep }),
  addressSearch: (q: string, lang?: string) => `${API_PREFIX}/address/search` + query({ q, lang }),
  vaccinations: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/vaccinations` + query({ since }),
  vaccination: (babyId: string, vaccinationId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/vaccinations/${enc(vaccinationId)}`,
  vaccineProfile: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/vaccine-profile`,
  vaccineSchedule: () => `${API_PREFIX}/vaccine-schedule`,
  ageNorms: () => `${API_PREFIX}/age-norms`,
  notes: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/notes` + query({ since }),
  note: (babyId: string, noteId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/notes/${enc(noteId)}`,
  proposals: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescription-proposals` + query({ since }),
  proposal: (babyId: string, proposalId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescription-proposals/${enc(proposalId)}`,
  proposalAccept: (babyId: string, proposalId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescription-proposals/${enc(proposalId)}/accept`,
  proposalDecline: (babyId: string, proposalId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/prescription-proposals/${enc(proposalId)}/decline`,
  noteRead: (babyId: string, noteId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/notes/${enc(noteId)}/read`,
  noteReads: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/note-reads` + query({ since }),
  accessLog: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/access-log`,
  /** The doctor's patients with their card data (docs/design/19-doctor-dashboard.md). */
  doctorPatients: (timeZone: string | undefined, utcOffsetMinutes: number) =>
    `${API_PREFIX}/doctor/patients` +
    query({ timeZone, utcOffsetMinutes: String(utcOffsetMinutes) }),
  /** Server-side aggregates over local dates `from`..`to` (inclusive, `yyyy-mm-dd`). */
  clinicalSummary: (
    babyId: string,
    range: { from: string; to: string },
    timeZone: string | undefined,
    utcOffsetMinutes: number,
  ) =>
    `${API_PREFIX}/babies/${enc(babyId)}/clinical-summary` +
    query({ ...range, timeZone, utcOffsetMinutes: String(utcOffsetMinutes) }),
  /** Non-deleted events overlapping `[from, to)` (UTC instants, at most 8 days). */
  timeline: (babyId: string, from: string, to: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/timeline` + query({ from, to }),
  professionalProfile: () => `${API_PREFIX}/me/professional-profile`,
  me: () => `${API_PREFIX}/me`,
  meProfile: () => `${API_PREFIX}/me/profile`,
  catalogProducts: (q?: string, limit?: number) =>
    `${API_PREFIX}/catalog/products` +
    query({ q, limit: limit === undefined ? undefined : String(limit) }),
  catalogProduct: (productId: string) => `${API_PREFIX}/catalog/products/${enc(productId)}`,
  measurements: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/measurements`,
  measurement: (babyId: string, measurementId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/measurements/${enc(measurementId)}`,
  importNapper: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/import/napper`,
  importNapperPreview: (babyId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/import/napper/preview`,
  /** Export and import of a baby's data (docs/design/24-export-import.md). */
  backupExport: (babyId: string, compress: boolean) =>
    `${API_PREFIX}/babies/${enc(babyId)}/export?compress=${compress}`,
  backupMergePreview: (babyId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/import/backup/preview`,
  backupMerge: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/import/backup`,
  backupRestorePreview: () => `${API_PREFIX}/babies/import/preview`,
  backupRestore: () => `${API_PREFIX}/babies/import`,
  /** `timeZone` (IANA) places the recurring patterns in local time, daylight saving included. */
  predictions: (babyId: string, utcOffsetMinutes: number, timeZone?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/predictions?utcOffsetMinutes=${utcOffsetMinutes}` +
    (timeZone ? `&timeZone=${encodeURIComponent(timeZone)}` : ''),
  pushConfig: () => `${API_PREFIX}/push/config`,
  pushSubscriptions: () => `${API_PREFIX}/push/subscriptions`,
  /** Body `{ endpoint }`: the endpoint never travels in a URL. */
  pushRevokeByEndpoint: () => `${API_PREFIX}/push/subscriptions/revoke`,
  pushSubscription: (subscriptionId: string) =>
    `${API_PREFIX}/push/subscriptions/${enc(subscriptionId)}`,
  pushSettings: () => `${API_PREFIX}/push/settings`,
  pushPreferences: () => `${API_PREFIX}/push/preferences`,
  pushTest: () => `${API_PREFIX}/push/test`,
  /** The app installs that want silent pushes for their widgets (docs/design/37b-widget-silent-push.md). */
  pushDevices: () => `${API_PREFIX}/push/devices`,
  /** Whether silent pushes are on for `channel`, read before the app asks the phone for a token (37b section 5.4). */
  silentPushStatus: (channel: string) =>
    `${API_PREFIX}/push/silent/status?channel=${enc(channel)}`,
  pushDevice: (deviceId: string) => `${API_PREFIX}/push/devices/${enc(deviceId)}`,
  /** Anonymous: body `{ action, token }`, the per-delivery token is the credential. */
  pushDeliveryAction: (deliveryId: string) =>
    `${API_PREFIX}/push/deliveries/${enc(deliveryId)}/actions`,
  notificationPreferences: (babyId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/notification-preferences`,
};

/** Response header carrying the delta paging cursor; absent on the last page. */
export const NEXT_CURSOR_HEADER = 'X-Next-Cursor';
/**
 * The baby's store epoch on every baby route (docs/SPEC.md "Store epoch"): it changes only when the
 * baby's records move to another data store; a client holding another value pulls everything again.
 */
export const SYNC_EPOCH_HEADER = 'X-Sync-Epoch';

function query(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function enc(segment: string) {
  return encodeURIComponent(segment);
}

export interface BabyDto {
  id: string;
  /** Real name; may be empty. */
  name: string;
  /** Preset code or custom text (additive). */
  label?: string | null;
  birthDate: string;
  /** Only the week of birth is stored (additive). */
  birthWeekOnly?: boolean;
  role?: string;
  /** The caller's own user id (additive; absent from older servers). */
  userId?: string;
  /**
   * Vaccine profile (additive): `public` or `public+private`; `null`, like the two fields below, for a Doctor the
   * vaccines section is not shared with.
   */
  vaccineProfile?: string | null;
  /** Weeks at birth, 20-44 (additive); `null` = not told. */
  gestationalAgeWeeks?: number | null;
  /** `unknown`, `yes` or `no` (additive); `null` = not answered. */
  rsvMaternalVaccination?: string | null;
  /** The sections shared with the caller when her role is Doctor (additive); `null` otherwise. */
  doctorScopes?: string[] | null;
}

export interface FieldVisibilityDto {
  field: string;
  equals: string[];
}

export interface EventFieldDefinitionDto {
  key: string;
  label: string;
  kind: string;
  isRequired?: boolean;
  options?: string[] | null;
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  /** `null` = always shown; else shown while the select `field` holds one of `equals`. */
  visibleWhen?: FieldVisibilityDto | null;
  /** Forms must not render the field (additive; absent = false). */
  hidden?: boolean;
  /** Number fields: whole numbers only (additive; absent = false). */
  integer?: boolean;
  /** Number fields: at most this many decimal places, 1 to 3 (additive; absent or `null` = any). */
  decimals?: number | null;
}

export interface EventTypeDto {
  id: string;
  babyId: string | null;
  key: string;
  name: string;
  icon: string;
  color: string;
  hasDuration: boolean;
  fields?: EventFieldDefinitionDto[] | null;
}

export interface MedicationDto {
  id: string;
  babyId: string;
  name: string;
  defaultDosage?: Dosage | null;
  notes?: string | null;
  isUsual: boolean;
  productId?: string | null;
  createdAt: string;
}

export interface EventDto {
  id: string;
  babyId: string;
  typeId: string;
  startedAt: string;
  endedAt: string | null;
  payload: EventPayload | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Server receive time: the delta cursor clock only. */
  updatedAt: string;
  /** Client clock of the stored edit (last-write-wins); absent on servers that predate it. */
  clientUpdatedAt?: string | null;
  deletedAt: string | null;
}

export interface EventUpsertRequest {
  typeId: string;
  startedAt: string;
  endedAt: string | null;
  payload: EventPayload;
  notes: string | null;
  /** Local edit time (client clock); lets the server ignore writes older than its copy. */
  updatedAt?: string;
}

export interface MedicationUpsertRequest {
  name: string;
  /** Shared catalog link; `null` removes it (the PUT is full state). */
  productId: string | null;
  defaultDosage: Dosage | null;
  notes: string | null;
  isUsual: boolean;
}

export function toMedicationUpsertRequest(medication: Medication): MedicationUpsertRequest {
  return {
    name: medication.name,
    productId: medication.productId ?? null,
    defaultDosage: medication.defaultDosage,
    notes: medication.notes,
    isUsual: medication.isUsual,
  };
}

export type EventsDeltaResponse = EventDto[];

/* Online-only management endpoints (docs/SPEC.md "Babies, members, invites, event types, ..."). */

export interface BabyRequest {
  /** Optional real name (empty = none). */
  name: string;
  /** Preset code or custom text. */
  label?: string;
  /** `yyyy-mm-dd`. */
  birthDate: string;
  /** Update only: store only the week (sent for the "Store only the week" action). */
  birthWeekOnly?: boolean;
}

export interface MemberDto {
  userId: string;
  displayName: string | null;
  /** Preset code or custom text (additive). */
  roleLabel?: string | null;
  role: string;
  joinedAt: string;
  /** A Doctor member's professional details (additive; absent or `null` for other roles). */
  professional?: ProfessionalSummaryDto | null;
  /** The sections shared with a Doctor member (additive; `null` for other roles). */
  doctorScopes?: string[] | null;
}

export interface InviteDto {
  id: string;
  babyId: string;
  role: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  /** The sections a Doctor invite shares (additive; `null` for other roles). */
  doctorScopes?: string[] | null;
}

/** Returned once by `POST /invites`: the only time the plain token is available. */
export interface CreatedInviteDto extends InviteDto {
  token: string;
}

export interface CreateInviteRequest {
  role: BabyRole;
  expiresInDays?: number;
  /** Only for a Doctor invite: the sections she will see (absent = all six). */
  doctorScopes?: DoctorScope[];
}

/** Body of `PATCH /babies/{id}/members/{userId}`: a new role, a Doctor's sections, or both. */
export interface ChangeMemberRequest {
  role?: BabyRole;
  doctorScopes?: DoctorScope[];
}

export interface EventFieldRequest {
  key: string;
  label: string;
  kind: EventFieldKind;
  isRequired: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
}

export interface EventTypeRequest {
  name: string;
  icon: string;
  color: string;
  hasDuration: boolean;
  fields: EventFieldRequest[];
}

export interface CreateEventTypeRequest extends EventTypeRequest {
  key: string;
}

/*
 * GET /babies/{id}/predictions?utcOffsetMinutes=<minutes east of UTC>  (read by the Home cards
 * through TanStack Query, not by the sync engine). Times are UTC ISO; lengths whole minutes.
 */
export type PredictionConfidence = 'Low' | 'Medium' | 'High';

export interface PredictionDto {
  typeKey: string;
  nextStart: { earliest: string; expected: string; latest: string };
  expectedDuration: { minutes: number; sampleCount: number } | null;
  confidence: PredictionConfidence;
  sampleCount: number;
  /** English explanation of how the estimate was made. */
  reason: string;
  basis: Record<string, unknown>;
}

export interface InsufficientDataDto {
  typeKey: string;
  sampleCount: number;
  requiredSamples: number;
  reason: string;
}

/** The next night's start (heuristic v1.1); `basis.kind` is `BedTimeClock`. */
export interface BedTimeDto {
  typeKey: string;
  kind: string;
  nextStart: { earliest: string; expected: string; latest: string };
  expectedDuration: { minutes: number; sampleCount: number } | null;
  confidence: PredictionConfidence;
  sampleCount: number;
  reason: string;
  basis: Record<string, unknown>;
}

/** One supporting day of a pattern: `yyyy-MM-dd` and its local `HH:mm` times inside the window. */
export interface PatternDayDto {
  date: string;
  times: string[];
}

/**
 * A time of day an event type keeps happening at (docs/design/11-patterns.md), in local `HH:mm`
 * (the window crosses midnight when `windowEnd` is earlier than `windowStart`). Numbers only: the
 * client writes the text.
 */
export interface TimeOfDayPatternDto {
  /** `belly_pain` or `fussy`. */
  typeKey: string;
  typicalClock: string;
  windowStart: string;
  windowEnd: string;
  windowMinutes: number;
  spreadMinutes: number;
  confidence: PredictionConfidence;
  eventDayCount: number;
  recentDayCount: number;
  /** IANA zone of the local times; `null` when the fixed offset was used. */
  timeZone: string | null;
  /** Oldest first. */
  days: PatternDayDto[];
  rule: {
    lookBackDays: number;
    recentDays: number;
    minimumRecentDays: number;
    maximumSpreadMinutes: number;
    minimumCoveragePercent: number;
    /** The suggestion shows from this long before the window starts. */
    leadMinutes: number;
  };
}

/** One awake stretch the wake window used: UTC ISO start and end, whole minutes. */
export interface AwakeStretchDto {
  start: string;
  end: string;
  minutes: number;
}

/**
 * The overtired heads-up numbers (docs/design/11-patterns.md section 6): the baby's usual longest
 * comfortable awake stretch (`limitMinutes`, a percentile of the recent daytime stretches) and the
 * current stretch at `generatedAt`. Numbers only: the client writes the text and measures the
 * current stretch from local events.
 */
export interface WakeWindowDto {
  limitMinutes: number;
  sampleCount: number;
  /** UTC ISO start of the current awake stretch; `null` while asleep or after a night waking. */
  awakeSince: string | null;
  awakeMinutes: number | null;
  timeZone: string | null;
  /** Oldest first. */
  stretches: AwakeStretchDto[];
  rule: {
    lookBackDays: number;
    /** Local `HH:mm` (inclusive) and before `dayEndsAt` (exclusive): daytime stretch starts. */
    dayStartsAt: string;
    dayEndsAt: string;
    percentile: number;
    minimumStretches: number;
    /** The heads-up shows from this long before the limit... */
    leadMinutes: number;
    /** ...until this long after it. */
    graceMinutes: number;
  };
}

/**
 * The next wet or dirty diaper from the gaps between them (docs/design/11-patterns.md section 8),
 * anchored at the latest one on the server. Whole minutes; the client re-anchors at its latest
 * local event.
 */
export interface DiaperGapDto {
  /** UTC ISO of the latest diaper of the kind. */
  anchorAt: string;
  nextStart: { earliest: string; expected: string; latest: string };
  lowerGapMinutes: number;
  medianGapMinutes: number;
  upperGapMinutes: number;
  eventCount: number;
  gapCount: number;
  confidence: PredictionConfidence;
  /** Wet only: the last 24 hours against the usual count; `null` with too little history. */
  trend?: { last24Hours: number; usualPer24Hours: number; droppedSharply: boolean } | null;
}

/** How long after a feed ends the next dirty diaper usually comes (whole minutes). */
export interface DiaperFeedLagDto {
  lowerLagMinutes: number;
  medianLagMinutes: number;
  upperLagMinutes: number;
  pairCount: number;
  confidence: PredictionConfidence;
  /** UTC ISO end of the latest finished feed on the server, or `null`. */
  latestFeedEndedAt: string | null;
}

export interface DirtyDiaperDto {
  lastDirtyAt: string | null;
  gap: DiaperGapDto | null;
  afterFeed: DiaperFeedLagDto | null;
}

export interface DiaperRuleDto {
  wetLookBackDays: number;
  minimumWetEvents: number;
  dirtyLookBackDays: number;
  minimumDirtyEvents: number;
  lowerPercentile: number;
  upperPercentile: number;
  feedWindowMinutes: number;
  minimumFeedPairs: number;
  maximumLagSpreadMinutes: number;
  /** The Now card shows from this long before the expected time... */
  leadMinutes: number;
  /** ...until this long after it. */
  graceMinutes: number;
}

/** The diaper predictions: each part `null` when its gate did not pass (nothing is guessed). */
export interface DiaperPredictionsDto {
  wet: DiaperGapDto | null;
  dirty: DirtyDiaperDto | null;
  rule: DiaperRuleDto;
}

export interface PredictionsDto {
  babyId: string;
  generatedAt: string;
  /** Absent on servers before heuristic v1.1. */
  engineVersion?: string;
  predictions: PredictionDto[];
  insufficientData: InsufficientDataDto[];
  /** Absent or `null` when no bed time can be estimated. */
  bedTime?: BedTimeDto | null;
  /** Recurring time-of-day patterns (additive; absent on older servers). */
  patterns?: TimeOfDayPatternDto[];
  /** The overtired heads-up numbers (additive); `null` or absent without enough data. */
  wakeWindow?: WakeWindowDto | null;
  /** The next wet and dirty diaper (additive; absent on older servers). */
  diaper?: DiaperPredictionsDto | null;
}

/** Normalizes any ISO-8601 timestamp to UTC `Z` with millisecond precision. */
export function toUtcIso(value: string): string {
  return new Date(value).toISOString();
}

function toUtcIsoOrNull(value: string | null | undefined): string | null {
  return value ? toUtcIso(value) : null;
}

export function toEventUpsertRequest(event: BabyEvent): EventUpsertRequest {
  return {
    typeId: event.typeId,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    payload: event.payload,
    notes: event.notes,
    updatedAt: editTimeOf(event),
  };
}

/** Whether a response body is the `EventDto` of event `id` (bodies may be empty or unexpected). */
export function isEventDtoFor(value: unknown, id: string): value is EventDto {
  const dto = value as Partial<EventDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

export function fromEventDto(dto: EventDto): BabyEvent {
  return {
    id: dto.id,
    babyId: dto.babyId,
    typeId: dto.typeId,
    startedAt: toUtcIso(dto.startedAt),
    endedAt: toUtcIsoOrNull(dto.endedAt),
    payload: dto.payload ?? {},
    notes: dto.notes ?? null,
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
    deletedAt: toUtcIsoOrNull(dto.deletedAt),
  };
}

const ROLES: readonly BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer', 'Doctor'];
const FIELD_KINDS: readonly EventFieldKind[] = ['text', 'number', 'select', 'bool'];

function matchEnum<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return values.find((v) => v.toLowerCase() === raw?.toLowerCase());
}

const VACCINE_PROFILES: readonly VaccineProfileSetting[] = ['public', 'public+private'];
const RSV_ANSWERS: readonly RsvMaternalAnswer[] = ['unknown', 'yes', 'no'];

/** The vaccine profile fields of a baby wire object; only the ones the server sent (older servers send none). */
export function vaccineProfileFromDto(
  dto: Pick<BabyDto, 'vaccineProfile' | 'gestationalAgeWeeks' | 'rsvMaternalVaccination'>,
): Pick<Baby, 'vaccineProfile' | 'gestationalAgeWeeks' | 'rsvMaternalVaccination'> {
  const profile = matchEnum(VACCINE_PROFILES, dto.vaccineProfile ?? undefined);
  const rsv = matchEnum(RSV_ANSWERS, dto.rsvMaternalVaccination ?? undefined);
  const weeks = dto.gestationalAgeWeeks;
  return {
    ...(profile ? { vaccineProfile: profile } : {}),
    ...(typeof weeks === 'number' && Number.isFinite(weeks) ? { gestationalAgeWeeks: weeks } : {}),
    ...(weeks === null ? { gestationalAgeWeeks: null } : {}),
    ...(rsv ? { rsvMaternalVaccination: rsv } : {}),
    ...(dto.rsvMaternalVaccination === null ? { rsvMaternalVaccination: null } : {}),
  };
}

export function fromBabyDto(dto: BabyDto): Baby {
  const role = matchEnum(ROLES, dto.role);
  // A missing role degrades to the least privilege; the server enforces roles regardless.
  return {
    id: dto.id,
    name: dto.name ?? '',
    ...(typeof dto.label === 'string' && dto.label !== '' ? { label: dto.label } : {}),
    birthDate: dto.birthDate,
    ...(dto.birthWeekOnly === true ? { birthWeekOnly: true } : {}),
    role: role ?? 'Viewer',
    ...(typeof dto.userId === 'string' && dto.userId !== '' ? { userId: dto.userId } : {}),
    ...vaccineProfileFromDto(dto),
    ...(role === 'Doctor' ? { doctorScopes: parseScopes(dto.doctorScopes) } : {}),
  };
}

/** A well-formed condition, else `null` (an unreadable condition never hides a field). */
function fromVisibilityDto(dto: unknown): FieldVisibility | null {
  const value = dto as Partial<FieldVisibilityDto> | null | undefined;
  if (typeof value?.field !== 'string' || !Array.isArray(value.equals)) return null;
  const equals = value.equals.filter((option): option is string => typeof option === 'string');
  return { field: value.field, equals };
}

function fromFieldDto(dto: EventFieldDefinitionDto): EventFieldDefinition {
  return {
    key: dto.key,
    label: dto.label,
    kind: matchEnum(FIELD_KINDS, dto.kind) ?? 'text',
    isRequired: dto.isRequired ?? false,
    options: dto.options ?? [],
    min: dto.min ?? null,
    max: dto.max ?? null,
    unit: dto.unit ?? null,
    visibleWhen: fromVisibilityDto(dto.visibleWhen),
    ...(dto.hidden === true ? { hidden: true } : {}),
    ...(dto.integer === true ? { integer: true } : {}),
    ...(isDecimalPlaces(dto.decimals) ? { decimals: dto.decimals } : {}),
  };
}

/** A decimal-places limit the client understands (1 to 3); anything else is ignored. */
function isDecimalPlaces(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3;
}

export function fromEventTypeDto(dto: EventTypeDto): EventType {
  return {
    id: dto.id,
    babyId: dto.babyId ?? null,
    key: dto.key,
    name: dto.name,
    icon: dto.icon,
    color: dto.color,
    hasDuration: dto.hasDuration,
    fields: (dto.fields ?? []).map(fromFieldDto),
  };
}

export function fromMedicationDto(dto: MedicationDto): Medication {
  return {
    id: dto.id,
    babyId: dto.babyId,
    name: dto.name,
    defaultDosage: dto.defaultDosage ?? null,
    notes: dto.notes ?? null,
    isUsual: dto.isUsual,
    productId: dto.productId ?? null,
    createdAt: toUtcIso(dto.createdAt),
  };
}

/* Prescriptions */

export interface PrescriptionDto {
  id: string;
  babyId: string;
  medicationId: string;
  status: string;
  kind: string;
  dose: { amount: number; unit: string; perKg?: boolean; roundingStep?: number | null };
  timesOfDay?: string[] | null;
  everyMinutes?: number | null;
  /** Part-of-the-day codes (`morning`, `afternoon`, `evening`, `night`); absent on older servers. */
  dayParts?: string[] | null;
  dayPartReminders?: { part: string; time: string }[] | null;
  minIntervalMinutes?: number | null;
  maxDosesPer24h?: number | null;
  indication?: string | null;
  intervalGroup?: string | null;
  startDate: string;
  endDate?: string | null;
  prescriber?: string | null;
  instructions?: string | null;
  /** Provenance (additive; absent on prescriptions the parents entered). */
  prescribedByUserId?: string | null;
  /** The doctor's name without a title. */
  prescribedByName?: string | null;
  prescribedBy?: PersonSummaryDto | null;
  proposalId?: string | null;
  changedByParent?: boolean;
  original?: PrescriptionOriginalDto | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
  deletedAt?: string | null;
}

/** Editable fields of a prescription plus the client edit time (`PUT` replaces the terms). */
export interface PrescriptionUpsertRequest {
  medicationId: string;
  status: PrescriptionStatus;
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
  startDate: string;
  endDate: string | null;
  prescriber: string | null;
  instructions: string | null;
  updatedAt?: string;
}

export function toPrescriptionUpsertRequest(p: Prescription): PrescriptionUpsertRequest {
  return {
    medicationId: p.medicationId,
    status: p.status,
    kind: p.kind,
    dose: p.dose,
    timesOfDay: p.timesOfDay,
    everyMinutes: p.everyMinutes,
    dayParts: p.dayParts ?? null,
    dayPartReminders: p.dayPartReminders ?? null,
    minIntervalMinutes: p.minIntervalMinutes,
    maxDosesPer24h: p.maxDosesPer24h,
    indication: p.indication,
    intervalGroup: p.intervalGroup,
    startDate: p.startDate,
    endDate: p.endDate,
    prescriber: p.prescriber,
    instructions: p.instructions,
    updatedAt: p.clientUpdatedAt ?? p.updatedAt,
  };
}

export function isPrescriptionDtoFor(value: unknown, id: string): value is PrescriptionDto {
  const dto = value as Partial<PrescriptionDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

const DAY_PARTS: readonly DayPart[] = ['morning', 'afternoon', 'evening', 'night'];

const isDayPart = (value: unknown): value is DayPart =>
  typeof value === 'string' && (DAY_PARTS as readonly string[]).includes(value);

/** Known part codes in day order (unknown ones are dropped); `null` when absent or empty. */
function dayPartsFromDto(codes: PrescriptionDto['dayParts']): DayPart[] | null {
  if (!Array.isArray(codes)) return null;
  const parts = DAY_PARTS.filter((part) => codes.includes(part));
  return parts.length > 0 ? parts : null;
}

function dayPartRemindersFromDto(
  reminders: PrescriptionDto['dayPartReminders'],
): DayPartReminder[] | null {
  if (!Array.isArray(reminders)) return null;
  const valid = reminders.filter(
    (r): r is DayPartReminder => isDayPart(r?.part) && typeof r.time === 'string',
  );
  return valid.length > 0 ? valid.map((r) => ({ part: r.part, time: r.time })) : null;
}

export function fromPrescriptionDto(dto: PrescriptionDto): Prescription {
  return {
    id: dto.id,
    babyId: dto.babyId,
    medicationId: dto.medicationId,
    status: dto.status?.toLowerCase() === 'stopped' ? 'stopped' : 'active',
    kind: dto.kind?.toLowerCase() === 'scheduled' ? 'scheduled' : 'asNeeded',
    dose: {
      amount: dto.dose.amount,
      unit: dto.dose.unit,
      perKg: dto.dose.perKg === true,
      roundingStep: dto.dose.roundingStep ?? null,
    },
    timesOfDay: dto.timesOfDay ? [...dto.timesOfDay].sort() : null,
    everyMinutes: dto.everyMinutes ?? null,
    dayParts: dayPartsFromDto(dto.dayParts),
    dayPartReminders: dayPartRemindersFromDto(dto.dayPartReminders),
    minIntervalMinutes: dto.minIntervalMinutes ?? null,
    maxDosesPer24h: dto.maxDosesPer24h ?? null,
    indication: dto.indication ?? null,
    intervalGroup: dto.intervalGroup ?? null,
    startDate: dto.startDate,
    endDate: dto.endDate ?? null,
    prescriber: dto.prescriber ?? null,
    instructions: dto.instructions ?? null,
    ...(dto.prescribedByUserId !== undefined || dto.proposalId !== undefined
      ? {
          prescribedByUserId: dto.prescribedByUserId ?? null,
          prescribedByName: dto.prescribedByName ?? null,
          prescribedBy: fromPersonDto(dto.prescribedBy),
          proposalId: dto.proposalId ?? null,
          changedByParent: dto.changedByParent === true,
          original: dto.original ? fromOriginalDto(dto.original) : null,
        }
      : {}),
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
    deletedAt: toUtcIsoOrNull(dto.deletedAt),
  };
}

/* Prescription proposals (docs/design/16-doctor-access.md section 10) */

/** The prescription content as the wire carries it (a proposal's, and the `original` of a prescription). */
export interface PrescriptionContentDto {
  kind: string;
  dose: { amount: number; unit: string; perKg?: boolean; roundingStep?: number | null };
  timesOfDay?: string[] | null;
  everyMinutes?: number | null;
  dayParts?: string[] | null;
  dayPartReminders?: { part: string; time: string }[] | null;
  minIntervalMinutes?: number | null;
  maxDosesPer24h?: number | null;
  indication?: string | null;
  intervalGroup?: string | null;
  startDate: string;
  endDate?: string | null;
  instructions?: string | null;
}

export interface PrescriptionOriginalDto extends PrescriptionContentDto {
  medicationName: string;
  productId?: string | null;
}

export interface ProposalDto extends PrescriptionContentDto {
  id: string;
  babyId: string;
  authorUserId?: string | null;
  author?: PersonSummaryDto | null;
  medicationId?: string | null;
  productId?: string | null;
  medicationName: string;
  replacesPrescriptionId?: string | null;
  status: string;
  declineReason?: string | null;
  cancelReason?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  acceptedPrescriptionId?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
}

/** The full state of a proposal plus the client edit time (`PUT` replaces it). */
export interface ProposalUpsertRequest extends PrescriptionContent {
  medicationId: string | null;
  productId: string | null;
  medicationName: string;
  replacesPrescriptionId: string | null;
  updatedAt?: string;
}

/** What a parent's accept or decline queues (the outbox payload of a `proposalDecision`). */
export interface ProposalDecisionPayload {
  action: 'accept' | 'decline';
  /** Accept: the id of the prescription the server creates (a replay reuses it). */
  prescriptionId?: string;
  /** Accept: the parent's local calendar day, when a replaced prescription ends. */
  acceptedOn?: string;
  /** Decline: the parent's optional words (up to 500 characters). */
  reason?: string | null;
}

/** The answer of accept and decline: the proposal and, on accept, the prescription it created. */
export interface ProposalDecisionResponse {
  proposal: ProposalDto;
  prescription?: PrescriptionDto | null;
}

/** The answer of `PUT /notes/{id}/read` and the items of `GET /note-reads`. */
export interface NoteReadDto {
  noteId: string;
  readAt: string;
}

export function toProposalUpsertRequest(p: Proposal): ProposalUpsertRequest {
  return {
    medicationId: p.medicationId,
    productId: p.productId,
    medicationName: p.medicationName,
    kind: p.kind,
    dose: p.dose,
    timesOfDay: p.timesOfDay,
    everyMinutes: p.everyMinutes,
    dayParts: p.dayParts,
    dayPartReminders: p.dayPartReminders,
    minIntervalMinutes: p.minIntervalMinutes,
    maxDosesPer24h: p.maxDosesPer24h,
    indication: p.indication,
    intervalGroup: p.intervalGroup,
    startDate: p.startDate,
    endDate: p.endDate,
    instructions: p.instructions,
    replacesPrescriptionId: p.replacesPrescriptionId,
    updatedAt: p.clientUpdatedAt ?? p.updatedAt,
  };
}

export function isProposalDtoFor(value: unknown, id: string): value is ProposalDto {
  const dto = value as Partial<ProposalDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

export function isProposalDecisionFor(
  value: unknown,
  id: string,
): value is ProposalDecisionResponse {
  const response = value as Partial<ProposalDecisionResponse> | undefined;
  return (
    typeof response === 'object' && response !== null && isProposalDtoFor(response.proposal, id)
  );
}

/** The prescription content of a wire object; unknown codes degrade to the safest reading. */
function fromContentDto(dto: PrescriptionContentDto): PrescriptionContent {
  return {
    kind: dto.kind?.toLowerCase() === 'scheduled' ? 'scheduled' : 'asNeeded',
    dose: {
      amount: dto.dose.amount,
      unit: dto.dose.unit,
      perKg: dto.dose.perKg === true,
      roundingStep: dto.dose.roundingStep ?? null,
    },
    timesOfDay: dto.timesOfDay ? [...dto.timesOfDay].sort() : null,
    everyMinutes: dto.everyMinutes ?? null,
    dayParts: dayPartsFromDto(dto.dayParts),
    dayPartReminders: dayPartRemindersFromDto(dto.dayPartReminders),
    minIntervalMinutes: dto.minIntervalMinutes ?? null,
    maxDosesPer24h: dto.maxDosesPer24h ?? null,
    indication: dto.indication ?? null,
    intervalGroup: dto.intervalGroup ?? null,
    startDate: dto.startDate,
    endDate: dto.endDate ?? null,
    instructions: dto.instructions ?? null,
  };
}

export function fromOriginalDto(dto: PrescriptionOriginalDto): PrescriptionOriginal {
  return {
    ...fromContentDto(dto),
    medicationName: dto.medicationName,
    productId: dto.productId ?? null,
  };
}

const CANCEL_REASONS: readonly ProposalCancelReason[] = ['withdrawn', 'access_removed'];

/** An unknown status from a newer server reads as cancelled: never offered for a decision. */
export function fromProposalDto(dto: ProposalDto): Proposal {
  const status = dto.status?.toLowerCase();
  return {
    ...fromContentDto(dto),
    id: dto.id,
    babyId: dto.babyId,
    authorUserId: dto.authorUserId ?? null,
    author: fromPersonDto(dto.author),
    medicationId: dto.medicationId ?? null,
    productId: dto.productId ?? null,
    medicationName: dto.medicationName,
    replacesPrescriptionId: dto.replacesPrescriptionId ?? null,
    status: isProposalStatus(status) ? status : 'cancelled',
    declineReason: dto.declineReason ?? null,
    cancelReason: matchEnum(CANCEL_REASONS, dto.cancelReason ?? undefined) ?? null,
    decidedBy: dto.decidedBy ?? null,
    decidedAt: toUtcIsoOrNull(dto.decidedAt),
    acceptedPrescriptionId: dto.acceptedPrescriptionId ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
  };
}

export function fromNoteReadDto(babyId: string, dto: NoteReadDto): NoteRead {
  return { noteId: dto.noteId, babyId, readAt: toUtcIso(dto.readAt) };
}

/* Formulas */

export interface FormulaDto {
  id: string;
  babyId: string;
  name: string;
  brand?: string | null;
  stage?: string | null;
  notes?: string | null;
  startedOn?: string | null;
  isCurrent?: boolean;
  archived?: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
}

/** The full editable state of a formula plus the client edit time (`PUT` replaces it). */
export interface FormulaUpsertRequest {
  name: string;
  brand: string | null;
  stage: string | null;
  notes: string | null;
  startedOn: string | null;
  isCurrent: boolean;
  archived: boolean;
  updatedAt?: string;
}

export function toFormulaUpsertRequest(f: Formula): FormulaUpsertRequest {
  return {
    name: f.name,
    brand: f.brand,
    stage: f.stage,
    notes: f.notes,
    startedOn: f.startedOn,
    isCurrent: f.isCurrent,
    archived: f.archived,
    updatedAt: f.clientUpdatedAt ?? f.updatedAt,
  };
}

export function isFormulaDtoFor(value: unknown, id: string): value is FormulaDto {
  const dto = value as Partial<FormulaDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

export function fromFormulaDto(dto: FormulaDto): Formula {
  const archived = dto.archived === true;
  return {
    id: dto.id,
    babyId: dto.babyId,
    name: dto.name,
    brand: dto.brand ?? null,
    stage: dto.stage ?? null,
    notes: dto.notes ?? null,
    startedOn: dto.startedOn ?? null,
    isCurrent: dto.isCurrent === true && !archived,
    archived,
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
  };
}

/* Appointments */

export interface AppointmentDto {
  id: string;
  babyId: string;
  title: string;
  type: string;
  startsAt: string;
  durationMinutes?: number | null;
  location?: string | null;
  doctorName?: string | null;
  notes?: string | null;
  outcome?: string | null;
  status?: string;
  reminderOffsetsMinutes?: number[] | null;
  providerId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
}

/** The full editable state of an appointment plus the client edit time (`PUT` replaces it). */
export interface AppointmentUpsertRequest {
  title: string;
  type: AppointmentType;
  startsAt: string;
  durationMinutes: number | null;
  location: string | null;
  doctorName: string | null;
  notes: string | null;
  outcome: string | null;
  status: AppointmentStatus;
  reminderOffsetsMinutes: ReminderOffset[];
  providerId: string | null;
  updatedAt?: string;
}

export function toAppointmentUpsertRequest(a: Appointment): AppointmentUpsertRequest {
  return {
    title: a.title,
    type: a.type,
    startsAt: a.startsAt,
    durationMinutes: a.durationMinutes,
    location: a.location,
    doctorName: a.doctorName,
    notes: a.notes,
    outcome: a.outcome,
    status: a.status,
    reminderOffsetsMinutes: a.reminderOffsetsMinutes,
    providerId: a.providerId ?? null,
    updatedAt: a.clientUpdatedAt ?? a.updatedAt,
  };
}

export function isAppointmentDtoFor(value: unknown, id: string): value is AppointmentDto {
  const dto = value as Partial<AppointmentDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

/** Unknown codes from a newer server degrade to `other` / `upcoming`; unknown offsets are dropped. */
export function fromAppointmentDto(dto: AppointmentDto): Appointment {
  return {
    id: dto.id,
    babyId: dto.babyId,
    title: dto.title,
    type: isAppointmentType(dto.type) ? dto.type : 'other',
    startsAt: toUtcIso(dto.startsAt),
    durationMinutes: dto.durationMinutes ?? null,
    location: dto.location ?? null,
    doctorName: dto.doctorName ?? null,
    notes: dto.notes ?? null,
    outcome: dto.outcome ?? null,
    status: isAppointmentStatus(dto.status) ? dto.status : 'upcoming',
    reminderOffsetsMinutes: normalizeReminders(dto.reminderOffsetsMinutes ?? []),
    providerId: dto.providerId ?? null,
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
  };
}

/* Care providers (docs/design/22-care-providers.md) */

export interface CareProviderDto {
  id: string;
  babyId: string;
  name: string;
  specialty?: string | null;
  registrationCouncil?: string | null;
  registrationNumber?: string | null;
  registrationRegion?: string | null;
  clinicName?: string | null;
  address?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  isFavorite?: boolean;
  isDeleted?: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
}

/** The full editable state of a provider plus the client edit time (`PUT` replaces it). */
export interface CareProviderUpsertRequest {
  name: string;
  specialty: string | null;
  registrationCouncil: string | null;
  registrationNumber: string | null;
  registrationRegion: string | null;
  clinicName: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  isFavorite: boolean;
  isDeleted: boolean;
  updatedAt?: string;
}

export function toCareProviderUpsertRequest(p: CareProvider): CareProviderUpsertRequest {
  return {
    name: p.name,
    specialty: p.specialty,
    registrationCouncil: p.registrationCouncil,
    registrationNumber: p.registrationNumber,
    registrationRegion: p.registrationRegion,
    clinicName: p.clinicName,
    address: p.address,
    phone: p.phone,
    whatsapp: p.whatsapp,
    email: p.email,
    website: p.website,
    notes: p.notes,
    isFavorite: p.favorite,
    isDeleted: p.deleted,
    updatedAt: p.clientUpdatedAt ?? p.updatedAt,
  };
}

export function isCareProviderDtoFor(value: unknown, id: string): value is CareProviderDto {
  const dto = value as Partial<CareProviderDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

export function fromCareProviderDto(dto: CareProviderDto): CareProvider {
  return {
    id: dto.id,
    babyId: dto.babyId,
    name: dto.name,
    specialty: dto.specialty ?? null,
    registrationCouncil: dto.registrationCouncil ?? null,
    registrationNumber: dto.registrationNumber ?? null,
    registrationRegion: dto.registrationRegion ?? null,
    clinicName: dto.clinicName ?? null,
    address: dto.address ?? null,
    phone: dto.phone ?? null,
    whatsapp: dto.whatsapp ?? null,
    email: dto.email ?? null,
    website: dto.website ?? null,
    notes: dto.notes ?? null,
    favorite: dto.isFavorite === true,
    deleted: dto.isDeleted === true,
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
  };
}

/* Vaccinations (docs/design/18-vaccines.md) */

export interface VaccinationDto {
  id: string;
  babyId: string;
  vaccineKey?: string | null;
  doseId?: string | null;
  customName?: string | null;
  doseLabel?: string | null;
  givenOn: string;
  network?: string;
  clinic?: string | null;
  lot?: string | null;
  administeredBy?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
  deletedAt?: string | null;
}

/** The full editable state of a vaccination plus the client edit time (`PUT` replaces it). */
export interface VaccinationUpsertRequest {
  vaccineKey: string | null;
  doseId: string | null;
  customName: string | null;
  doseLabel: string | null;
  givenOn: string;
  network: VaccineNetwork;
  clinic: string | null;
  lot: string | null;
  administeredBy: string | null;
  notes: string | null;
  updatedAt?: string;
}

export function toVaccinationUpsertRequest(v: Vaccination): VaccinationUpsertRequest {
  return {
    vaccineKey: v.vaccineKey,
    doseId: v.doseId,
    customName: v.customName,
    doseLabel: v.doseLabel,
    givenOn: v.givenOn,
    network: v.network,
    clinic: v.clinic,
    lot: v.lot,
    administeredBy: v.administeredBy,
    notes: v.notes,
    updatedAt: v.clientUpdatedAt ?? v.updatedAt,
  };
}

export function isVaccinationDtoFor(value: unknown, id: string): value is VaccinationDto {
  const dto = value as Partial<VaccinationDto> | undefined;
  return (
    typeof dto === 'object' &&
    dto !== null &&
    dto.id === id &&
    !!dto.updatedAt &&
    typeof dto.givenOn === 'string'
  );
}

/** An unknown network from a newer server reads as `public`. */
export function fromVaccinationDto(dto: VaccinationDto): Vaccination {
  return {
    id: dto.id,
    babyId: dto.babyId,
    vaccineKey: dto.vaccineKey ?? null,
    doseId: dto.doseId ?? null,
    customName: dto.customName ?? null,
    doseLabel: dto.doseLabel ?? null,
    givenOn: dto.givenOn,
    network: isVaccineNetwork(dto.network) ? dto.network : 'public',
    clinic: dto.clinic ?? null,
    lot: dto.lot ?? null,
    administeredBy: dto.administeredBy ?? null,
    notes: dto.notes ?? null,
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
    deletedAt: toUtcIsoOrNull(dto.deletedAt),
  };
}

/** Body of `PUT /babies/{id}/vaccine-profile` (full state; `null` clears). */
export interface VaccineProfileRequest {
  vaccineProfile: VaccineProfileSetting;
  gestationalAgeWeeks: number | null;
  rsvMaternalVaccination: RsvMaternalAnswer | null;
}

/* Shared medication catalog (instance-wide). */

export type ProductForm =
  | 'drops'
  | 'syrup'
  | 'tablet'
  | 'powder'
  | 'spray'
  | 'ointment'
  | 'suppository'
  | 'inhaler'
  | 'other';

export interface ProductSubstanceDto {
  substanceId: string;
  key: string;
  nameEn: string;
  namePtBr: string;
  strength: {
    amount: number;
    unit: string;
    perAmount?: number | null;
    perUnit?: string | null;
  } | null;
}

export interface ProductDto {
  id: string;
  name: string;
  form: ProductForm;
  country: string;
  /**
   * `official`: imported from an official registry (`source` `anvisa`); `curated`: from the importer's
   * curated list (`source` `curated`, not reviewed by a pharmacist).
   */
  status: 'seed' | 'community' | 'verified' | 'official' | 'curated';
  mergedIntoId: string | null;
  substances: ProductSubstanceDto[];
  createdAt: string;
  /** Additive: the official registry of an `official` product, else `null`/absent. */
  source?: string | null;
  /** Additive: dosage text the official name carried (e.g. `0,9%`). */
  presentation?: string | null;
  /**
   * Additive: the strength as the source states it (e.g. `75 mg/mL`); `null`/absent when not known
   * (the importer has not run since strengths were added, a combination, several strengths).
   * Composition information, never a dose.
   */
  strengthText?: string | null;
  /** Additive: the official product left its registry; search no longer offers it. */
  inactive?: boolean;
  /**
   * Additive: the source name this product shares with products of other ingredients (e.g. `Sorine`);
   * the app warns to check the box. `null`/absent when the name is unambiguous.
   */
  ambiguousName?: string | null;
}

/**
 * How an alternative with the same active ingredient compares to the searched product. Only
 * `equivalent` means the same ingredients, strength and known form.
 */
export type AlternativeLevel =
  'equivalent' | 'differentForm' | 'strengthNotKnown' | 'differentStrength';

export interface SiblingProductDto {
  id: string;
  name: string;
  form: ProductForm;
  country: string;
  status: string;
  /** Additive: the strength as the source states it; `null`/absent when not known. */
  strengthText?: string | null;
  /** Additive: absent from older servers and offline lists, which read as `strengthNotKnown`. */
  matchLevel?: AlternativeLevel | null;
}

export interface ProductMatchDto {
  product: ProductDto;
  matchedBy: 'name' | 'alias' | 'substance';
  distance: number;
  sameActiveIngredient: SiblingProductDto[];
}

export interface CreateProductRequest {
  name: string;
  form: ProductForm;
  country: string;
  substances?: { substanceId: string }[];
}

/** Parses a role string from the API; unknown values degrade to the least privilege. */
export function parseRole(raw: string | undefined): BabyRole {
  return matchEnum(ROLES, raw) ?? 'Viewer';
}

/* Growth measurements (docs/SPEC.md "Measurements"): online-only, fetched as a whole list. */

export interface MeasurementDto {
  id: string;
  babyId: string;
  /** Calendar date `yyyy-mm-dd`. */
  date: string;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recorded by the baby's Doctor during a consultation (additive). */
  recordedByDoctor?: boolean;
  /** That Doctor, as the family sees her; only when `recordedByDoctor` (additive). */
  recordedBy?: PersonSummaryDto | null;
}

/** Full state of a measurement (`PUT` replaces it). */
export interface MeasurementRequest {
  date: string;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  notes: string | null;
}

/* Napper import (docs/SPEC.md "Napper import API"). */

export type MedicationMappingAction = 'existing' | 'create' | 'ignore';

export interface MedicationMapping {
  token: string;
  action: MedicationMappingAction;
  medicationId?: string;
  name?: string;
}

export interface NapperImportRequest {
  logsCsv?: string;
  measurementsCsv?: string;
  medicationMappings?: MedicationMapping[];
  /** `enrichExisting`: fill missing detail fields of events imported earlier (never times). */
  options?: { enrichExisting?: boolean };
}

export interface NapperSkippedRow {
  row: number;
  category?: string | null;
  code: string;
  reason: string;
}

export interface NapperCategorySummary {
  category: string;
  eventTypeKey: string | null;
  total: number;
  toCreate: number;
  alreadyImported: number;
  skipped: number;
}

export interface NapperSummaryBase {
  totalRows: number;
  toCreate: number;
  alreadyImported: number;
  skipped: number;
  from: string | null;
  to: string | null;
  skippedRows: NapperSkippedRow[];
}

/** A detail value that could not be mapped to its field; the row itself is still imported. */
export interface NapperSkippedField {
  row: number;
  category: string;
  /** The Napper column. */
  field: string;
  value: string;
  code: string;
  reason: string;
}

export interface NapperLogsSummary extends NapperSummaryBase {
  categories: NapperCategorySummary[];
  /** Additive: absent on servers that predate it. */
  skippedFields?: NapperSkippedField[];
}

/** How many events got this detail field filled by `enrichExisting`. */
export interface NapperEnrichedField {
  field: string;
  count: number;
}

export type NapperMeasurementsSummary = NapperSummaryBase;

export interface MedicationSuggestion {
  token: string;
  occurrences: number;
  suggestion: 'existing' | 'create';
  medicationId: string | null;
  medicationName: string;
  distance: number | null;
  similarTokens: string[];
  isMapped: boolean;
}

export interface NapperPreviewDto {
  logs: NapperLogsSummary | null;
  measurements: NapperMeasurementsSummary | null;
  medicationSuggestions: MedicationSuggestion[];
  unmappedTokens: string[];
  /** Additive (`enrichExisting`): events that would be enriched, 0 without the option. */
  eventsEnriched?: number;
  enrichedFields?: NapperEnrichedField[];
}

export interface NapperImportResultDto {
  eventsCreated: number;
  eventsEnriched?: number;
  enrichedFields?: NapperEnrichedField[];
  measurementsCreated: number;
  createdMedications: { id: string; name: string }[];
  logs: NapperLogsSummary | null;
  measurements: NapperMeasurementsSummary | null;
}

/* Notes and doctor access (docs/design/16-doctor-access.md) */

export interface ProfessionalSummaryDto {
  kind?: string;
  displayName: string;
  specialty?: string | null;
  registrationNumber?: string | null;
  verified?: boolean;
  /** Own profile only: whether name / registration are shown to families. */
  shareDisplayName?: boolean;
  shareRegistration?: boolean;
}

export interface PersonSummaryDto {
  userId: string;
  displayName: string;
  roleLabel?: string | null;
  professional?: ProfessionalSummaryDto | null;
}

/** The caller's own professional profile (`GET/PUT /me/professional-profile`). */
export interface ProfessionalProfileDto extends ProfessionalSummaryDto {
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/** Body of `PUT /me/professional-profile` (v1 knows the `doctor` kind only; never `verified`). */
export interface ProfessionalProfileRequest {
  kind: 'doctor';
  displayName: string;
  specialty: string;
  registrationNumber: string | null;
  shareDisplayName: boolean;
  shareRegistration: boolean;
}

export interface AccessLogEntryDto {
  userId: string;
  person?: PersonSummaryDto | null;
  role: string;
  kind: string;
  at: string;
}

export interface NoteDto {
  id: string;
  babyId: string;
  authorUserId: string;
  author?: PersonSummaryDto | null;
  kind: string;
  visibility: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt?: string | null;
  deletedAt?: string | null;
}

/** The full editable state of a note plus the client edit time (`PUT` replaces it). */
export interface NoteUpsertRequest {
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
  updatedAt?: string;
}

export function fromProfessionalDto(
  dto: ProfessionalSummaryDto | null | undefined,
): ProfessionalSummary | null {
  if (!dto || typeof dto.displayName !== 'string') return null;
  return {
    kind: 'doctor',
    displayName: dto.displayName,
    specialty: dto.specialty ?? null,
    registrationNumber: dto.registrationNumber ?? null,
    verified: dto.verified === true,
    shareDisplayName: dto.shareDisplayName ?? true,
    shareRegistration: dto.shareRegistration ?? true,
  };
}

export function fromPersonDto(dto: PersonSummaryDto | null | undefined): PersonSummary | null {
  if (!dto || typeof dto.userId !== 'string') return null;
  return {
    userId: dto.userId,
    displayName: dto.displayName ?? '',
    roleLabel: dto.roleLabel ?? null,
    professional: fromProfessionalDto(dto.professional),
  };
}

export function toNoteUpsertRequest(note: Note): NoteUpsertRequest {
  return {
    kind: note.kind,
    visibility: note.visibility,
    body: note.body,
    updatedAt: note.clientUpdatedAt ?? note.updatedAt,
  };
}

export function isNoteDtoFor(value: unknown, id: string): value is NoteDto {
  const dto = value as Partial<NoteDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

export function fromNoteDto(dto: NoteDto): Note {
  return {
    id: dto.id,
    babyId: dto.babyId,
    authorUserId: dto.authorUserId ?? null,
    author: fromPersonDto(dto.author),
    kind: dto.kind === 'recommendation' ? 'recommendation' : 'note',
    // Anything unreadable is treated as private: shown to nobody but the author's own device.
    visibility: dto.visibility === 'shared' ? 'shared' : 'private',
    body: dto.body,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
    deletedAt: toUtcIsoOrNull(dto.deletedAt ?? null),
  };
}
