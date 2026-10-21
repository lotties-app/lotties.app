import { forgetSelectedBaby } from '../baby/selectedBabyStorage';
import { clearAllLastUsed } from '../events/lastUsedValues';
import { clearAllCachedPredictions } from '../predictions/predictionsCache';
import { clearAllPinned } from '../presets/pinnedStorage';

/** Which account (its database name, not the raw subject) the entries below belong to. */
const ACCOUNT_KEY = 'baby-routine.account';

/**
 * Removes the account's localStorage entries: the selected baby, the cached predictions, the pinned
 * presets and the remembered field values (all keyed by baby). Device preferences such as the
 * theme are kept.
 */
export function clearAccountDeviceState(): void {
  forgetSelectedBaby();
  clearAllCachedPredictions();
  clearAllPinned();
  clearAllLastUsed();
  try {
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

/**
 * Records `owner` (the account's database name) as the owner of the per-account localStorage entries, clearing them first
 * when they belong to another account (a different user signed in without signing out) or to an
 * unknown one (saved before this marker existed). Idempotent.
 */
export function claimDeviceState(owner: string): void {
  try {
    if (window.localStorage.getItem(ACCOUNT_KEY) === owner) return;
    clearAccountDeviceState();
    window.localStorage.setItem(ACCOUNT_KEY, owner);
  } catch {
    // Storage unavailable: there is no saved state to protect.
  }
}
