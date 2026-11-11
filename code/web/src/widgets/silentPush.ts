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
 *
 * The gate (section 5.4): nothing native is touched (no widget check, no ping listener, and above all no push token,
 * which is what makes the phone contact Apple or Google) until `GET /push/silent/status` says silent pushes are on for
 * this platform's channel. Asked at start and on resume, the answer trusted for SILENT_PUSH_STATUS_TTL_MS; a failed
 * call is not an answer and leaves everything as it is until the next resume.
 */

/** How long a status answer is trusted: a resume within it does not ask the server again. */
export const SILENT_PUSH_STATUS_TTL_MS = 5 * 60_000;

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
  /** The clock of the status cache (tests). */
  now?: () => number;
}

/**
 * Starts the registration (now and on every resume: tokens rotate, widgets come and go) and, once the server says
 * silent pushes are on, the ping handler; returns the stop. Never throws: a failed step waits for the next resume.
 */
export function startSilentPush({
  api,
  native,
  shell,
  syncNow,
  store = localDeviceIdStore,
  now = Date.now,
}: SilentPushOptions): () => void {
  let stopped = false;
  let reconciling: Promise<void> | undefined;
  let stopPings: (() => void) | undefined;
  setPushDeviceId(store.read());

  const channel = native.channel();
  const status = channel ? silentPushStatus(api, channel, now) : async () => undefined;
  const listen = () => {
    stopPings ??= native.onRemoteChange(() => void answerPing(native, syncNow));
  };
  const reconcile = () => {
    reconciling ??= reconcileDevice({
      api,
      native,
      store,
      status,
      listen,
      isStopped: () => stopped,
    }).finally(() => {
      reconciling = undefined;
    });
  };
  const stopResume = shell.onResume(reconcile);
  reconcile();

  return () => {
    stopped = true;
    stopPings?.();
    void stopResume.then((stop) => stop());
  };
}

/** `true`/`false` from the server (cached for the TTL), `undefined` when it could not be asked (never cached). */
type StatusReader = () => Promise<boolean | undefined>;

function silentPushStatus(api: ApiClient, channel: string, now: () => number): StatusReader {
  let cached: { enabled: boolean; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < SILENT_PUSH_STATUS_TTL_MS) return cached.enabled;
    try {
      const { enabled } = await api.request<{ enabled?: unknown }>(
        apiPaths.silentPushStatus(channel),
      );
      if (typeof enabled !== 'boolean') return undefined;
      cached = { enabled, at: now() };
      return enabled;
    } catch {
      return undefined;
    }
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

interface Reconcile {
  api: ApiClient;
  native: SilentPushNative;
  store: DeviceIdStore;
  status: StatusReader;
  /** Starts the ping handler (once). */
  listen: () => void;
  isStopped: () => boolean;
}

async function reconcileDevice({
  api,
  native,
  store,
  status,
  listen,
  isStopped,
}: Reconcile): Promise<void> {
  const enabled = await status();
  if (enabled === undefined || isStopped()) return;
  if (!enabled) {
    // Off on the server (it would refuse the device anyway): stop naming it, touch nothing native.
    forget(store);
    return;
  }
  listen();
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
