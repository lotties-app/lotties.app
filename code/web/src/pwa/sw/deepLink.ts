/*
 * The notification deep link (docs/design/09-push-notifications.md sections 10 and 11), shared by
 * the service worker (builds it) and the app (reads it): `/#notify=dose&baby=..&rx=..&d=..&t=..`,
 * `/#notify=nap&baby=..&d=..`, `/#notify=belly&..`, `/#notify=overtired&..`, `/#notify=fussy&..`,
 * `/#notify=wet&..` or `/#notify=dirty&..` (each opens Now, where the matching card shows when it
 * applies). Ids are validated GUIDs and the
 * token a validated base64url string on both sides; nothing else from a URL or a message is ever
 * used. The fragment keeps ids and the token out of server logs; the app strips it after reading
 * it.
 */
import { getOwn } from '../../util/ownProperty';
import { guid, type PushPayload } from './payload';

/** Links that just open Now for a baby. */
export type NowLinkKind = 'nap' | 'belly' | 'overtired' | 'fussy' | 'wet' | 'dirty';

export type NotificationLink =
  | { kind: 'dose'; babyId: string; rxId: string; deliveryId: string; token?: string }
  | { kind: NowLinkKind; babyId: string; deliveryId: string };

/** The payload kind of each Now link, and back. */
const PAYLOAD_KIND_OF_LINK: Readonly<Record<NowLinkKind, PushPayload['kind']>> = {
  nap: 'nap_window',
  belly: 'belly_pain_pattern',
  overtired: 'overtired_warning',
  fussy: 'fussy_pattern',
  wet: 'diaper_wet_headsup',
  dirty: 'diaper_dirty_headsup',
};

const isNowLinkKind = (kind: unknown): kind is NowLinkKind =>
  typeof kind === 'string' && getOwn(PAYLOAD_KIND_OF_LINK, kind) !== undefined;

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
    case 'belly_pain_pattern':
      return { kind: 'belly', babyId: payload.babyId, deliveryId: payload.id };
    case 'overtired_warning':
      return { kind: 'overtired', babyId: payload.babyId, deliveryId: payload.id };
    case 'fussy_pattern':
      return { kind: 'fussy', babyId: payload.babyId, deliveryId: payload.id };
    case 'diaper_wet_headsup':
      return { kind: 'wet', babyId: payload.babyId, deliveryId: payload.id };
    case 'diaper_dirty_headsup':
      return { kind: 'dirty', babyId: payload.babyId, deliveryId: payload.id };
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
  if (isNowLinkKind(fields.kind)) {
    return { kind: fields.kind, babyId, deliveryId };
  }
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
        kind: PAYLOAD_KIND_OF_LINK[link.kind],
        babyId: link.babyId,
        deliveryId: link.deliveryId,
      };
}

const LINK_KIND_OF_MESSAGE: Readonly<Record<string, NotificationLink['kind']>> = {
  dose_due: 'dose',
  nap_window: 'nap',
  belly_pain_pattern: 'belly',
  overtired_warning: 'overtired',
  fussy_pattern: 'fussy',
  diaper_wet_headsup: 'wet',
  diaper_dirty_headsup: 'dirty',
};

/** Reads a link from a worker message (re-validated: messages are untrusted input). */
export function linkOfMessage(data: unknown): NotificationLink | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.type !== 'notification-open') return null;
  const kind =
    typeof message.kind === 'string' ? getOwn(LINK_KIND_OF_MESSAGE, message.kind) : undefined;
  return validLink({ ...message, kind });
}
