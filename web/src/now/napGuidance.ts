/*
 * The calm guidance line of the estimated nap sheet. Derived only from the prediction numbers (the
 * window and the typical length), never from a claim about what the baby needs: it names a clock
 * time to start winding down and nothing more.
 */

const MINUTE_MS = 60_000;
/** The suggested wind-down starts this long before the window opens. */
export const WIND_DOWN_LEAD_MINUTES = 15;

export type NapGuidance =
  { kind: 'windDown'; at: Date } | { kind: 'soon' } | { kind: 'open' } | { kind: 'past' };

export function napGuidance(window: { earliest: string; latest: string }, now: Date): NapGuidance {
  const earliest = Date.parse(window.earliest);
  const latest = Date.parse(window.latest);
  const nowMs = now.getTime();
  const windDownAt = earliest - WIND_DOWN_LEAD_MINUTES * MINUTE_MS;
  if (nowMs < windDownAt) return { kind: 'windDown', at: new Date(windDownAt) };
  if (nowMs < earliest) return { kind: 'soon' };
  if (nowMs <= latest) return { kind: 'open' };
  return { kind: 'past' };
}

const KEY_PREFIX = 'baby-routine.nap-skipped.';

/** Identifies one prediction: a new prediction has a new window, so it is not skipped. */
export const napWindowKey = (window: { earliest: string; latest: string }) =>
  `${window.earliest}|${window.latest}`;

/** The window the parent skipped for this baby, or `null`. */
export function readSkippedNap(babyId: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + babyId);
  } catch {
    return null;
  }
}

export function writeSkippedNap(babyId: string, key: string | null): void {
  try {
    if (key === null) window.localStorage.removeItem(KEY_PREFIX + babyId);
    else window.localStorage.setItem(KEY_PREFIX + babyId, key);
  } catch {
    // Storage unavailable: the skip lasts until the page reloads.
  }
}
