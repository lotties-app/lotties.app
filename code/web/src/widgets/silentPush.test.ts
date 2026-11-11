import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import { createApiClient, type ApiClient, type RequestOptions } from '../api/apiClient';
import { pushDeviceHeaders, setPushDeviceId } from '../api/pushDeviceHeader';
import { fakeNativeShell } from '../platform/nativeTestKit';
import {
  localDeviceIdStore,
  releaseSilentPushDevice,
  SILENT_PUSH_DEVICE_KEY,
  SILENT_PUSH_STATUS_TTL_MS,
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

const STATUS_PATH = '/api/v1/push/silent/status?channel=apns';
const STATUS: Call = { path: STATUS_PATH, method: 'GET', body: undefined };

/** The server with silent pushes on: the status says so, a registration returns the device. */
const silentPushOn = (call: Call): unknown =>
  call.path.startsWith('/api/v1/push/silent/status') ? { enabled: true } : { id: DEVICE_ID };

/** Silent pushes on, every other answer from `other`. */
const onThen =
  (other: (call: Call) => unknown) =>
  (call: Call): unknown =>
    call.path === STATUS_PATH ? { enabled: true } : other(call);

function fakeApi(answer: (call: Call) => unknown = silentPushOn) {
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

function fakeNative(
  options: {
    installed?: boolean;
    token?: NativePushToken | null;
    channel?: 'apns' | 'fcm' | null;
  } = {},
) {
  let ping: (() => void) | undefined;
  const done: boolean[] = [];
  /** Every call that reaches the native layer (the channel is read in JavaScript and not counted). */
  const touched: string[] = [];
  const native: SilentPushNative = {
    channel: () => (options.channel === undefined ? 'apns' : options.channel),
    widgetsInstalled: async () => {
      touched.push('widgetsInstalled');
      return options.installed ?? true;
    },
    pushToken: async () => {
      touched.push('pushToken');
      return options.token === undefined ? TOKEN : options.token;
    },
    onRemoteChange: (listener) => {
      touched.push('onRemoteChange');
      ping = listener;
      return () => {
        ping = undefined;
      };
    },
    remoteChangeDone: async (changed) => {
      touched.push('remoteChangeDone');
      done.push(changed);
    },
  };
  return { native, done, touched, ping: () => ping?.(), listening: () => ping !== undefined };
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

    expect(calls).toEqual([STATUS, { path: '/api/v1/push/devices', method: 'POST', body: TOKEN }]);
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
    const { api, calls } = fakeApi(onThen(() => undefined));
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
      STATUS,
      { path: `/api/v1/push/devices/${DEVICE_ID}`, method: 'DELETE', body: undefined },
    ]);
    expect(store.value).toBeUndefined();
    expect(pushDeviceHeaders()).toEqual({});
    stop();
  });

  it('keeps the stored device for the next try when the unregister fails', async () => {
    const { api } = fakeApi(onThen(() => new TypeError('offline')));
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

  it('sends nothing but the status read without a widget or without a token', async () => {
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

    expect([noWidget.calls, noToken.calls]).toEqual([[STATUS], [STATUS]]);
    stops.forEach((stop) => stop());
  });

  it('forgets the device when the server refuses it as off', async () => {
    const { api } = fakeApi(
      onThen(() => new ApiError(409, { code: 'silent_push_not_configured' })),
    );
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
    const { api } = fakeApi(onThen(() => new ApiError(503, { code: 'unavailable' })));
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

  it('registers again on every resume (tokens rotate), reusing a fresh status answer', async () => {
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
    expect(calls.filter((call) => call.path === STATUS_PATH)).toHaveLength(1);
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
    await flush();

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
    await flush();

    native.ping();
    await flush();

    expect(native.done).toEqual([false]);
    stop();
  });

  it('stops listening when stopped', async () => {
    const native = fakeNative();
    const stop = startSilentPush({
      api: fakeApi().api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();
    expect(native.listening()).toBe(true);

    stop();

    expect(native.listening()).toBe(false);
  });
});

describe('the silent push gate (design 37b section 5.4)', () => {
  it('asks about the channel of this platform', async () => {
    const { api, calls } = fakeApi();
    const stop = startSilentPush({
      api,
      native: fakeNative({ channel: 'fcm', token: { channel: 'fcm', token: 'f1:APA91b' } }).native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();

    expect(calls[0]).toEqual({
      path: '/api/v1/push/silent/status?channel=fcm',
      method: 'GET',
      body: undefined,
    });
    stop();
  });

  it('touches nothing native while silent pushes are off, and stops naming a stored device', async () => {
    const { api, calls } = fakeApi(() => ({ enabled: false }));
    const native = fakeNative();
    const shell = fakeNativeShell();
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({ api, native: native.native, shell, syncNow: vi.fn(), store });
    await flush();
    shell.resume();
    await flush();

    expect(native.touched).toEqual([]);
    expect(calls).toEqual([STATUS]);
    expect(store.value).toBeUndefined();
    expect(pushDeviceHeaders()).toEqual({});
    stop();
  });

  it('asks the phone for a token once when silent pushes are on', async () => {
    const native = fakeNative();
    const stop = startSilentPush({
      api: fakeApi().api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();

    expect(native.touched).toEqual(['onRemoteChange', 'widgetsInstalled', 'pushToken']);
    stop();
  });

  it.each([
    ['the call fails', () => new TypeError('offline')],
    ['the server refuses (demo, no consent)', () => new ApiError(403, { code: 'demo_not_available' })],
    ['the answer is not a boolean', () => ({ enabled: 'yes' })],
  ])('touches nothing native and keeps the stored device when %s', async (_, answer) => {
    const { api, calls } = fakeApi(answer);
    const native = fakeNative();
    const store = memoryStore(DEVICE_ID);
    const stop = startSilentPush({
      api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store,
    });
    await flush();

    expect(native.touched).toEqual([]);
    expect(calls).toEqual([STATUS]);
    expect(store.value).toBe(DEVICE_ID);
    stop();
  });

  it('asks again on a resume after a failed call', async () => {
    let fail = true;
    const { api, calls } = fakeApi((call) =>
      fail ? new TypeError('offline') : silentPushOn(call),
    );
    const native = fakeNative();
    const shell = fakeNativeShell();
    const stop = startSilentPush({
      api,
      native: native.native,
      shell,
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();

    fail = false;
    shell.resume();
    await flush();

    expect(calls.filter((call) => call.path === STATUS_PATH)).toHaveLength(2);
    expect(native.touched).toContain('pushToken');
    stop();
  });

  it('asks again only once the answer is older than the cache time', async () => {
    let enabled = false;
    let clock = 0;
    const { api, calls } = fakeApi((call) =>
      call.path === STATUS_PATH ? { enabled } : { id: DEVICE_ID },
    );
    const native = fakeNative();
    const shell = fakeNativeShell();
    const stop = startSilentPush({
      api,
      native: native.native,
      shell,
      syncNow: vi.fn(),
      store: memoryStore(),
      now: () => clock,
    });
    await flush();

    enabled = true;
    clock = SILENT_PUSH_STATUS_TTL_MS - 1;
    shell.resume();
    await flush();
    expect(native.touched).toEqual([]);

    clock = SILENT_PUSH_STATUS_TTL_MS;
    shell.resume();
    await flush();

    expect(calls.filter((call) => call.path === STATUS_PATH)).toHaveLength(2);
    expect(native.touched).toContain('pushToken');
    stop();
  });

  it('asks nothing on a platform without a push channel', async () => {
    const { api, calls } = fakeApi();
    const native = fakeNative({ channel: null });
    const stop = startSilentPush({
      api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(),
    });
    await flush();

    expect(calls).toEqual([]);
    expect(native.touched).toEqual([]);
    stop();
  });

  it('touches nothing native when stopped before the server answers', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { api } = fakeApi(() => new Promise((resolve) => (answer = resolve)));
    const native = fakeNative();
    const stop = startSilentPush({
      api,
      native: native.native,
      shell: fakeNativeShell(),
      syncNow: vi.fn(),
      store: memoryStore(),
    });

    stop();
    answer({ enabled: true });
    await flush();

    expect(native.touched).toEqual([]);
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
