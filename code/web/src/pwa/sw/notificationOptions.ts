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
 * (one awake window per baby at a time; a newer window replaces the older one); the belly pain
 * and fussy heads-ups use `belly:{baby}` and `fussy:{baby}` (at most one a day; the next day's
 * replaces it); the overtired heads-up uses `overtired:{baby}` (one per awake stretch; the next
 * stretch's replaces it); the diaper heads-ups use `wet:{baby}` and `dirty:{baby}` (the next
 * expected diaper of the kind replaces the earlier one); an appointment reminder uses
 * `appt:{appointment}` (its next reminder, "in 2 hours" after "tomorrow", replaces the earlier one);
 * a doctor suggestion uses `doctor:{proposal or note}` (one notification per suggestion, only Open);
 * a vaccine reminder uses `vaccine:{baby}:{dose}` (one per dose, only Open: nothing to snooze).
 */
export function notificationTag(payload: PushPayload): string {
  switch (payload.kind) {
    case 'dose_due':
      return `dose:${compactGuid(payload.rxId)}:${keyInstant(payload.at)}`;
    case 'nap_window':
      return `nap:${compactGuid(payload.babyId)}`;
    case 'belly_pain_pattern':
      return `belly:${compactGuid(payload.babyId)}`;
    case 'overtired_warning':
      return `overtired:${compactGuid(payload.babyId)}`;
    case 'fussy_pattern':
      return `fussy:${compactGuid(payload.babyId)}`;
    case 'diaper_wet_headsup':
      return `wet:${compactGuid(payload.babyId)}`;
    case 'diaper_dirty_headsup':
      return `dirty:${compactGuid(payload.babyId)}`;
    case 'appointment_reminder':
      return `appt:${compactGuid(payload.apptId)}`;
    case 'doctor_suggestion':
      return `doctor:${compactGuid((payload.proposalId ?? payload.noteId) as string)}`;
    case 'vaccine_due':
      return `vaccine:${compactGuid(payload.babyId)}:${payload.doseId}`;
    case 'test':
      return `test:${compactGuid(payload.id)}`;
  }
}

/** Builds the notification for a parsed payload; generic text without tag or actions when invalid. */
export function buildNotification(
  parsed: ParsedPayload,
  timeZone?: string,
  now: number = Date.now(),
): ShownNotification {
  const { title, body } = renderText(parsed, timeZone, now);
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
