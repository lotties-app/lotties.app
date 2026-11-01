const DAY_MS = 86_400_000;

/** From this many days without a log the card says so (an informational flag, not an alarm). */
export const QUIET_AFTER_DAYS = 3;

/**
 * Days since the last log, rounded like "Last log 5 days ago", when that is at least
 * `QUIET_AFTER_DAYS`, else `null`.
 */
export function quietDays(lastEventAt: string | null, now: number): number | null {
  if (!lastEventAt) return null;
  const days = Math.round((now - Date.parse(lastEventAt)) / DAY_MS);
  return days >= QUIET_AFTER_DAYS ? days : null;
}
