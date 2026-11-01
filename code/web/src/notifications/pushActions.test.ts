import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/ApiError';
import { FAKE_ENDPOINT, fakePushDevice, fakePushServer } from './fakePush';
import {
  disablePush,
  enablePush,
  reconcilePush,
  signOutPushDevice,
  thisDeviceId,
} from './pushActions';
import { base64UrlToBytes, keyMatches } from './pushDevice';
import { memoryPushDeviceRecord } from './pushDeviceRecord';

const KEY = 'BFakeKey';
const OTHER_KEY = 'AOtherKe';

const subscriptionCalls = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

const SETTINGS = {
  timeZone: 'America/Sao_Paulo',
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  quietIncludesMedicine: false,
  showNames: false,
};

const LISTED_DEVICE = {
  id: 'this-device',
  deviceLabel: null,
  locale: 'en',
  createdAt: '2026-10-20T10:00:00Z',
  lastSeenAt: '2026-10-20T10:00:00Z',
  lastSuccessAt: null,
};

const registered = () => memoryPushDeviceRecord({ endpoint: FAKE_ENDPOINT, id: 'this-device' });

describe('keyMatches', () => {
  it('compares the subscription key with the server key', () => {
    const device = fakePushDevice({ subscribed: true });
    const subscription = device.state.subscription!;
    expect(keyMatches(subscription, KEY)).toBe(true); // unknown key: assume it matches
    const withKey = { ...subscription, applicationServerKey: base64UrlToBytes(KEY).buffer };
    expect(keyMatches(withKey, KEY)).toBe(true);
    expect(keyMatches(withKey, OTHER_KEY)).toBe(false);
  });
});

describe('enablePush', () => {
  it('stores the time zone first, then subscribes, registers and records the device', async () => {
    const device = fakePushDevice({ permission: 'granted', timeZone: 'Europe/Lisbon' });
    const server = fakePushServer();
    const record = memoryPushDeviceRecord();
    const id = await enablePush(
      { api: server.api, device, locale: 'pt-BR', deviceLabel: 'Chrome no Android', record },
      KEY,
    );

    expect(id).toBe('this-device');
    expect(thisDeviceId(FAKE_ENDPOINT, record)).toBe('this-device');
    expect(record.current).toEqual({ endpoint: FAKE_ENDPOINT, id: 'this-device' });
    expect(subscriptionCalls(server.calls)).toEqual([
      'PUT /api/v1/push/settings',
      'POST /api/v1/push/subscriptions',
    ]);
    expect(server.state.settings.timeZone).toBe('Europe/Lisbon');
    expect(server.calls.at(-1)?.body).toEqual({
      endpoint: FAKE_ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'BFakeP256dh', auth: 'fakeAuth' },
      locale: 'pt-BR',
      deviceLabel: 'Chrome no Android',
    });
    expect(device.prompts).toBe(0);
  });

  it('keeps the opt-in when the subscribe call failed, so the next start retries', async () => {
    const device = fakePushDevice({ permission: 'granted' });
    const record = memoryPushDeviceRecord();
    const server = fakePushServer({ settings: SETTINGS });
    const api = {
      ...server.api,
      request: async <T>(path: string, options?: { method?: string }) => {
        if (options?.method === 'POST') throw new ApiError(503, {});
        return server.api.request<T>(path, options);
      },
    };
    await expect(enablePush({ api, device, locale: 'en', record }, KEY)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(record.current).toEqual({ endpoint: FAKE_ENDPOINT, id: null });
  });
});

