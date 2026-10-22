import { linkPath, parseDeepLinkHash } from '../pwa/sw/deepLink';
import type { SyncEngine } from '../sync/SyncEngine';

/* Helpers of the notification deep link in the app (NotificationLinkProvider.tsx). */

/** The pull before opening a reminder waits at most this long, then local data is shown. */
export const LINK_SYNC_WAIT_MS = 3_000;

/**
 * The link in the address bar, if any: `/#notify=...` on the Now route, or an appointment reminder's
 * `/appointments#notify=appt&...` on the calendar route.
 */
export function linkFromLocation(location: Pick<Location, 'pathname' | 'hash'>) {
  const link = parseDeepLinkHash(location.hash);
  return link && location.pathname === linkPath(link) ? link : null;
}

/** Removes `#notify=...` from the address bar (ids and token never stay in history). */
export function scrubNotificationHash(): void {
  try {
    if (window.location.hash.startsWith('#notify=')) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  } catch {
    // History API unavailable: nothing else to do.
  }
}

/** A sync pull bounded by `LINK_SYNC_WAIT_MS`; never rejects. */
export async function pullBriefly(
  engine: Pick<SyncEngine, 'syncNow'> | null,
  waitMs = LINK_SYNC_WAIT_MS,
): Promise<void> {
  if (!engine) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  try {
    await Promise.race([engine.syncNow().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
