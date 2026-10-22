import type { EventType } from '../db/models';
import { eventTypeIconName } from '../events/iconRegistry';
import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';

/*
 * How an event type looks on Now: a category (tinted circle) and an icon. The built-in keys map to
 * the design categories; custom types are "custom". Server colours are never used for the tint.
 */

const CATEGORY_OF_KEY: ReadonlyMap<string, CategoryName> = new Map<string, CategoryName>([
  ['sleep', 'sleep'],
  ['feeding', 'feeding'],
  ['breast_pump', 'feeding'],
  ['diaper', 'diaper'],
  ['medication', 'health'],
  ['belly_pain', 'health'],
  ['nasal_suction', 'health'],
  ['belly_massage', 'health'],
  ['bath', 'care'],
  // Soothing a crying baby is care, not a symptom or a medicine (docs/design/11-patterns.md).
  ['fussy', 'care'],
  ['tummy_time', 'activity'],
]);

export function typeCategory(type: Pick<EventType, 'key' | 'babyId'> | undefined): CategoryName {
  if (!type || type.babyId !== null) return 'custom';
  return CATEGORY_OF_KEY.get(type.key) ?? 'custom';
}

export function typeIcon(type: Pick<EventType, 'icon'> | undefined): IconName {
  return type ? eventTypeIconName(type.icon) : 'event';
}
