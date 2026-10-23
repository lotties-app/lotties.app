import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie';
import type {
  Appointment,
  CareProvider,
  Baby,
  BabyEvent,
  EventType,
  BodyWeightRow,
  Formula,
  CachedProduct,
  Medication,
  Note,
  NoteRead,
  OutboxMutation,
  Prescription,
  Proposal,
  SyncCursor,
  SyncEntity,
  Vaccination,
  VaccineScheduleCache,
} from './models';

interface SchemaVersion {
  version: number;
  /** Dexie store definitions; only changed tables need to be listed in later versions. */
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => PromiseLike<unknown> | void;
}

/**
 * Versioned schema. Never edit a released entry: append a new version with the changed stores
 * (and an `upgrade` to migrate data when needed).
 */
export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      babies: 'id',
      eventTypes: 'id, babyId',
      medications: 'id, babyId',
      events: 'id, [babyId+startedAt], [babyId+updatedAt], deletedAt',
      outbox: '++id, babyId, entityId, status',
      syncState: '[babyId+entity]',
    },
  },
  {
    // `Baby.role` became required. Rows saved before it existed get the write-capable Parent
    // role until the next sync replaces them with the server's value (the server enforces roles).
    version: 2,
    stores: {},
    upgrade: (tx) =>
      tx
        .table<Baby, string>('babies')
        .toCollection()
        .modify((baby) => {
          baby.role ??= 'Parent';
        }),
  },
  {
    // Medications M2: prescriptions (synced), cached shared-catalog products, latest weight.
    version: 3,
    stores: {
      prescriptions: 'id, babyId, medicationId, [babyId+updatedAt]',
      catalogProducts: 'id, usedAt',
      bodyWeights: 'babyId',
    },
  },
  {
    // Formulas: the baby's formula list (synced like prescriptions, never deleted).
    version: 4,
    stores: {
      formulas: 'id, babyId, [babyId+updatedAt]',
    },
  },
  {
    // Appointments: the baby's calendar (synced like formulas, cancelled instead of deleted).
    version: 5,
    stores: {
      appointments: 'id, babyId, [babyId+startsAt], [babyId+updatedAt]',
    },
  },
  {
    // Doctor access: the baby's notes (synced, soft deleted; private ones are only ever the user's own).
    version: 6,
    stores: {
      notes: 'id, babyId, [babyId+updatedAt]',
    },
  },
  {
    // Doctor access step 2: the Doctor's prescription proposals (synced; only the author's and,
    // for parents, every one of the baby) and the user's first reads of shared notes (inbox).
    version: 7,
    stores: {
      proposals: 'id, babyId, [babyId+updatedAt]',
      noteReads: 'noteId, babyId',
    },
  },
  {
    // Vaccines: the baby's vaccination records (synced like prescriptions, soft deleted) and the
    // schedule served by the API, cached for offline use (one row per profile, not per baby).
    version: 8,
    stores: {
      vaccinations: 'id, babyId, [babyId+givenOn], [babyId+updatedAt]',
      vaccineSchedules: 'profile',
    },
  },
  {
    // Care providers: the baby's directory "My doctors" (synced like formulas, soft deleted).
    version: 9,
    stores: {
      careProviders: 'id, babyId, [babyId+updatedAt]',
    },
  },
];

export class BabyRoutineDb extends Dexie {
  declare babies: EntityTable<Baby, 'id'>;
  declare eventTypes: EntityTable<EventType, 'id'>;
  declare medications: EntityTable<Medication, 'id'>;
  declare events: EntityTable<BabyEvent, 'id'>;
  declare prescriptions: EntityTable<Prescription, 'id'>;
  declare catalogProducts: EntityTable<CachedProduct, 'id'>;
  declare bodyWeights: EntityTable<BodyWeightRow, 'babyId'>;
  declare formulas: EntityTable<Formula, 'id'>;
  declare appointments: EntityTable<Appointment, 'id'>;
  declare careProviders: EntityTable<CareProvider, 'id'>;
  declare notes: EntityTable<Note, 'id'>;
  declare proposals: EntityTable<Proposal, 'id'>;
  declare noteReads: EntityTable<NoteRead, 'noteId'>;
  declare vaccinations: EntityTable<Vaccination, 'id'>;
  declare vaccineSchedules: EntityTable<VaccineScheduleCache, 'profile'>;
  declare outbox: EntityTable<OutboxMutation, 'id'>;
  declare syncState: Table<SyncCursor, [string, SyncEntity]>;

  /** `name` is per account (see session/accountDatabase.ts); there is no shared default store. */
  constructor(name: string) {
    super(name);
    for (const { version, stores, upgrade } of SCHEMA_VERSIONS) {
      const definition = this.version(version).stores(stores);
      if (upgrade) definition.upgrade(upgrade);
    }
  }
}

export function createDatabase(name: string): BabyRoutineDb {
  return new BabyRoutineDb(name);
}
