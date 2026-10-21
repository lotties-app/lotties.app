/*
 * What a notification click does (docs/design/09-push-notifications.md sections 10 and 16): the
 * URL is built from the kind and validated GUIDs, never taken from the payload. The fragment keeps
 * ids and the action token out of server logs; the app strips it after reading it.
 */
import { validatePayload, type PushPayload } from './payload';
import { ACTION_SNOOZE } from './notificationOptions';

/** Message posted to an already-open app window instead of opening a new one. */
export interface NotificationOpenMessage {
  type: 'notification-open';
  kind: PushPayload['kind'];
  babyId?: string;
  rxId?: string;
  deliveryId: string;
  token?: string;
}

export type ClickTarget =
  | { type: 'snooze'; deliveryId: string; token: string }
  | { type: 'open'; path: string; message?: NotificationOpenMessage };

const APP_ROOT = '/';

/** The same-origin path the app opens at (`/#notify=...` for doses and naps, `/` otherwise). */
export function deepLinkPath(payload: PushPayload): string {
  const params = new URLSearchParams();
  switch (payload.kind) {
    case 'dose_due':
      params.set('notify', 'dose');
      params.set('baby', payload.babyId);
      params.set('rx', payload.rxId);
      params.set('d', payload.id);
      if (payload.token !== undefined) params.set('t', payload.token);
      return `${APP_ROOT}#${params.toString()}`;
    case 'nap_window':
      params.set('notify', 'nap');
      params.set('baby', payload.babyId);
      params.set('d', payload.id);
      return `${APP_ROOT}#${params.toString()}`;
    case 'test':
      return APP_ROOT;
  }
}

function openMessage(payload: PushPayload): NotificationOpenMessage | undefined {
  switch (payload.kind) {
    case 'dose_due':
      return {
        type: 'notification-open',
        kind: payload.kind,
        babyId: payload.babyId,
        rxId: payload.rxId,
        deliveryId: payload.id,
        ...(payload.token !== undefined ? { token: payload.token } : {}),
      };
    case 'nap_window':
      return {
        type: 'notification-open',
        kind: payload.kind,
        babyId: payload.babyId,
        deliveryId: payload.id,
      };
    case 'test':
      return undefined;
  }
}

/**
 * The click outcome for a notification's `data` (re-validated: it may come from an older worker)
 * and the clicked `action` ('' for the body). Snooze needs a dose with a token; anything else opens.
 */
export function clickTarget(data: unknown, action: string): ClickTarget {
  const parsed = validatePayload(data);
  if (!parsed.ok) return { type: 'open', path: APP_ROOT };
  const { payload } = parsed;
  if (action === ACTION_SNOOZE && payload.kind === 'dose_due' && payload.token !== undefined) {
    return { type: 'snooze', deliveryId: payload.id, token: payload.token };
  }
  const message = openMessage(payload);
  return message
    ? { type: 'open', path: deepLinkPath(payload), message }
    : { type: 'open', path: deepLinkPath(payload) };
}
