/*
 * Invite token hand-off. The token arrives in the URL fragment (`/invite#<token>`), is moved out of
 * the address bar at once, and is parked in sessionStorage while a sign-in round trip runs (the
 * login redirect state must not carry it). Storage can be unavailable (private mode, blocked site
 * data): every access is guarded and the page then reports the invite as not valid.
 */

export const PENDING_INVITE_KEY = 'baby-routine.pending-invite';

/** The invite route path, without any token. */
export const INVITE_PATH = '/invite';

/** Token from a fragment such as `#abc` (or `''` when absent). */
export function tokenFromHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function stashPendingInvite(token: string): void {
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Storage unavailable: the user can open the link again after signing in.
  }
}

/** Returns the parked token and deletes it, so it is used once. */
export function takePendingInvite(): string | null {
  try {
    const token = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
    return token || null;
  } catch {
    return null;
  }
}

/** Replaces the current history entry with `/invite` (no token in the address bar). */
export function scrubInviteUrl(): void {
  try {
    window.history.replaceState(window.history.state, '', INVITE_PATH);
  } catch {
    // History API unavailable: nothing else to do.
  }
}
