/*
 * What a notification click does (docs/design/09-push-notifications.md sections 10 and 16): the
 * URL is built from the kind and validated GUIDs (deepLink.ts, shared with the app), never taken
 * from the payload.
 */
import { validatePayload, type PushPayload } from './payload';
import { ACTION_SNOOZE } from './notificationOptions';
import {
  DEEP_LINK_PATH,
  deepLinkUrl,
  linkOfPayload,
  openMessageOf,
  type NotificationOpenMessage,
} from './deepLink';

export type { NotificationOpenMessage } from './deepLink';

export type ClickTarget =
  | { type: 'snooze'; deliveryId: string; token: string }
  | { type: 'open'; path: string; message?: NotificationOpenMessage };

/** The same-origin path the app opens at (`/#notify=...` for doses and naps, `/` otherwise). */
export function deepLinkPath(payload: PushPayload): string {
  const link = linkOfPayload(payload);
  return link ? deepLinkUrl(link) : DEEP_LINK_PATH;
}

/**
 * The click outcome for a notification's `data` (re-validated: it may come from an older worker)
 * and the clicked `action` ('' for the body). Snooze needs a dose with a token; anything else opens.
 */
export function clickTarget(data: unknown, action: string): ClickTarget {
  const parsed = validatePayload(data);
  if (!parsed.ok) return { type: 'open', path: DEEP_LINK_PATH };
  const { payload } = parsed;
  if (action === ACTION_SNOOZE && payload.kind === 'dose_due' && payload.token !== undefined) {
    return { type: 'snooze', deliveryId: payload.id, token: payload.token };
  }
  const link = linkOfPayload(payload);
  return link
    ? { type: 'open', path: deepLinkUrl(link), message: openMessageOf(link) }
    : { type: 'open', path: DEEP_LINK_PATH };
}
