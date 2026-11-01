const KEY = 'baby-routine.time-bottles';
/** Keys of the first version, which stored the setting per baby (`<prefix><babyId>`). */
const LEGACY_PREFIX = 'baby-routine.time-bottles.';

/*
 * The "Time bottle feedings" setting (docs/design/20-feeding-amounts.md): a preference of the
 * signed-in account, one value for all its babies, kept in the account's localStorage entries
 * (cleared on sign-out and on an account switch by `session/deviceState.ts`, like the pinned
 * presets). Off by default: the bottle quick action then logs the feeding right away
 * (start = end = now) and asks the amounts; on, a bottle runs as a timer like nursing. Nursing
 * always has its timer.
 */

/** Folds the per-baby keys of the first version into the account value: any baby on turns it on. */
function migrateLegacy(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  const legacy = keys.filter((key): key is string => !!key?.startsWith(LEGACY_PREFIX));
  if (legacy.length === 0) return;
  if (legacy.some((key) => storage.getItem(key) === 'on')) storage.setItem(KEY, 'on');
  for (const key of legacy) storage.removeItem(key);
}

/** Whether bottle feedings run as timers for this account (default: no). */
export function loadTimeBottles(): boolean {
  try {
    const storage = window.localStorage;
    migrateLegacy(storage);
    return storage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function storeTimeBottles(on: boolean): void {
  try {
    const storage = window.localStorage;
    migrateLegacy(storage);
    if (on) storage.setItem(KEY, 'on');
    else storage.removeItem(KEY);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/** Forgets the setting and any per-baby leftover (sign-out, account switch). */
export function clearTimeBottles(): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (key === KEY || key?.startsWith(LEGACY_PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
