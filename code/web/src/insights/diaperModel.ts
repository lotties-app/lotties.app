import type { BabyEvent, EventType } from '../db/models';
import { payloadString, typeIdsForKey } from '../now/eventFacts';
import { completedDaysWithData, dayKeyOf, mean, type LocalDay } from './days';

/*
 * Diaper insights, pure: changes per local day, with wet and dirty counts read from the built-in
 * `content` field (WET, DIRTY, MIXED; docs/design/04-insights-delight.md: wet = WET + MIXED,
 * dirty = DIRTY + MIXED, so a mixed diaper counts in both).
 */

export interface DiaperDay {
  key: string;
  start: Date;
  total: number;
  wet: number;
  dirty: number;
}

export interface DiaperSummary {
  perDay: number | null;
  wetPerDay: number | null;
  dirtyPerDay: number | null;
  /** Whether any diaper in the range says what it held (otherwise only totals are shown). */
  hasContent: boolean;
}

function contentOf(event: BabyEvent): 'wet' | 'dirty' | 'mixed' | null {
  const raw = payloadString(event, 'content')?.toUpperCase();
  if (raw === 'WET') return 'wet';
  if (raw === 'DIRTY') return 'dirty';
  if (raw === 'MIXED') return 'mixed';
  return null;
}

export function diapersByDay(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
): DiaperDay[] {
  const ids = typeIdsForKey(types, 'diaper');
  const byKey = new Map(
    days.map((day) => [day.key, { key: day.key, start: day.start, total: 0, wet: 0, dirty: 0 }]),
  );
  const nowIso = now.toISOString();
  for (const event of events) {
    if (event.deletedAt !== null || !ids.has(event.typeId) || event.startedAt > nowIso) continue;
    const day = byKey.get(dayKeyOf(event.startedAt));
    if (!day) continue;
    day.total += 1;
    const content = contentOf(event);
    if (content === 'wet' || content === 'mixed') day.wet += 1;
    if (content === 'dirty' || content === 'mixed') day.dirty += 1;
  }
  return [...byKey.values()];
}

export function diaperSummary(days: readonly DiaperDay[], todayKey: string): DiaperSummary {
  const counted = completedDaysWithData(days, (d) => d.total > 0, todayKey);
  return {
    perDay: mean(counted.map((d) => d.total)),
    wetPerDay: mean(counted.map((d) => d.wet)),
    dirtyPerDay: mean(counted.map((d) => d.dirty)),
    hasContent: days.some((d) => d.wet + d.dirty > 0),
  };
}
