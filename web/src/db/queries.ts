import Dexie from 'dexie';
import type { BabyRoutineDb } from './database';
import type { Baby, BabyEvent, EventType, Medication } from './models';

/** Live (not deleted) events of a baby with `from <= startedAt < to`, oldest first. */
export function eventsInRange(
  db: BabyRoutineDb,
  babyId: string,
  from: string,
  to: string,
): Promise<BabyEvent[]> {
  return db.events
    .where('[babyId+startedAt]')
    .between([babyId, from], [babyId, to], true, false)
    .filter((e) => e.deletedAt === null)
    .toArray();
}

/** Live events of a baby with `startedAt >= from` (UTC ISO), newest first. */
export function eventsStartedSince(
  db: BabyRoutineDb,
  babyId: string,
  from: string,
): Promise<BabyEvent[]> {
  return db.events
    .where('[babyId+startedAt]')
    .between([babyId, from], [babyId, Dexie.maxKey])
    .reverse()
    .filter((e) => e.deletedAt === null)
    .toArray();
}

/** `startedAt` of the baby's oldest live event, or `undefined` when there is none. */
export async function oldestEventStart(
  db: BabyRoutineDb,
  babyId: string,
): Promise<string | undefined> {
  const oldest = await db.events
    .where('[babyId+startedAt]')
    .between([babyId, Dexie.minKey], [babyId, Dexie.maxKey])
    .filter((e) => e.deletedAt === null)
    .first();
  return oldest?.startedAt;
}

export type EntitySyncState = 'pending' | 'dead';

/**
 * Outbox state per entity id of a baby: `dead` when any of its mutations was rejected, else
 * `pending` while any is queued. Entities without outbox entries are absent (synced).
 */
export async function entitySyncStates(
  db: BabyRoutineDb,
  babyId: string,
): Promise<Map<string, EntitySyncState>> {
  const states = new Map<string, EntitySyncState>();
  for (const m of await db.outbox.where('babyId').equals(babyId).toArray()) {
    if (states.get(m.entityId) !== 'dead') states.set(m.entityId, m.status);
  }
  return states;
}

/** Running timers (no `endedAt`) of a baby, oldest first. */
export function runningEvents(db: BabyRoutineDb, babyId: string): Promise<BabyEvent[]> {
  return db.events
    .where('[babyId+startedAt]')
    .between([babyId, Dexie.minKey], [babyId, Dexie.maxKey])
    .filter((e) => e.deletedAt === null && e.endedAt === null)
    .toArray();
}

export async function liveEvent(db: BabyRoutineDb, id: string): Promise<BabyEvent | undefined> {
  const event = await db.events.get(id);
  return event && !event.deletedAt ? event : undefined;
}

export async function allBabies(db: BabyRoutineDb): Promise<Baby[]> {
  const list = await db.babies.toArray();
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Built-in templates plus the baby's custom types. */
export function eventTypesFor(db: BabyRoutineDb, babyId: string): Promise<EventType[]> {
  return db.eventTypes.filter((t) => t.babyId === null || t.babyId === babyId).toArray();
}

/** The baby's medication catalog, usual ones first, then by name. */
export async function medicationsFor(db: BabyRoutineDb, babyId: string): Promise<Medication[]> {
  const list = await db.medications.where('babyId').equals(babyId).toArray();
  return list.sort((a, b) => Number(b.isUsual) - Number(a.isUsual) || a.name.localeCompare(b.name));
}
