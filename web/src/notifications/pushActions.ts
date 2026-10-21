import type { ApiClient } from '../api/apiClient';
import {
  getNotificationSettings,
  putNotificationSettings,
  revokePushByEndpoint,
  subscribePush,
  type NotificationSettingsDto,
  type PushDeviceDto,
} from './pushApi';
import {
  browserPushDevice,
  keyMatches,
  type DeviceSubscription,
  type PushDevice,
} from './pushDevice';

/*
 * Subscribe, unsubscribe and reconcile this browser with the server
 * (docs/design/09-push-notifications.md sections 11 and 12).
 */

export interface PushContext {
  api: ApiClient;
  device: PushDevice;
  /** `en` or `pt-BR`: the language the service worker renders notifications in. */
  locale: string;
  /** "Chrome on Android"; left out when unknown. */
  deviceLabel?: string;
}

/** Sign-out gives the server this long to revoke the device before it goes on locally. */
const SIGN_OUT_REVOKE_TIMEOUT_MS = 3_000;

/** The server id of this browser's subscription, learnt from the last subscribe call. */
let thisDevice: { endpoint: string; id: string } | null = null;

export function thisDeviceId(endpoint: string | null | undefined): string | null {
  return endpoint && thisDevice?.endpoint === endpoint ? thisDevice.id : null;
}

function rememberDevice(endpoint: string, device: PushDeviceDto): string {
  thisDevice = { endpoint, id: device.id };
  return device.id;
}

async function register(context: PushContext, subscription: DeviceSubscription): Promise<string> {
  const json = subscription.toJSON();
  const stored = await subscribePush(context.api, {
    endpoint: subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    locale: context.locale,
    ...(context.deviceLabel ? { deviceLabel: context.deviceLabel } : {}),
  });
  return rememberDevice(subscription.endpoint, stored);
}

/** A subscription made with `publicKey`: the current one, or a new one after a key change. */
async function currentSubscription(
  device: PushDevice,
  publicKey: string,
): Promise<DeviceSubscription> {
  const existing = await device.getSubscription();
  if (existing && keyMatches(existing, publicKey)) return existing;
  // Subscriptions are bound to the VAPID key: after a rotation, drop the old one silently.
  await existing?.unsubscribe();
  return device.subscribe(publicKey);
}

/**
 * Stores the device's time zone when it differs from the server's (last writer wins). Reminders
 * are evaluated in this zone, so the web sends one before it ever subscribes.
 */
export async function syncTimeZone(
  api: ApiClient,
  device: PushDevice,
  known?: NotificationSettingsDto,
): Promise<NotificationSettingsDto> {
  const settings = known ?? (await getNotificationSettings(api));
  const zone = device.timeZone();
  if (settings.timeZone === zone) return settings;
  return putNotificationSettings(api, { ...settings, timeZone: zone });
}

/**
 * Turns notifications on after the browser granted permission: time zone first, then the
 * subscription, then the server row. Returns the device's server id.
 */
export async function enablePush(context: PushContext, publicKey: string): Promise<string> {
  await syncTimeZone(context.api, context.device);
  const subscription = await currentSubscription(context.device, publicKey);
  return register(context, subscription);
}

/** Turns notifications off: revokes the server row, then unsubscribes the browser. */
export async function disablePush(context: Pick<PushContext, 'api' | 'device'>): Promise<void> {
  const subscription = await context.device.getSubscription();
  if (!subscription) return;
  await revokePushByEndpoint(context.api, subscription.endpoint);
  await subscription.unsubscribe();
  thisDevice = null;
}

/**
 * On app start (signed in, permission granted) and on a language change: no subscription leaves
 * the device off; a key change re-subscribes; otherwise the POST refreshes last seen, locale and
 * label. Returns the device's server id, or `null` when it has no subscription.
 */
export async function reconcilePush(
  context: PushContext,
  publicKey: string,
): Promise<string | null> {
  const existing = await context.device.getSubscription();
  if (!existing) return null;
  const subscription = keyMatches(existing, publicKey)
    ? existing
    : await currentSubscription(context.device, publicKey);
  const id = await register(context, subscription);
  await syncTimeZone(context.api, context.device);
  return id;
}

/**
 * Sign-out: revoke this device on the server (bounded, best effort), then unsubscribe locally.
 * Offline, only the local unsubscribe happens; the next send gets 410 and the server revokes.
 * Never throws: signing out must not be blocked by push.
 */
export async function signOutPushDevice(
  api: ApiClient,
  device: PushDevice,
  online: boolean,
): Promise<void> {
  thisDevice = null;
  let subscription: DeviceSubscription | null;
  try {
    if (device.support() !== 'supported') return;
    subscription = await device.getSubscription();
  } catch {
    return;
  }
  if (!subscription) return;
  if (online) {
    try {
      await revokePushByEndpoint(
        api,
        subscription.endpoint,
        AbortSignal.timeout(SIGN_OUT_REVOKE_TIMEOUT_MS),
      );
    } catch {
      // The server revokes it after the next failed send.
    }
  }
  try {
    await subscription.unsubscribe();
  } catch {
    // Nothing else to do on this device.
  }
}

/** `signOutPushDevice` for the real browser, as `endAccountSession`'s `releaseDevice`. */
export function releaseThisDevice(api: ApiClient): () => Promise<void> {
  return () => signOutPushDevice(api, browserPushDevice, navigator.onLine !== false);
}
