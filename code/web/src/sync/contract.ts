import {
  editTimeOf,
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
  type Medication,
  type Prescription,
  type PrescriptionDose,
  type PrescriptionKind,
  type PrescriptionStatus,
} from '../db/models';

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
  /** Anonymous: body `{ action, token }`, the per-delivery token is the credential. */
  pushDeliveryAction: (deliveryId: string) =>
    `${API_PREFIX}/push/deliveries/${enc(deliveryId)}/actions`,
  notificationPreferences: (babyId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/notification-preferences`,
};

/** Response header carrying the delta paging cursor; absent on the last page. */
export const NEXT_CURSOR_HEADER = 'X-Next-Cursor';

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
  name: string;
  birthDate: string;
  role?: string;
  /** The caller's own user id (additive; absent from older servers). */
  userId?: string;
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
  name: string;
  /** `yyyy-mm-dd`. */
  birthDate: string;
}

export interface MemberDto {
  userId: string;
  displayName: string | null;
  role: string;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  babyId: string;
  role: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Returned once by `POST /invites`: the only time the plain token is available. */
export interface CreatedInviteDto extends InviteDto {
  token: string;
}

export interface CreateInviteRequest {
  role: BabyRole;
  expiresInDays?: number;
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

const ROLES: readonly BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer'];
const FIELD_KINDS: readonly EventFieldKind[] = ['text', 'number', 'select', 'bool'];

function matchEnum<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return values.find((v) => v.toLowerCase() === raw?.toLowerCase());
}

export function fromBabyDto(dto: BabyDto): Baby {
  const role = matchEnum(ROLES, dto.role);
  // A missing role degrades to the least privilege; the server enforces roles regardless.
  return {
    id: dto.id,
    name: dto.name,
    birthDate: dto.birthDate,
    role: role ?? 'Viewer',
    ...(typeof dto.userId === 'string' && dto.userId !== '' ? { userId: dto.userId } : {}),
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
  };
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
    createdBy: dto.createdBy ?? null,
    createdAt: toUtcIso(dto.createdAt),
    updatedAt: toUtcIso(dto.updatedAt),
    clientUpdatedAt: toUtcIso(dto.clientUpdatedAt || dto.updatedAt),
    deletedAt: toUtcIsoOrNull(dto.deletedAt),
  };
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
  /** Additive: the official product left its registry; search no longer offers it. */
  inactive?: boolean;
  /**
   * Additive: the source name this product shares with products of other ingredients (e.g. `Sorine`);
   * the app warns to check the box. `null`/absent when the name is unambiguous.
   */
  ambiguousName?: string | null;
}

export interface SiblingProductDto {
  id: string;
  name: string;
  form: ProductForm;
  country: string;
  status: string;
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
