const KEY_PREFIX = 'baby-routine.time-bottles.';

/*
 * The "Time bottle feedings" setting (docs/design/20-feeding-amounts.md): per baby and per device,
 * kept in localStorage like the pinned presets (`pinnedStorage.ts`). Off by default: the bottle
 * quick action then logs the feeding right away (start = end = now) and asks the amounts; on, a
 * bottle runs as a timer like nursing. Nursing always has its timer.
 */

/** Whether bottle feedings run as timers for this baby on this device (default: no). */
export function loadTimeBottles(babyId: string): boolean {
  try {
    return window.localStorage.getItem(KEY_PREFIX + babyId) === 'on';
  } catch {
    return false;
  }
}

export function storeTimeBottles(babyId: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY_PREFIX + babyId, 'on');
    else window.localStorage.removeItem(KEY_PREFIX + babyId);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/** Forgets the setting of one baby (the baby left this device). */
export function clearTimeBottles(babyId: string): void {
  storeTimeBottles(babyId, false);
}

/** Forgets every baby's setting (sign-out, account switch). */
export function clearAllTimeBottles(): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
