/*
 * The notification shown for a push (docs/design/09-push-notifications.md section 10): title and
 * body from the catalog, `tag` = the item's base key so a snooze re-send replaces the earlier
 * notification, `renotify` only for snooze re-sends, Snooze/Open actions for doses with a token.
 * No requireInteraction, no silent, no image.
 */
import { toWirePayload, type ParsedPayload, type PushPayload } from './payload';
import { actionTitles, renderText } from './notificationText';

export const NOTIFICATION_ICON = '/icon-192.png';
export const NOTIFICATION_BADGE = '/icon-monochrome-512.png';

export const ACTION_SNOOZE = 'snooze';
export const ACTION_OPEN = 'open';

/** `NotificationOptions` plus the fields lib.dom does not type everywhere (actions, renotify, timestamp). */
export interface ShownNotificationOptions extends NotificationOptions {
  actions?: { action: string; title: string }[];
  renotify?: boolean;
  timestamp?: number;
}

export interface ShownNotification {
  title: string;
  options: ShownNotificationOptions;
}

const compactGuid = (id: string) => id.replace(/-/g, '');

/** `yyyyMMddHHmm` in UTC, as the server's base keys. */
export function keyInstant(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

/**
 * The device tag: the server's base key where the payload carries its parts (`dose:{rx}:{slot}`,
 * `test:{id}`). The nap key's anchor is not sent, so a nap notification uses `nap:{baby}`
 * (one awake window per baby at a time; a newer window replaces the older one).
 */
export function notificationTag(payload: PushPayload): string {
  switch (payload.kind) {
    case 'dose_due':
      return `dose:${compactGuid(payload.rxId)}:${keyInstant(payload.at)}`;
    case 'nap_window':
      return `nap:${compactGuid(payload.babyId)}`;
    case 'test':
      return `test:${compactGuid(payload.id)}`;
  }
}

/** Builds the notification for a parsed payload; generic text without tag or actions when invalid. */
export function buildNotification(parsed: ParsedPayload, timeZone?: string): ShownNotification {
  const { title, body } = renderText(parsed, timeZone);
  const lang = parsed.ok ? parsed.payload.lang : parsed.lang;
  const options: ShownNotificationOptions = {
    body,
    lang,
    dir: 'auto',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
  };
  if (!parsed.ok) return { title, options };

  const { payload } = parsed;
  options.tag = notificationTag(payload);
  options.renotify = payload.snooze !== undefined;
  options.timestamp = payload.at;
  options.data = toWirePayload(payload);
  if (payload.kind === 'dose_due' && payload.token !== undefined) {
    const titles = actionTitles(lang);
    options.actions = [
      { action: ACTION_SNOOZE, title: titles.snooze },
      { action: ACTION_OPEN, title: titles.open },
    ];
  }
  return { title, options };
}
