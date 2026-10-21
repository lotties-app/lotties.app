import type { BabyEvent, Dosage, EventType } from '../db/models';
import type { MemberDto } from '../sync/contract';
import { effectiveDurationSeconds } from '../timers/pauseMath';
import { getOwn } from '../util/ownProperty';
import {
  payloadNumber,
  payloadString,
  payloadValue,
  sleepSessionKind,
  isSleepKind,
  typeIdsForKey,
} from './eventFacts';

/*
 * Hand-over catch-up (docs/design/01-ux-strategy.md flow 3): what other caregivers logged since this
 * device last showed the baby, grouped by who logged it. Logic only; the card is wave 3b.
 *
 * Who: `createdBy` is the server user id, set once the event came back through sync (a local event
 * not yet synced has `null`, and is this device's own). Display names come only from
 * `GET /babies/{id}/members` (`displayName`); without that list (offline, not loaded) or for a user
 * no longer a member, `name` is `null` and the UI says "Someone" (see `catchUpName`).
 * The client does not know its own server user id; events this account logged on another device
 * are listed too unless `selfUserId` is given.
 */

export type CatchUpMember = Pick<MemberDto, 'userId' | 'displayName'>;

export interface CatchUpMedication {
  name: string;
  dose?: Dosage;
  at: string;
  /**
   * When the next dose is allowed. Always `null`: medications have no minimum interval yet.
   * TODO(SYNTHESIS.md wave 6, "medicine intervals (API: min interval per medication)"): compute
   * `at + minInterval` once the catalog carries the interval.
   */
  nextAllowedAt: string | null;
}

export interface CatchUpGroup {
  userId: string;
  /** Display name from the members list; `null` when unknown ("Someone"). */
  name: string | null;
  /** Everything this person logged in the period. */
  count: number;
  lastAt: string;
  sleep: { count: number; totalMinutes: number; nightWakings: number };
  feeds: { count: number; totalMl: number; lastAt: string | null };
  diapers: { count: number; wet: number; dirty: number; mixed: number };
  medications: CatchUpMedication[];
  /** Other event types, by type id. */
  other: { typeId: string; count: number }[];
}

export interface CatchUp {
  /** Start of the period: when this device last showed the baby. */
  since: string;
  groups: CatchUpGroup[];
  /** Events in all groups. */
  total: number;
}

export interface CatchUpContext {
  types: readonly EventType[];
  /** This account's server user id, when known: its events are not listed. */
  selfUserId?: string | null;
}

function emptyGroup(userId: string, name: string | null, lastAt: string): CatchUpGroup {
  return {
    userId,
    name,
    count: 0,
    lastAt,
    sleep: { count: 0, totalMinutes: 0, nightWakings: 0 },
    feeds: { count: 0, totalMl: 0, lastAt: null },
    diapers: { count: 0, wet: 0, dirty: 0, mixed: 0 },
    medications: [],
    other: [],
  };
}

function medicationsOf(event: BabyEvent): CatchUpMedication[] {
  const list = payloadValue(event, 'medications');
  if (!Array.isArray(list)) return [];
  const result: CatchUpMedication[] = [];
  for (const raw of list as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const name = getOwn(entry, 'name');
    if (typeof name !== 'string') continue;
    const dose = getOwn(entry, 'dose') as Partial<Dosage> | undefined;
    const valid = typeof dose?.amount === 'number' && typeof dose.unit === 'string';
    result.push({
      name,
      ...(valid ? { dose: { amount: dose.amount as number, unit: dose.unit as string } } : {}),
      at: event.startedAt,
      nextAllowedAt: null,
    });
  }
  return result;
}

interface TypeIds {
  sleep: Set<string>;
  feeding: Set<string>;
  diaper: Set<string>;
  medication: Set<string>;
}

function addEvent(group: CatchUpGroup, event: BabyEvent, ids: TypeIds, now: Date) {
  group.count += 1;
  if (event.startedAt > group.lastAt) group.lastAt = event.startedAt;
  if (ids.sleep.has(event.typeId)) {
    if (isSleepKind(event, 'night_waking')) group.sleep.nightWakings += 1;
    else if (sleepSessionKind(event) !== null) {
      group.sleep.count += 1;
      group.sleep.totalMinutes += Math.round(effectiveDurationSeconds(event, now) / 60);
    }
  } else if (ids.feeding.has(event.typeId)) {
    group.feeds.count += 1;
    group.feeds.totalMl += payloadNumber(event, 'amount_ml') ?? 0;
    if (!group.feeds.lastAt || event.startedAt > group.feeds.lastAt) {
      group.feeds.lastAt = event.startedAt;
    }
  } else if (ids.diaper.has(event.typeId)) {
    group.diapers.count += 1;
    const content = payloadString(event, 'content')?.toUpperCase();
    if (content === 'WET') group.diapers.wet += 1;
    else if (content === 'DIRTY') group.diapers.dirty += 1;
    else if (content === 'MIXED') group.diapers.mixed += 1;
  } else if (ids.medication.has(event.typeId)) {
    group.medications.push(...medicationsOf(event));
  } else {
    const other = group.other.find((o) => o.typeId === event.typeId);
    if (other) other.count += 1;
    else group.other.push({ typeId: event.typeId, count: 1 });
  }
}

/**
 * What others logged since `sinceLastOpen` (an event counts when it was created, on its device's
 * clock, after that time and not after `now`): live, synced (`createdBy` set) events of anyone but
 * `selfUserId`, grouped by `createdBy`, the most recent group first. `null` on the first open
 * (no `sinceLastOpen`) or when nothing was logged by others.
 */
export function catchUp(
  events: readonly BabyEvent[],
  users: readonly CatchUpMember[] | undefined,
  sinceLastOpen: string | null,
  now: Date,
  context: CatchUpContext,
): CatchUp | null {
  if (!sinceLastOpen) return null;
  const nowIso = now.toISOString();
  const ids: TypeIds = {
    sleep: typeIdsForKey(context.types, 'sleep'),
    feeding: typeIdsForKey(context.types, 'feeding'),
    diaper: typeIdsForKey(context.types, 'diaper'),
    medication: typeIdsForKey(context.types, 'medication'),
  };
  const names = new Map((users ?? []).map((u) => [u.userId, u.displayName?.trim() || null]));
  const groups = new Map<string, CatchUpGroup>();
  const relevant = events
    .filter(
      (e) =>
        e.deletedAt === null &&
        e.createdBy !== null &&
        e.createdBy !== context.selfUserId &&
        e.createdAt > sinceLastOpen &&
        e.createdAt <= nowIso,
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const event of relevant) {
    const userId = event.createdBy as string;
    let group = groups.get(userId);
    if (!group) {
      group = emptyGroup(userId, names.get(userId) ?? null, event.startedAt);
      groups.set(userId, group);
    }
    addEvent(group, event, ids, now);
  }
  if (groups.size === 0) return null;
  const sorted = [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { since: sinceLastOpen, groups: sorted, total: relevant.length };
}
