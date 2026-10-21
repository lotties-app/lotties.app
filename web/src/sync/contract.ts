import type {
  Baby,
  BabyEvent,
  BabyRole,
  Dosage,
  EventFieldDefinition,
  EventFieldKind,
  EventPayload,
  EventType,
  Medication,
} from '../db/models';

/*
 * API wire contract (`/api/v1`) used by the sync engine. This is the ONLY place the client
 * assumes the API shapes (events: docs/SPEC.md "Events sync contract"; others still assumed until
 * PLAN tasks 4-5 land):
 * - JSON is camelCase; timestamps are ISO-8601 with any offset and are normalized to UTC `Z`.
 *   Errors are RFC 7807 problem details with a stable `code` extension.
 * - PUT    /babies/{id}/events/{eventId}  body EventUpsertRequest incl. the local edit time as
 *          `updatedAt` (server last-write-wins: an older one is ignored and the stored copy is
 *          returned). Replies 200/201 with the stored EventDto (an empty body is tolerated); the
 *          server stamps `updatedAt` on receipt. 409 `event_baby_mismatch`, 422
 *          `event_type_not_available`, 400 validation.
 * - DELETE /babies/{id}/events/{eventId}  soft delete, always 204; 404 is treated as "already gone".
 * - GET    /babies/{id}/events?since=<updatedAt>&after=<cursor>  EventDto[] with
 *          `updatedAt >= since` (inclusive, so boundary rows repeat; merge is idempotent),
 *          INCLUDING soft-deleted ones, ordered by (updatedAt, id), up to 500 per page. While more
 *          rows follow, header `X-Next-Cursor` holds an opaque cursor passed back as `after`.
 * - GET    /babies -> BabyDto[]; /babies/{id}/event-types -> EventTypeDto[] (built-ins + custom);
 *          /babies/{id}/medications -> MedicationDto[].
 * - PUT    /babies/{id}/medications/{medicationId}  body MedicationUpsertRequest; idempotent upsert
 *          (client GUID); any 2xx body is ignored. Medication pulls are not delta-based yet.
 * - Medication event payload: { medications: [{ medicationId, name, dose?: { amount, unit } }] }.
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
  acceptInvite: (token: string) => `${API_PREFIX}/invites/${enc(token)}/accept`,
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
  predictions: (babyId: string, utcOffsetMinutes: number) =>
    `${API_PREFIX}/babies/${enc(babyId)}/predictions?utcOffsetMinutes=${utcOffsetMinutes}`,
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
  updatedAt: string;
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
  defaultDosage: Dosage | null;
  notes: string | null;
  isUsual: boolean;
}

export function toMedicationUpsertRequest(medication: Medication): MedicationUpsertRequest {
  return {
    name: medication.name,
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

export interface PredictionsDto {
  babyId: string;
  generatedAt: string;
  predictions: PredictionDto[];
  insufficientData: InsufficientDataDto[];
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
    updatedAt: event.updatedAt,
  };
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
    deletedAt: toUtcIsoOrNull(dto.deletedAt),
  };
}

const ROLES: readonly BabyRole[] = ['Owner', 'Parent', 'Viewer'];
const FIELD_KINDS: readonly EventFieldKind[] = ['text', 'number', 'select', 'bool'];

function matchEnum<T extends string>(values: readonly T[], raw: string | undefined): T | undefined {
  return values.find((v) => v.toLowerCase() === raw?.toLowerCase());
}

export function fromBabyDto(dto: BabyDto): Baby {
  const role = matchEnum(ROLES, dto.role);
  // A missing role degrades to the least privilege; the server enforces roles regardless.
  return { id: dto.id, name: dto.name, birthDate: dto.birthDate, role: role ?? 'Viewer' };
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
    createdAt: toUtcIso(dto.createdAt),
  };
}

/** Parses a role string from the API; unknown values degrade to the least privilege. */
export function parseRole(raw: string | undefined): BabyRole {
  return matchEnum(ROLES, raw) ?? 'Viewer';
}
