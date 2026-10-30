import { flOzToMl, mlToFlOz, roundDisplay } from './convert';
import type { UnitSystem } from './system';

/** US volume presets sit on half fluid ounces. */
const US_PRESET_GRID_OZ = 0.5;

/** The preset volume nearest to `ml` for the system: itself in metric, the nearest half fl oz (as whole ml) in US. */
export function snapVolume(ml: number, system: UnitSystem): number {
  if (system !== 'us') return ml;
  const oz = roundDisplay(Math.round(mlToFlOz(ml) / US_PRESET_GRID_OZ) * US_PRESET_GRID_OZ, 2);
  return flOzToMl(oz);
}

/**
 * Volume presets (canonical ml, ascending, distinct, positive) for the system: the given ones in
 * metric; in US each snapped to a half fluid ounce, so a chip reads "4 fl oz" and stores 118 ml.
 */
export function volumePresets(amountsMl: readonly number[], system: UnitSystem): number[] {
  const snapped = amountsMl.map((ml) => snapVolume(ml, system)).filter((ml) => ml > 0);
  return [...new Set(snapped)].sort((a, b) => a - b);
}
