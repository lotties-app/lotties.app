import { deviceLocaleTag, resolveUnitSystem, type UnitSetting, type UnitSystem } from './system';

/*
 * The unit setting of the signed-in account as plain module state, like the active language
 * (`currentLocale`): text builders that are not React components (`tileText`, `payloadSummary`,
 * `formatUnit`) read the resolved system from here, and `UnitsProvider` remounts the app below it
 * when the resolved system changes so every screen redraws.
 */

let setting: UnitSetting = 'auto';
let localeTag: string | null = null;
const listeners = new Set<() => void>();

export const getUnitSetting = (): UnitSetting => setting;

/** The device locale tag the `auto` setting resolves from (`navigator.language`). */
const tag = () => localeTag ?? deviceLocaleTag();

/** The system in use right now. */
export const currentUnitSystem = (): UnitSystem => resolveUnitSystem(setting, tag());

export function setUnitSetting(next: UnitSetting): void {
  if (next === setting) return;
  setting = next;
  for (const listener of [...listeners]) listener();
}

/** Tests: pretend the device reports this locale tag (`null`: ask the browser again). */
export function setDeviceLocaleTag(next: string | null): void {
  localeTag = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeUnits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
