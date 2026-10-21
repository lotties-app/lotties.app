/*
 * The notification deep link (docs/design/09-push-notifications.md sections 10 and 11), shared by
 * the service worker (builds it) and the app (reads it): `/#notify=dose&baby=..&rx=..&d=..&t=..`
 * or `/#notify=nap&baby=..&d=..`. Ids are validated GUIDs and the token a validated base64url
 * string on both sides; nothing else from a URL or a message is ever used. The fragment keeps ids
 * and the token out of server logs; the app strips it after reading it.
 */
import { guid, type PushPayload } from './payload';

export type NotificationLink =
  | { kind: 'dose'; babyId: string; rxId: string; deliveryId: string; token?: string }
  | { kind: 'nap'; babyId: string; deliveryId: string };

/** The app route a notification opens (the Now screen). */
export const DEEP_LINK_PATH = '/';

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

const token = (value: unknown): string | undefined =>
  typeof value === 'string' && TOKEN.test(value) ? value : undefined;

/** The link a notification opens; `null` for kinds that just open the app (test). */
export function linkOfPayload(payload: PushPayload): NotificationLink | null {
  switch (payload.kind) {
    case 'dose_due':
      return {
        kind: 'dose',
        babyId: payload.babyId,
        rxId: payload.rxId,
        deliveryId: payload.id,
        ...(payload.token !== undefined ? { token: payload.token } : {}),
      };
    case 'nap_window':
      return { kind: 'nap', babyId: payload.babyId, deliveryId: payload.id };
    case 'test':
      return null;
  }
}

/** `/#notify=...` for a link (same order of parameters as always: notify, baby, rx, d, t). */
export function deepLinkUrl(link: NotificationLink): string {
  const params = new URLSearchParams();
  params.set('notify', link.kind);
  params.set('baby', link.babyId);
  if (link.kind === 'dose') params.set('rx', link.rxId);
  params.set('d', link.deliveryId);
  if (link.kind === 'dose' && link.token !== undefined) params.set('t', link.token);
  return `${DEEP_LINK_PATH}#${params.toString()}`;
}

/** Reads a link from `location.hash` (`#notify=...`); `null` when absent or not valid. */
export function parseDeepLinkHash(hash: string): NotificationLink | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith('notify=')) return null;
  const params = new URLSearchParams(raw);
  return validLink({
    kind: params.get('notify'),
    babyId: params.get('baby'),
    rxId: params.get('rx'),
    deliveryId: params.get('d'),
    token: params.get('t'),
  });
}

/** Builds a link from untrusted fields, validating every one. */
function validLink(fields: Record<string, unknown>): NotificationLink | null {
  const babyId = guid(fields.babyId);
  const deliveryId = guid(fields.deliveryId);
  if (!babyId || !deliveryId) return null;
  if (fields.kind === 'nap') return { kind: 'nap', babyId, deliveryId };
  if (fields.kind !== 'dose') return null;
  const rxId = guid(fields.rxId);
  if (!rxId) return null;
  const actionToken = token(fields.token);
  return {
    kind: 'dose',
    babyId,
    rxId,
    deliveryId,
    ...(actionToken !== undefined ? { token: actionToken } : {}),
  };
}

/** Message the worker posts to an already-open app window instead of opening a new one. */
export interface NotificationOpenMessage {
  type: 'notification-open';
  kind: PushPayload['kind'];
  babyId?: string;
  rxId?: string;
  deliveryId: string;
  token?: string;
}

export function openMessageOf(link: NotificationLink): NotificationOpenMessage {
  return link.kind === 'dose'
    ? {
        type: 'notification-open',
        kind: 'dose_due',
        babyId: link.babyId,
        rxId: link.rxId,
        deliveryId: link.deliveryId,
        ...(link.token !== undefined ? { token: link.token } : {}),
      }
    : {
        type: 'notification-open',
        kind: 'nap_window',
        babyId: link.babyId,
        deliveryId: link.deliveryId,
      };
}

/** Reads a link from a worker message (re-validated: messages are untrusted input). */
export function linkOfMessage(data: unknown): NotificationLink | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'notification-open') return null;
  const kind =
    message.kind === 'dose_due' ? 'dose' : message.kind === 'nap_window' ? 'nap' : undefined;
  return validLink({ ...message, kind });
}
