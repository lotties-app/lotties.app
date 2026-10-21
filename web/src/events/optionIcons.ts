import type { EventFieldDefinition, EventType } from '../db/models';
import type { IconName } from '../ui/icons';

/*
 * Icons of the options of the built-in event types (breast, bottle, left, wet, nap ...). Keyed by
 * type key, field key and lower-case option, in a Map chain so a server-provided key such as
 * `constructor` never resolves to an inherited member. Anything else has no icon (text only).
 */

const OPTION_ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>(
  Object.entries({
    'feeding.method.breast': 'heart',
    'feeding.method.bottle': 'bottle',
    'feeding.method.solid': 'utensils',
    'feeding.side.left': 'arrow-left',
    'feeding.side.right': 'arrow-right',
    'feeding.side.both': 'arrows-horizontal',
    'feeding.bottle_feeding_type.formula': 'bottle',
    'feeding.bottle_feeding_type.breast_milk': 'heart',
    'diaper.content.wet': 'droplet',
    'diaper.content.dirty': 'poo',
    'diaper.content.mixed': 'droplet-half',
    'sleep.kind.nap': 'zzz',
    'sleep.kind.night': 'moon',
    'sleep.kind.night_waking': 'eye',
    'sleep.kind.bed_time': 'moon-stars',
    'sleep.kind.woke_up': 'sun',
    'sleep.kind.fell_asleep': 'bed',
  } satisfies Record<string, IconName>),
);

/** Icon of a select option of a built-in type, or `undefined`. */
export function optionIcon(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  field: Pick<EventFieldDefinition, 'key'>,
  option: string,
): IconName | undefined {
  if (!type || type.babyId !== null) return undefined;
  return OPTION_ICONS.get(`${type.key}.${field.key}.${option.toLowerCase()}`);
}
