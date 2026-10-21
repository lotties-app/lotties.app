import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie';
import type {
  Baby,
  BabyEvent,
  EventType,
  Medication,
  OutboxMutation,
  SyncCursor,
  SyncEntity,
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
];

export class BabyRoutineDb extends Dexie {
  declare babies: EntityTable<Baby, 'id'>;
  declare eventTypes: EntityTable<EventType, 'id'>;
  declare medications: EntityTable<Medication, 'id'>;
  declare events: EntityTable<BabyEvent, 'id'>;
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
