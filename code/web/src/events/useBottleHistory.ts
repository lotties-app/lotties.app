import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import { useEventsStartedSince } from '../db/hooks';
import type { BabyEvent, EventType } from '../db/models';
import { bottleSuggestions, HISTORY_DAYS, type BottleSuggestions } from './bottleSuggestions';
import { useNow } from './time';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface BottleHistory {
  /** The baby's live events of the last `HISTORY_DAYS` (any type), newest first. */
  events: readonly BabyEvent[];
  /** The baby's birth date, when the baby is stored locally. */
  birthDate: string | null;
  /** The clock the window was read at (moves every minute). */
  now: Date;
}

/**
 * What the bottle suggestions read, from the local store (live: chips follow new bottles): the
 * last 30 days of events and the baby's birth date. `undefined` while loading.
 */
export function useBottleHistory(babyId: string): BottleHistory | undefined {
  const db = useDatabase();
  const tick = useNow(MINUTE_MS);
  // Rounded to the hour so the query changes once an hour, not every minute.
  const since = new Date(
    Math.floor((tick - HISTORY_DAYS * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS,
  ).toISOString();
  const events = useEventsStartedSince(babyId, since);
  const baby = useLiveQuery(async () => (await db.babies.get(babyId)) ?? null, [db, babyId]);
  return useMemo(
    () =>
      events === undefined || baby === undefined
        ? undefined
        : { events, birthDate: baby?.birthDate ?? null, now: new Date(tick) },
    [events, baby, tick],
  );
}

/**
 * The bottle chips of the event sheet: only for the feeding type with an `amount_ml` field;
 * `include` (the remembered amount) is always one of them.
 */
export function useBottleSuggestions(
  babyId: string,
  type: EventType | undefined,
  include: number | null,
): BottleSuggestions | undefined {
  const history = useBottleHistory(babyId);
  const field =
    type?.key === 'feeding' ? type.fields.find((f) => f.key === 'amount_ml') : undefined;
  return useMemo(() => {
    if (!history || !type || !field) return undefined;
    return bottleSuggestions({
      events: history.events,
      feedingTypeId: type.id,
      birthDate: history.birthDate,
      now: history.now,
      min: field.min,
      max: field.max,
      include,
    });
  }, [history, type, field, include]);
}
