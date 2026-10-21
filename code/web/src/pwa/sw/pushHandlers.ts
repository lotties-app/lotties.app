/*
 * Push event handlers of the service worker (docs/design/09-push-notifications.md section 10),
 * written against a small injected scope so tests can pass a fake `self`/registration. No handler
 * throws: a push always ends in a shown notification (browsers revoke subscriptions otherwise).
 */
import { clickTarget, type NotificationOpenMessage } from './clickTarget';
import {
  buildNotification,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  type ShownNotificationOptions,
} from './notificationOptions';
import { genericText } from './notificationText';
import { parsePayload, resolveLang, type PushLang } from './payload';
import { postSnooze, type FetchLike } from './snoozeAction';

export interface PushDataLike {
  text(): string;
}

export interface PushEventLike {
  readonly data: PushDataLike | null;
  waitUntil(promise: Promise<unknown>): void;
}

export interface NotificationLike {
  readonly data: unknown;
  close(): void;
}

export interface NotificationClickEventLike {
  readonly action: string;
  readonly notification: NotificationLike;
  waitUntil(promise: Promise<unknown>): void;
}

export interface SubscriptionLike {
  readonly options?: { readonly applicationServerKey: ArrayBuffer | null } | null;
}

/** `pushsubscriptionchange` is not in lib.webworker: only the fields we read. */
export interface PushSubscriptionChangeEventLike {
  readonly oldSubscription?: SubscriptionLike | null;
  readonly newSubscription?: SubscriptionLike | null;
  waitUntil(promise: Promise<unknown>): void;
}

export interface WindowClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

export interface WorkerScopeLike {
  readonly location: { readonly origin: string };
  readonly navigator: { readonly language?: string };
  readonly registration: {
    showNotification(title: string, options?: ShownNotificationOptions): Promise<void>;
    readonly pushManager: {
      subscribe(options: {
        userVisibleOnly: boolean;
        applicationServerKey: ArrayBuffer;
      }): Promise<unknown>;
    };
  };
  readonly clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export interface PushHandlerDeps {
  scope: WorkerScopeLike;
  fetch: FetchLike;
  apiBaseUrl: string;
  /** Tests only: render times in this zone instead of the device zone. */
  timeZone?: string;
}

function readText(data: PushDataLike | null): string | null {
  try {
    return data ? data.text() : null;
  } catch {
    return null;
  }
}

function deviceLang(scope: WorkerScopeLike): PushLang {
  try {
    return resolveLang(scope.navigator.language);
  } catch {
    return 'en';
  }
}

/** Shows the notification for a push message; falls back to the generic text, never rejects. */
export async function handlePush(deps: PushHandlerDeps, data: PushDataLike | null): Promise<void> {
  const fallbackLang = deviceLang(deps.scope);
  try {
    const parsed = parsePayload(readText(data), fallbackLang);
    const { title, options } = buildNotification(parsed, deps.timeZone);
    await deps.scope.registration.showNotification(title, options);
    return;
  } catch {
    // An option the browser rejected or a rendering bug: still show something neutral below.
  }
  try {
    const { title, body } = genericText(fallbackLang);
    await deps.scope.registration.showNotification(title, {
      body,
      lang: fallbackLang,
      dir: 'auto',
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    });
  } catch {
    // Nothing more the worker can do.
  }
}

const sameOrigin = (url: string, origin: string) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

async function openApp(
  scope: WorkerScopeLike,
  path: string,
  message: NotificationOpenMessage | undefined,
): Promise<void> {
  const origin = scope.location.origin;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => sameOrigin(client.url, origin));
  if (existing) {
    try {
      await existing.focus();
      if (message) existing.postMessage(message);
      return;
    } catch {
      // Focus is refused without a user gesture in some browsers: open a window instead.
    }
  }
  await scope.clients.openWindow(new URL(path, origin).href);
}

/** Snooze posts the action and closes; everything else closes and opens or focuses the app. */
export async function handleNotificationClick(
  deps: PushHandlerDeps,
  action: string,
  notification: NotificationLike,
): Promise<void> {
  try {
    notification.close();
    const target = clickTarget(notification.data, action);
    if (target.type === 'snooze') {
      await postSnooze(deps.fetch, deps.apiBaseUrl, target.deliveryId, target.token);
      return;
    }
    await openApp(deps.scope, target.path, target.message);
  } catch {
    // Never throw from the click handler.
  }
}

/**
 * Re-subscribes with the old `applicationServerKey` when the browser dropped the subscription
 * without a replacement. The app reconciles the new endpoint with the server on next open (the
 * worker has no access token).
 */
export async function handleSubscriptionChange(
  deps: PushHandlerDeps,
  event: Pick<PushSubscriptionChangeEventLike, 'oldSubscription' | 'newSubscription'>,
): Promise<void> {
  try {
    if (event.newSubscription) return;
    const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
    if (!applicationServerKey) return;
    await deps.scope.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch {
    // Permission revoked or key unavailable: the app's reconcile shows the device as off.
  }
}

/** Wires `push`, `notificationclick` and `pushsubscriptionchange` on the worker scope. */
export function registerPushHandlers(deps: PushHandlerDeps): void {
  // The DOM event types are wider than what we read; the casts name the fields used.
  deps.scope.addEventListener('push', (event) => {
    const push = event as unknown as PushEventLike;
    push.waitUntil(handlePush(deps, push.data));
  });
  deps.scope.addEventListener('notificationclick', (event) => {
    const click = event as unknown as NotificationClickEventLike;
    click.waitUntil(handleNotificationClick(deps, click.action, click.notification));
  });
  deps.scope.addEventListener('pushsubscriptionchange', (event) => {
    const change = event as unknown as PushSubscriptionChangeEventLike;
    change.waitUntil(handleSubscriptionChange(deps, change));
  });
}
