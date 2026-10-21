import type { EventType } from '../db/models';
import { safeColor } from '../events/safeColor';
import { BUILT_IN_PRESETS, DEFAULT_PINNED } from './catalogue';
import { MAX_PINNED, type Preset } from './types';

/**
 * The presets available for a baby, in Track sheet order: built-ins whose event type exists (types
 * resolved by key among the built-in templates), then one preset per custom event type (by
 * name), then the "Custom" link tile. A built-in whose type is missing is omitted.
 */
export function presetsForBaby(eventTypes: readonly EventType[]): Preset[] {
  const builtInTypes = new Map<string, EventType>();
  for (const type of eventTypes) {
    if (type.babyId === null && !builtInTypes.has(type.key)) builtInTypes.set(type.key, type);
  }

  const result: Preset[] = [];
  let link: Preset | undefined;
  for (const def of BUILT_IN_PRESETS) {
    if (def.mode === 'link') {
      link = { ...def, typeId: null, builtIn: true };
      continue;
    }
    const type = builtInTypes.get(def.typeKey);
    if (type) result.push({ ...def, typeId: type.id, builtIn: true });
  }

  const customTypes = eventTypes
    .filter((t) => t.babyId !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const type of customTypes) result.push(customPreset(type));

  if (link) result.push(link);
  return result;
}

function customPreset(type: EventType): Preset {
  return {
    id: `type:${type.id}`,
    label: type.name,
    category: 'custom',
    icon: type.icon,
    typeKey: type.key,
    typeId: type.id,
    mode: type.hasDuration ? 'timer' : 'sheet',
    payloadDefaults: {},
    builtIn: false,
    customColor: safeColor(type.color),
  };
}

/** Presets that log an event (everything except link tiles). */
export function isTrackable(preset: Preset): preset is Preset & { typeId: string } {
  return preset.typeId !== null && preset.mode !== 'link';
}

/**
 * The Home shortcuts: the pinned ids that still resolve to a preset, in the pinned order, topped
 * up from the defaults and then the rest of the catalogue so four tiles show whenever possible.
 */
export function pinnedPresets(presets: readonly Preset[], pinnedIds: readonly string[]): Preset[] {
  const byId = new Map(presets.filter(isTrackable).map((p) => [p.id, p]));
  const result: Preset[] = [];
  const add = (id: string) => {
    const preset = byId.get(id);
    if (preset && result.length < MAX_PINNED && !result.includes(preset)) result.push(preset);
  };
  pinnedIds.forEach(add);
  DEFAULT_PINNED.forEach(add);
  byId.forEach((_, id) => add(id));
  return result;
}