describe('reconcilePush', () => {
  it('never registers a device the user did not opt in on here', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({ settings: SETTINGS });
    const record = memoryPushDeviceRecord();
    const outcome = await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY);
    expect(outcome).toBe('not-opted-in');
    expect(server.calls).toEqual([]);
    expect(device.state.subscription).not.toBeNull();
  });

  it('registers an opted-in device that was never registered', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({ settings: SETTINGS });
    const record = memoryPushDeviceRecord({ endpoint: FAKE_ENDPOINT, id: null });
    const outcome = await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY);
    expect(outcome).toBe('registered');
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions']);
    expect(record.current).toEqual({ endpoint: FAKE_ENDPOINT, id: 'this-device' });
  });

  it('re-registers when the browser subscription changed', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({ settings: SETTINGS });
    const record = memoryPushDeviceRecord({
      endpoint: 'https://fcm.googleapis.com/fcm/send/old-endpoint',
      id: 'old-id',
    });
    const outcome = await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY);
    expect(outcome).toBe('registered');
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions']);
    expect(record.current).toEqual({ endpoint: FAKE_ENDPOINT, id: 'this-device' });
  });

  it('refreshes a registered device the server still lists', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({ settings: SETTINGS, devices: [LISTED_DEVICE] });
    const outcome = await reconcilePush(
      { api: server.api, device, locale: 'pt-BR', record: registered() },
      KEY,
    );
    expect(outcome).toBe('refreshed');
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions']);
    expect(server.state.devices[0]?.locale).toBe('pt-BR');
  });

  it('turns the device off without re-registering when it was removed elsewhere', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({ settings: SETTINGS, devices: [] });
    const record = registered();
    const outcome = await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY);
    expect(outcome).toBe('removed-elsewhere');
    expect(subscriptionCalls(server.calls)).toEqual([]);
    expect(server.state.devices).toEqual([]);
    expect(device.state.subscription).toBeNull();
    expect(record.current).toBeNull();
    // The next start stays off: nothing is sent.
    expect(await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY)).toBe(
      'not-opted-in',
    );
    expect(subscriptionCalls(server.calls)).toEqual([]);
  });

  it('clears the opt-in when the browser lost its subscription', async () => {
    const device = fakePushDevice({ permission: 'granted' });
    const server = fakePushServer();
    const record = registered();
    expect(await reconcilePush({ api: server.api, device, locale: 'en', record }, KEY)).toBe(
      'lost',
    );
    expect(record.current).toBeNull();
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions/revoke']);
  });

  it('stores a new time zone when the device moved', async () => {
    const device = fakePushDevice({
      permission: 'granted',
      subscribed: true,
      timeZone: 'Asia/Tokyo',
    });
    const server = fakePushServer({
      settings: {
        timeZone: 'America/Sao_Paulo',
        quietHours: { enabled: true, start: '21:00', end: '06:30' },
        quietIncludesMedicine: true,
        showNames: true,
      },
      devices: [LISTED_DEVICE],
    });
    await reconcilePush({ api: server.api, device, locale: 'en', record: registered() }, KEY);
    expect(server.state.settings).toEqual({
      timeZone: 'Asia/Tokyo',
      quietHours: { enabled: true, start: '21:00', end: '06:30' },
      quietIncludesMedicine: true,
      showNames: true,
    });
  });

  it('re-subscribes after a VAPID key change, without a prompt', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const old = device.state.subscription!;
    let unsubscribed = false;
    device.state.subscription = {
      ...old,
      applicationServerKey: base64UrlToBytes(OTHER_KEY).buffer,
      unsubscribe: async () => {
        unsubscribed = true;
        return true;
      },
    };
    const server = fakePushServer();
    const outcome = await reconcilePush(
      { api: server.api, device, locale: 'en', record: registered() },
      KEY,
    );
    expect(outcome).toBe('registered');
    expect(unsubscribed).toBe(true);
    expect(device.state.subscription).not.toBeNull();
    expect(device.prompts).toBe(0);
    expect(subscriptionCalls(server.calls)).toContain('POST /api/v1/push/subscriptions');
  });
});

describe('disablePush', () => {
  it('revokes the server row by endpoint (in the body), unsubscribes and clears the opt-in', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    const record = registered();
    await disablePush({ api: server.api, device, record });
    expect(server.calls).toEqual([
      {
        method: 'POST',
        path: '/api/v1/push/subscriptions/revoke',
        body: { endpoint: FAKE_ENDPOINT },
      },
    ]);
    expect(device.state.subscription).toBeNull();
    expect(record.current).toBeNull();
  });

  it('keeps the subscription and the opt-in when the server refused', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const record = registered();
    const api = {
      request: async () => {
        throw new ApiError(503, {});
      },
      requestWithMeta: async () => {
        throw new ApiError(503, {});
      },
    };
    await expect(disablePush({ api, device, record })).rejects.toBeInstanceOf(ApiError);
    expect(device.state.subscription).not.toBeNull();
    expect(record.current).not.toBeNull();
  });
});

describe('signOutPushDevice', () => {
  it('revokes on the server, unsubscribes and clears the opt-in', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    const record = registered();
    await signOutPushDevice(server.api, device, true, record);
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions/revoke']);
    expect(device.state.subscription).toBeNull();
    expect(record.current).toBeNull();
  });

  it('only unsubscribes locally while offline', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    await signOutPushDevice(server.api, device, false, memoryPushDeviceRecord());
    expect(server.calls).toEqual([]);
    expect(device.state.subscription).toBeNull();
  });

  it('never throws, even when the server call fails', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const api = {
      request: async () => {
        throw new TypeError('Failed to fetch');
      },
      requestWithMeta: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    await expect(
      signOutPushDevice(api, device, true, memoryPushDeviceRecord()),
    ).resolves.toBeUndefined();
    expect(device.state.subscription).toBeNull();
  });

  it('does nothing on a browser without push', async () => {
    const device = fakePushDevice({ support: 'unsupported' });
    const server = fakePushServer();
    await signOutPushDevice(server.api, device, true, memoryPushDeviceRecord());
    expect(server.calls).toEqual([]);
  });
});
