import { catalogText } from '../i18n/catalog';
import type { Preset } from './types';

/**
 * Display name of a preset: built-ins come from the catalog (`presets.<id>`), custom event types
 * keep the name the user gave them.
 */
export function presetLabel(preset: Pick<Preset, 'id' | 'label' | 'builtIn'>): string {
  return (preset.builtIn ? catalogText('presets', preset.id) : undefined) ?? preset.label;
}
