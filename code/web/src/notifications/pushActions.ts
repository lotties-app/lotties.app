import type { ApiClient } from '../api/apiClient';
import {
  getNotificationSettings,
  listPushDevices,
  putNotificationSettings,
  revokePushByEndpoint,
  subscribePush,
  type NotificationSettingsDto,
} from './pushApi';
import {
  browserPushDevice,
  keyMatches,
  type DeviceSubscription,
  type PushDevice,
} from './pushDevice';
import { localPushDeviceRecord, type PushDeviceRecordStore } from './pushDeviceRecord';

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
  /** This device's own opt-in record (default: localStorage). */
  record?: PushDeviceRecordStore;
}

/** Sign-out gives the server this long to revoke the device before it goes on locally. */
const SIGN_OUT_REVOKE_TIMEOUT_MS = 3_000;

/** The server id of this browser's subscription, from this device's opt-in record. */
export function thisDeviceId(
  endpoint: string | null | undefined,
  record: PushDeviceRecordStore = localPushDeviceRecord,
): string | null {
  const stored = record.read();
  return endpoint && stored?.endpoint === endpoint ? stored.id : null;
}

const recordOf = (context: Pick<PushContext, 'record'>) => context.record ?? localPushDeviceRecord;

/** POSTs the subscription (upsert by endpoint) and records the server id as this device's. */
async function register(context: PushContext, subscription: DeviceSubscription): Promise<string> {
  const record = recordOf(context);
  // Opted in from here on, even when the POST fails: the next start retries the registration.
  record.write({ endpoint: subscription.endpoint, id: null });
  const json = subscription.toJSON();
  const stored = await subscribePush(context.api, {
    endpoint: subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    locale: context.locale,
    ...(context.deviceLabel ? { deviceLabel: context.deviceLabel } : {}),
  });
  record.write({ endpoint: subscription.endpoint, id: stored.id });
  return stored.id;
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
export async function disablePush(
  context: Pick<PushContext, 'api' | 'device' | 'record'>,
): Promise<void> {
  const subscription = await context.device.getSubscription();
  if (!subscription) {
    recordOf(context).clear();
    return;
  }
  await revokePushByEndpoint(context.api, subscription.endpoint);
  await subscription.unsubscribe();
  recordOf(context).clear();
}

export type ReconcileOutcome =
  /** The user never turned notifications on here (or turned them off): nothing is sent. */
  | 'not-opted-in'
  /** The browser lost its subscription: the opt-in is cleared and the device shows as off. */
  | 'lost'
  /** Registered for the first time, or again after the subscription or VAPID key changed. */
  | 'registered'
  /** Still listed by the server: last seen, locale and label refreshed. */
  | 'refreshed'
  /** Removed from another device: the browser is unsubscribed and the opt-in cleared. */
  | 'removed-elsewhere';

/**
 * On app start (signed in, permission granted) and on a language change. Only a device the user
 * opted in on HERE is ever (re)registered, and only when it was never registered or its browser
 * subscription changed; a registered device is refreshed only while the server still lists it.
 * When the server no longer lists it (removed from another device), the browser is unsubscribed
 * and the local opt-in turned off, so the removal sticks.
 */
export async function reconcilePush(
  context: PushContext,
  publicKey: string,
): Promise<ReconcileOutcome> {
  const record = recordOf(context);
  const stored = record.read();
  if (!stored) return 'not-opted-in';
  const existing = await context.device.getSubscription();
  if (!existing) {
    record.clear();
    // Best effort: the server would otherwise revoke it after the next failed send.
    await revokePushByEndpoint(context.api, stored.endpoint).catch(() => undefined);
    return 'lost';
  }
  const changed = !keyMatches(existing, publicKey) || existing.endpoint !== stored.endpoint;
  if (changed || stored.id === null) {
    const subscription = changed ? await currentSubscription(context.device, publicKey) : existing;
    await register(context, subscription);
    await syncTimeZone(context.api, context.device);
    return 'registered';
  }
  const listed = (await listPushDevices(context.api)).some((device) => device.id === stored.id);
  if (!listed) {
    await existing.unsubscribe();
    record.clear();
    return 'removed-elsewhere';
  }
  await register(context, existing);
  await syncTimeZone(context.api, context.device);
  return 'refreshed';
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
  record: PushDeviceRecordStore = localPushDeviceRecord,
): Promise<void> {
  record.clear();
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
