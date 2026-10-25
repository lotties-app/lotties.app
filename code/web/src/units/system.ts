/** What a person chose: follow the device's region, or force one system. */
export type UnitSetting = 'auto' | 'metric' | 'us';
/** What is actually used once `auto` is resolved. */
export type UnitSystem = 'metric' | 'us';

export const UNIT_SETTINGS = ['auto', 'metric', 'us'] as const satisfies readonly UnitSetting[];

export function isUnitSetting(value: unknown): value is UnitSetting {
  return value === 'auto' || value === 'metric' || value === 'us';
}

/** Regions that use US customary units: the United States, Liberia and Myanmar. */
const US_REGIONS = new Set(['US', 'LR', 'MM']);

/** The region subtag of a BCP 47 tag (`en-US` -> `US`), or `null` when there is none. */
function regionOf(tag: string): string | null {
  const parts = tag.split(/[-_]/).slice(1);
  const region = parts.find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  return region ? region.toUpperCase() : null;
}

/**
 * `auto` follows the device locale tag (not the UI language): a region of US, LR or MM is US
 * customary, anything else (or no region) is metric. A forced system is returned as it is.
 */
export function resolveUnitSystem(setting: UnitSetting, localeTag: string): UnitSystem {
  if (setting === 'metric' || setting === 'us') return setting;
  const region = regionOf(localeTag.trim());
  return region !== null && US_REGIONS.has(region) ? 'us' : 'metric';
}

export function deviceLocaleTag(): string {
  return typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
}
