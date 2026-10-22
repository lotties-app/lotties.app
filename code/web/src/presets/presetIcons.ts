import { ICONS } from '../events/iconRegistry';
import type { IconName } from '../ui/icons';
import type { Preset } from './types';

/**
 * Icons of the built-in presets (Tabler). A Map, so a server-provided icon name such as
 * `constructor` never resolves to an inherited member. Kept apart from `events/iconRegistry.ts`,
 * which mirrors the icon names the API accepts for event types. Tabler has no breast glyph, so
 * nursing uses the heart until an in-house glyph exists.
 */
const PRESET_ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>(
  Object.entries({
    wake_up: 'sun',
    nap: 'zzz',
    bedtime: 'moon-stars',
    fell_asleep: 'bed',
    night_waking: 'eye',
    bottle: 'bottle',
    nursing: 'heart',
    pumping: 'droplet',
    diaper: 'diaper',
    medication: 'pill',
    belly_pain: 'mood-sad',
    nasal_suction: 'wind',
    belly_massage: 'massage',
    bath: 'bath',
    fussy: 'mood-cry',
    tummy_time: 'mood-kid',
    custom: 'add',
  } satisfies Record<string, IconName>),
);

/** Icon of a preset: built-in preset icon, else event type icon, else a fallback. */
export function presetIcon(preset: Pick<Preset, 'icon' | 'builtIn'>): IconName {
  const own = preset.builtIn ? PRESET_ICONS.get(preset.icon) : ICONS.get(preset.icon);
  return own ?? 'event';
}
