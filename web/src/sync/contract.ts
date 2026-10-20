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
 * assumes the API shapes; align it here when PLAN tasks 4-6 land. Assumed so far:
 * - JSON is camelCase; timestamps are ISO-8601 with any offset and are normalized to UTC `Z`.
 * - PUT    /babies/{id}/events/{eventId}  body EventUpsertRequest; idempotent upsert; replies
 *          200/201 with an EventDto (an empty body is tolerated). The server sets `updatedAt`.
 * - DELETE /babies/{id}/events/{eventId}  soft delete, idempotent; 404 is treated as "already gone".
 * - GET    /babies/{id}/events?since=<updatedAt>  EventDto[] changed after `since`, INCLUDING
 *          soft-deleted ones; no paging; `since` omitted for a full pull. Items equal to `since`
 *          may be repeated (merge is idempotent).
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
  eventTypes: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/event-types`,
  medications: (babyId: string) => `${API_PREFIX}/babies/${enc(babyId)}/medications`,
  event: (babyId: string, eventId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/events/${enc(eventId)}`,
  medication: (babyId: string, medicationId: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/medications/${enc(medicationId)}`,
  eventsDelta: (babyId: string, since?: string) =>
    `${API_PREFIX}/babies/${enc(babyId)}/events` +
    (since ? `?since=${encodeURIComponent(since)}` : ''),
};

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
  return { id: dto.id, name: dto.name, birthDate: dto.birthDate, ...(role ? { role } : {}) };
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
