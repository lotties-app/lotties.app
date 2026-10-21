import { isStandalone } from '../pwa/installPrompt';
import type { BrowserPermission } from './permissionState';
import { deviceParts, type DeviceParts } from './deviceLabel';
import { detectPushSupport, type PushSupport } from './pushSupport';

/*
 * The browser side of push behind a small port, so the Settings section, the reconcile and the
 * sign-out hook run against a fake in tests and in the developer preview.
 */

/** What the app needs of a `PushSubscription`. */
export interface DeviceSubscription {
  endpoint: string;
  /** The VAPID public key it was created with; `null` when the browser does not say. */
  applicationServerKey: ArrayBuffer | null;
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: () => Promise<boolean>;
}

export interface PushDevice {
  support: () => PushSupport;
  permission: () => BrowserPermission;
  /** Call only from a click handler (Safari needs the gesture; Chrome quiets sites that ask early). */
  requestPermission: () => Promise<BrowserPermission>;
  getSubscription: () => Promise<DeviceSubscription | null>;
  /** Subscribes with the server's VAPID key (base64url); needs an active service worker. */
  subscribe: (publicKey: string) => Promise<DeviceSubscription>;
  /** The device's IANA time zone. */
  timeZone: () => string;
  parts: () => DeviceParts | null;
}

/** How long to wait for the service worker before giving up on a subscribe. */
const READY_TIMEOUT_MS = 10_000;

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the subscription was made with `publicKey` (or the browser does not say). */
export function keyMatches(subscription: DeviceSubscription, publicKey: string): boolean {
  const current = subscription.applicationServerKey;
  if (!current) return true;
  const expected = base64UrlToBytes(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);
}

function wrap(subscription: PushSubscription): DeviceSubscription {
  return {
    endpoint: subscription.endpoint,
    applicationServerKey: subscription.options?.applicationServerKey ?? null,
    toJSON: () => subscription.toJSON(),
    unsubscribe: () => subscription.unsubscribe(),
  };
}

function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('service worker not ready')), READY_TIMEOUT_MS),
    ),
  ]);
}

function hasServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** The real browser (service worker registration, Push API, Notification API). */
export const browserPushDevice: PushDevice = {
  support: () =>
    typeof window === 'undefined'
      ? 'unsupported'
      : detectPushSupport({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
          standalone: isStandalone(),
          hasServiceWorker: hasServiceWorker(),
          hasPushManager: 'PushManager' in window,
          hasNotification: 'Notification' in window,
        }),
  permission: () =>
    typeof Notification === 'undefined'
      ? 'default'
      : (Notification.permission as BrowserPermission),
  requestPermission: async () => (await Notification.requestPermission()) as BrowserPermission,
  getSubscription: async () => {
    if (!hasServiceWorker()) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription ? wrap(subscription) : null;
  },
  subscribe: async (publicKey) => {
    const registration = await readyRegistration();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    return wrap(subscription);
  },
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  parts: () =>
    typeof navigator === 'undefined'
      ? null
      : deviceParts(navigator.userAgent, navigator.maxTouchPoints ?? 0),
};
