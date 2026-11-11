import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import { createApiClient, type ApiClient, type RequestOptions } from '../api/apiClient';
import { pushDeviceHeaders, setPushDeviceId } from '../api/pushDeviceHeader';
import { fakeNativeShell } from '../platform/nativeTestKit';
import {
  localDeviceIdStore,
  releaseSilentPushDevice,
  SILENT_PUSH_DEVICE_KEY,
  startSilentPush,
  type DeviceIdStore,
} from './silentPush';
import { toPushToken, type NativePushToken, type SilentPushNative } from './silentPushBridge';

/* The widgets' silent push, app side (docs/design/37b-widget-silent-push.md section 5). */

const TOKEN: NativePushToken = {
  channel: 'apns',
  token: 'ab'.repeat(32),
  apnsEnvironment: 'production',
};
const DEVICE_ID = '5b1f0c8e-6a8d-4c7e-9f0a-2d3b4c5d6e7f';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Call {
  path: string;
  method: string;
  body: unknown;
}

function fakeApi(answer: (call: Call) => unknown = () => ({ id: DEVICE_ID })) {
  const calls: Call[] = [];
  const api: ApiClient = {
    request: async <T>(path: string, options: RequestOptions = {}) => {
      const call = { path, method: options.method ?? 'GET', body: options.body };
      calls.push(call);
      const result = answer(call);
      if (result instanceof Error) throw result;
      return result as T;
    },
    requestWithMeta: async () => {
      throw new Error('not used');
    },
  };
  return { api, calls };
}

function fakeNative(options: { installed?: boolean; token?: NativePushToken | null } = {}) {
  let ping: (() => void) | undefined;
  const done: boolean[] = [];
  const native: SilentPushNative = {
    widgetsInstalled: async () => options.installed ?? true,
    pushToken: async () => (options.token === undefined ? TOKEN : options.token),
    onRemoteChange: (listener) => {
      ping = listener;
      return () => {
        ping = undefined;
      };
    },
    remoteChangeDone: async (changed) => void done.push(changed),
  };
  return { native, done, ping: () => ping?.(), listening: () => ping !== undefined };
}

function memoryStore(initial?: string): DeviceIdStore & { value: string | undefined } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (id: string | undefined) => {
      store.value = id;
    },
  };
  return store;
}

afterEach(() => {
  setPushDeviceId(undefined);
  localStorage.clear();
});

