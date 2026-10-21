/**
 * Local (IndexedDB) models. They mirror the SPEC domain shapes; the wire DTOs live in
 * `src/sync/contract.ts` and are mapped onto these. All timestamps are UTC ISO-8601 strings
 * (`Date#toISOString()`, e.g. `2026-10-20T08:15:00.000Z`) so string order equals time order.
 */

export type BabyRole = 'Owner' | 'Parent' | 'Viewer';

export interface Baby {
  id: string;
  name: string;
  /** Calendar date `yyyy-mm-dd`. */
  birthDate: string;
  /** The current user's role for this baby (from `GET /babies`). */
  role: BabyRole;
}

export type EventFieldKind = 'text' | 'number' | 'select' | 'bool';

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
  createdAt: string;
}

/** Type-specific event data (a JSON object). */
export type EventPayload = Record<string, unknown>;

/** Payload of a medication event: the catalog entries the parent selected. */
export interface MedicationEventPayload extends EventPayload {
  /** `name` is a snapshot so the timeline stays readable if the catalog entry changes. */
  medications: { medicationId: string; name: string; dose?: Dosage }[];
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
  /** Local clock until pushed; replaced by the server's clock once synced. */
  updatedAt: string;
  /** Soft delete marker. */
  deletedAt: string | null;
}

export type MutationKind = 'upsert' | 'delete';
export type MutationEntityType = 'event' | 'medication';
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
  attempts: number;
  lastError: string | null;
  status: MutationStatus;
  /** Earliest time the next attempt may run (backoff); `null` = now. */
  nextAttemptAt: string | null;
}

export type SyncEntity = 'events';

/** Delta-pull cursor per baby and entity. */
export interface SyncCursor {
  babyId: string;
  entity: SyncEntity;
  /** Raw `updatedAt` of the newest item received from the server (sent back as `since`). */
  lastSyncedAt: string;
}
