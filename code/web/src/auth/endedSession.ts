/**
 * Remembers, across a reload, that the last session ended because its refresh token was rejected,
 * and which local database (name only, never the raw subject) it left behind. The sign-in page uses
 * it to explain why sign-in is needed and how many unsynced changes are waiting on this device.
 * The database itself is kept: its queue syncs once the same account signs in again.
 */
const KEY = 'baby-routine.ended-session';

export function rememberEndedSession(databaseName: string | null): void {
  try {
    window.localStorage.setItem(KEY, databaseName ?? '');
  } catch {
    // Storage unavailable: the sign-in page shows the generic button only.
  }
}

/** `undefined` when no session ended; `null` when it ended without a known database. */
export function readEndedSession(): string | null | undefined {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === null) return undefined;
    return value || null;
  } catch {
    return undefined;
  }
}

export function forgetEndedSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}