describe('startSilentPush', () => {
  it('registers the token while a widget is installed and names the device on every request', async () => {
    const { api, calls } = fakeApi();
    const store = memoryStore();
    const stop = startSilentPush({
      api,
      native: fakeNative().native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(calls).toEqual([{ path: '/api/v1/push/devices', method: 'POST', body: TOKEN }]);
    expect(store.value).toBe(DEVICE_ID);
    expect(pushDeviceHeaders()).toEqual({ 'Lotties-Push-Device': DEVICE_ID });
    stop();
  });

  it('names the stored device before the registration answers', () => {
    const { api } = fakeApi(() => new Promise(() => undefined));
    const stop = startSilentPush({
      api,
      native: fakeNative().native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(DEVICE_ID),
    });

    expect(pushDeviceHeaders()).toEqual({ 'Lotties-Push-Device': DEVICE_ID });
    stop();
  });

  it('unregisters a stored device when no widget is left', async () => {
    const { api, calls } = fakeApi(() => undefined);
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({
      api,
      native: fakeNative({ installed: false }).native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(calls).toEqual([
      { path: `/api/v1/push/devices/${DEVICE_ID}`, method: 'DELETE', body: undefined },
    ]);
    expect(store.value).toBeUndefined();
    expect(pushDeviceHeaders()).toEqual({});
    stop();
  });

  it('keeps the stored device for the next try when the unregister fails', async () => {
    const { api } = fakeApi(() => new TypeError('offline'));
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({
      api,
      native: fakeNative({ installed: false }).native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(store.value).toBe(DEVICE_ID);
    stop();
  });

  it('sends nothing without a widget or without a token', async () => {
    const noWidget = fakeApi();
    const noToken = fakeApi();
    const stops = [
      startSilentPush({
        api: noWidget.api,
        native: fakeNative({ installed: false }).native,
        shell: fakeNativeShell(),
        syncNow: vi.fn(),
        store: memoryStore(),
      }),
      startSilentPush({
        api: noToken.api,
        native: fakeNative({ token: null }).native,
        shell: fakeNativeShell(),
        syncNow: vi.fn(),
        store: memoryStore(),
      }),
    ];
    await flush();

    expect([noWidget.calls, noToken.calls]).toEqual([[], []]);
    stops.forEach((stop) => stop());
  });

  it('forgets the device when the server has silent pushes off', async () => {
    const { api } = fakeApi(() => new ApiError(409, { code: 'silent_push_not_configured' }));
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({
      api,
      native: fakeNative().native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(store.value).toBeUndefined();
    expect(pushDeviceHeaders()).toEqual({});
    stop();
  });

  it('keeps the device on any other failure', async () => {
    const { api } = fakeApi(() => new ApiError(503, { code: 'unavailable' }));
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({
      api,
      native: fakeNative().native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(store.value).toBe(DEVICE_ID);
    stop();
  });

  it('registers again on every resume (tokens rotate)', async () => {
    const { api, calls } = fakeApi();
    const shell = fakeNativeShell();
    const stop = startSilentPush({
      api,
      native: fakeNative().native,
      shell,
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();

    shell.resume();
    await flush();

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    stop();
  });

  it('answers a ping with a sync, then tells the native layer', async () => {
    const native = fakeNative();
    const syncNow = vi.fn(async () => undefined);
    const stop = startSilentPush({
      api: fakeApi().api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow,
      store: memoryStore(),
    });

    native.ping();
    await flush();

    expect(syncNow).toHaveBeenCalledOnce();
    expect(native.done).toEqual([true]);
    stop();
  });

  it('answers a ping whose sync failed with no new data', async () => {
    const native = fakeNative();
    const stop = startSilentPush({
      api: fakeApi().api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: async () => {
        throw new Error('offline');
      },
      store: memoryStore(),
    });

    native.ping();
    await flush();

    expect(native.done).toEqual([false]);
    stop();
  });

  it('stops listening when stopped', () => {
    const native = fakeNative();
    const shell = fakeNativeShell();
    const stop = startSilentPush({
      api: fakeApi().api,
      native: native.native,
      shell,
      syncNow: vi.fn(),
      store: memoryStore(),
    });

    stop();

    expect(native.listening()).toBe(false);
  });
});

describe('releaseSilentPushDevice', () => {
  it('switches the device off on the server and forgets it', async () => {
    const { api, calls } = fakeApi(() => undefined);
    const store = memoryStore(DEVICE_ID);
    setPushDeviceId(DEVICE_ID);

    await releaseSilentPushDevice(api, store);

    expect(calls).toEqual([
      { path: `/api/v1/push/devices/${DEVICE_ID}`, method: 'DELETE', body: undefined },
    ]);
    expect(store.value).toBeUndefined();
    expect(pushDeviceHeaders()).toEqual({});
  });

  it('forgets the device even when the server cannot be reached', async () => {
    const { api } = fakeApi(() => new TypeError('offline'));
    const store = memoryStore(DEVICE_ID);

    await releaseSilentPushDevice(api, store);

    expect(store.value).toBeUndefined();
  });

  it('does nothing without a registered device', async () => {
    const { api, calls } = fakeApi();

    await releaseSilentPushDevice(api, memoryStore());

    expect(calls).toEqual([]);
  });
});

describe('localDeviceIdStore', () => {
  it('keeps the id in localStorage', () => {
    localDeviceIdStore.write(DEVICE_ID);
    expect(localStorage.getItem(SILENT_PUSH_DEVICE_KEY)).toBe(DEVICE_ID);
    localDeviceIdStore.write(undefined);
    expect(localDeviceIdStore.read()).toBeUndefined();
  });
});

describe('toPushToken', () => {
  it('accepts an APNs token with its environment and an FCM token without', () => {
    expect(toPushToken(TOKEN)).toEqual(TOKEN);
    expect(toPushToken({ channel: 'fcm', token: 'x', apnsEnvironment: 'production' })).toEqual({
      channel: 'fcm',
      token: 'x',
    });
  });

  it.each([
    null,
    'token',
    {},
    { channel: 'web', token: 'x' },
    { channel: 'apns', token: 'x' },
    { channel: 'fcm', token: '' },
  ])('refuses %j', (reply) => {
    expect(toPushToken(reply)).toBeNull();
  });
});

describe('the API client', () => {
  it('sends the device header once a device is registered', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createApiClient({ baseUrl: '', getAccessToken: async () => null, fetchImpl });
    setPushDeviceId(DEVICE_ID);

    await client.request('/x');

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Lotties-Push-Device']).toBe(DEVICE_ID);
  });
});
