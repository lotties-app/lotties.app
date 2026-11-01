import type { EventFieldDefinition, EventType } from '../db/models';
import { getOwn } from '../util/ownProperty';
import { visibleFields } from './payloadRules';

/** Which fields the "Sleep details" section holds, in display order (docs/design/SYNTHESIS.md 7). */
export const SLEEP_DETAIL_KEYS = [
  'fall_asleep',
  'time_to_fall_asleep_minutes',
  'how_slept',
  'how_woke',
  'mood_on_wake',
] as const;
export const SLEEP_DETAIL_SET: ReadonlySet<string> = new Set(SLEEP_DETAIL_KEYS);

export type DetailValues = Readonly<Record<string, string | boolean>>;

export const hasDetailValue = (raw: unknown) => raw !== undefined && raw !== '' && raw !== false;

/** The detail fields the built-in sleep type offers for these values (none for a marker or no kind). */
export function sleepDetailFields(
  type: EventType | undefined,
  values: DetailValues,
): EventFieldDefinition[] {
  if (!type || type.babyId !== null || type.key !== 'sleep') return [];
  const shown = visibleFields(type.fields, (key) => getOwn(values, key));
  return SLEEP_DETAIL_KEYS.flatMap((key) => {
    const field = shown.find((f) => f.key === key);
    return field && field.hidden !== true ? [field] : [];
  });
}
