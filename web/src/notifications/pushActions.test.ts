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

const KEY = 'BFakeKey';
const OTHER_KEY = 'AOtherKe';

const subscriptionCalls = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

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
  it('stores the time zone first, then subscribes and registers the device', async () => {
    const device = fakePushDevice({ permission: 'granted', timeZone: 'Europe/Lisbon' });
    const server = fakePushServer();
    const id = await enablePush(
      { api: server.api, device, locale: 'pt-BR', deviceLabel: 'Chrome no Android' },
      KEY,
    );

    expect(id).toBe('this-device');
    expect(thisDeviceId(FAKE_ENDPOINT)).toBe('this-device');
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
});

describe('reconcilePush', () => {
  it('leaves the device off when the browser has no subscription', async () => {
    const device = fakePushDevice({ permission: 'granted' });
    const server = fakePushServer();
    expect(await reconcilePush({ api: server.api, device, locale: 'en' }, KEY)).toBeNull();
    expect(server.calls).toEqual([]);
  });

  it('refreshes the server row and keeps a matching time zone', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer({
      settings: {
        timeZone: 'America/Sao_Paulo',
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
        quietIncludesMedicine: false,
        showNames: false,
      },
    });
    await reconcilePush({ api: server.api, device, locale: 'en' }, KEY);
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions']);
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
    });
    await reconcilePush({ api: server.api, device, locale: 'en' }, KEY);
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
    await reconcilePush({ api: server.api, device, locale: 'en' }, KEY);
    expect(unsubscribed).toBe(true);
    expect(device.state.subscription).not.toBeNull();
    expect(device.prompts).toBe(0);
    expect(subscriptionCalls(server.calls)).toContain('POST /api/v1/push/subscriptions');
  });
});

describe('disablePush', () => {
  it('revokes the server row by endpoint (in the body), then unsubscribes', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    await disablePush({ api: server.api, device });
    expect(server.calls).toEqual([
      {
        method: 'POST',
        path: '/api/v1/push/subscriptions/revoke',
        body: { endpoint: FAKE_ENDPOINT },
      },
    ]);
    expect(device.state.subscription).toBeNull();
  });

  it('keeps the subscription when the server refused', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const api = {
      request: async () => {
        throw new ApiError(503, {});
      },
      requestWithMeta: async () => {
        throw new ApiError(503, {});
      },
    };
    await expect(disablePush({ api, device })).rejects.toBeInstanceOf(ApiError);
    expect(device.state.subscription).not.toBeNull();
  });
});

describe('signOutPushDevice', () => {
  it('revokes on the server, then unsubscribes', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    await signOutPushDevice(server.api, device, true);
    expect(subscriptionCalls(server.calls)).toEqual(['POST /api/v1/push/subscriptions/revoke']);
    expect(device.state.subscription).toBeNull();
  });

  it('only unsubscribes locally while offline', async () => {
    const device = fakePushDevice({ permission: 'granted', subscribed: true });
    const server = fakePushServer();
    await signOutPushDevice(server.api, device, false);
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
    await expect(signOutPushDevice(api, device, true)).resolves.toBeUndefined();
    expect(device.state.subscription).toBeNull();
  });

  it('does nothing on a browser without push', async () => {
    const device = fakePushDevice({ support: 'unsupported' });
    const server = fakePushServer();
    await signOutPushDevice(server.api, device, true);
    expect(server.calls).toEqual([]);
  });
});
