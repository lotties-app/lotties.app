import { ApiError } from '../api/ApiError';
import type { ApiClient } from '../api/apiClient';
import { setPushDeviceId } from '../api/pushDeviceHeader';
import type { NativeShell } from '../platform/nativeShell';
import { apiPaths } from '../sync/contract';
import type { NativePushToken, SilentPushNative } from './silentPushBridge';

/*
 * Silent pushes for fresh widgets, the app side (docs/design/37b-widget-silent-push.md section 5): this install
 * registers its push token while a Lotties widget is on the home screen, names itself on every API request (so the
 * server does not ping the phone that made a change), and on a ping pulls the sync so the widget runner rewrites the
 * snapshot. Native app only; the token never leaves this exchange with our own API.
 */

/** Where this install keeps the id `POST /push/devices` returned (one per install, whatever the account). */
export const SILENT_PUSH_DEVICE_KEY = 'lotties.silentPushDevice';

export interface DeviceIdStore {
  read(): string | undefined;
  write(id: string | undefined): void;
}

export const localDeviceIdStore: DeviceIdStore = {
  read: () => {
    try {
      return localStorage.getItem(SILENT_PUSH_DEVICE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  write: (id) => {
    try {
      if (id) localStorage.setItem(SILENT_PUSH_DEVICE_KEY, id);
      else localStorage.removeItem(SILENT_PUSH_DEVICE_KEY);
    } catch {
      // Storage blocked: the app registers again at the next launch.
    }
  },
};

export interface SilentPushOptions {
  api: ApiClient;
  native: SilentPushNative;
  shell: Pick<NativeShell, 'onResume'>;
  /** Pulls what other phones logged and writes the widget snapshot if it changed; resolves when done. */
  syncNow: () => Promise<void>;
  store?: DeviceIdStore;
}

/**
 * Starts the registration (now and on every resume: tokens rotate, widgets come and go) and the ping handler; returns
 * the stop. Never throws: a failed step waits for the next resume.
 */
export function startSilentPush({
  api,
  native,
  shell,
  syncNow,
  store = localDeviceIdStore,
}: SilentPushOptions): () => void {
  let stopped = false;
  let reconciling: Promise<void> | undefined;
  setPushDeviceId(store.read());

  const reconcile = () => {
    reconciling ??= reconcileDevice(api, native, store, () => stopped).finally(() => {
      reconciling = undefined;
    });
  };
  const stopPings = native.onRemoteChange(() => void answerPing(native, syncNow));
  const stopResume = shell.onResume(reconcile);
  reconcile();

  return () => {
    stopped = true;
    stopPings();
    void stopResume.then((stop) => stop());
  };
}

/** Sign-out: switches this install off on the server (while the token still works) and forgets it here. */
export async function releaseSilentPushDevice(
  api: ApiClient,
  store: DeviceIdStore = localDeviceIdStore,
): Promise<void> {
  const id = store.read();
  forget(store);
  if (!id) return;
  await api.request(apiPaths.pushDevice(id), { method: 'DELETE' }).catch(() => undefined);
}

async function reconcileDevice(
  api: ApiClient,
  native: SilentPushNative,
  store: DeviceIdStore,
  isStopped: () => boolean,
): Promise<void> {
  const installed = await native.widgetsInstalled().catch(() => false);
  if (isStopped()) return;
  if (!installed) {
    await unregister(api, store);
    return;
  }
  const token = await native.pushToken().catch(() => null);
  if (!token || isStopped()) return;
  await register(api, store, token);
}

async function register(
  api: ApiClient,
  store: DeviceIdStore,
  token: NativePushToken,
): Promise<void> {
  try {
    const device = await api.request<{ id: string }>(apiPaths.pushDevices(), {
      method: 'POST',
      body: token,
    });
    store.write(device.id);
    setPushDeviceId(device.id);
  } catch (error) {
    if (isOff(error)) forget(store);
  }
}

/** No widget any more: no reason to keep a token on the server. Kept for the next try when the call fails. */
async function unregister(api: ApiClient, store: DeviceIdStore): Promise<void> {
  const id = store.read();
  if (!id) return;
  try {
    await api.request(apiPaths.pushDevice(id), { method: 'DELETE' });
    forget(store);
  } catch (error) {
    if (isOff(error)) forget(store);
  }
}

async function answerPing(native: SilentPushNative, syncNow: () => Promise<void>): Promise<void> {
  const changed = await syncNow().then(
    () => true,
    () => false,
  );
  await native.remoteChangeDone(changed).catch(() => undefined);
}

function forget(store: DeviceIdStore): void {
  store.write(undefined);
  setPushDeviceId(undefined);
}

const isOff = (error: unknown) =>
  error instanceof ApiError && error.code === 'silent_push_not_configured';
