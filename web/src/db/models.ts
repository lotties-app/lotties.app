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

/** The time of the event's last edit on the client clock, for last-write-wins comparisons. */
export function editTimeOf(event: Pick<BabyEvent, 'clientUpdatedAt' | 'updatedAt'>): string {
  return event.clientUpdatedAt ?? event.updatedAt;
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
export type SyncEntity = 'events' | 'babies';

/** `babyId` of the `babies` marker row (not a baby id). */
export const BABIES_LISTED_KEY = '*';

/** Delta-pull cursor per baby and entity. */
export interface SyncCursor {
  babyId: string;
  entity: SyncEntity;
  /** Raw `updatedAt` of the newest item received from the server (sent back as `since`). */
  lastSyncedAt: string;
}
