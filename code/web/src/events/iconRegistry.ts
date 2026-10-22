import type { IconName } from '../ui/icons';

/**
 * Icon names stored on event types (the API allowlist, `EventTypeIcons.cs`, Material names) to the
 * Tabler icon that draws them. A Map, so a server-provided name such as `constructor` never
 * resolves to an inherited object member. Unknown names get a fallback (`eventTypeIconName`).
 */
export const ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>(
  Object.entries({
    local_drink: 'bottle',
    bedtime: 'moon',
    baby_changing_station: 'diaper',
    bathtub: 'bath',
    child_care: 'mood-kid',
    medication: 'pill',
    sick: 'mood-sad',
    restaurant: 'utensils',
    favorite: 'heart',
    star: 'star',
    water_drop: 'droplet-half',
    opacity: 'droplet',
    toys: 'toy',
    directions_walk: 'walk',
    thermostat: 'thermometer',
    vaccines: 'vaccine',
    cake: 'cake',
    air: 'wind',
    massage: 'massage',
    sentiment_very_dissatisfied: 'mood-cry',
    content_cut: 'scissors',
    sentiment_sick: 'mood-sick',
    dentistry: 'tooth',
    emoji_events: 'trophy',
    coronavirus: 'virus',
    park: 'trees',
    sanitizer: 'lotion',
  } satisfies Record<string, IconName>),
);

/** Icon names an event type may use (the custom event type picker offers exactly these). */
export const EVENT_ICON_NAMES: readonly string[] = [...ICONS.keys()];

/** The Tabler icon of a stored event type icon name; a generic event glyph when unknown. */
export function eventTypeIconName(name: string): IconName {
  return ICONS.get(name) ?? 'event';
}
