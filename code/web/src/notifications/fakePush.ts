import { ApiError } from '../api/ApiError';
import type { ApiClient, RequestOptions } from '../api/apiClient';
import type { BrowserPermission } from './permissionState';
import type {
  BabyPreferencesDto,
  NotificationSettingsDto,
  PushDeviceDto,
  ReminderPreferences,
} from './pushApi';
import type { DeviceSubscription, PushDevice } from './pushDevice';
import type { PushSupport } from './pushSupport';

/*
 * In-memory push for tests and the developer preview: a fake browser (permission, subscription)
 * and a fake server (settings, preferences, devices). Never used by the app itself.
 */

export const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/fake-endpoint';

export interface FakeDeviceOptions {
  support?: PushSupport;
  permission?: BrowserPermission;
  /** What the prompt answers. */
  answer?: BrowserPermission;
  subscribed?: boolean;
  timeZone?: string;
}

export interface FakePushDevice extends PushDevice {
  state: {
    permission: BrowserPermission;
    subscription: DeviceSubscription | null;
    /** Notifications currently shown by the worker (`data` is the wire payload). */
    shown: { tag: string; data: unknown }[];
  };
  prompts: number;
}

export function fakePushDevice(options: FakeDeviceOptions = {}): FakePushDevice {
  const makeSubscription = (key: ArrayBuffer | null = null): DeviceSubscription => ({
    endpoint: FAKE_ENDPOINT,
    applicationServerKey: key,
    toJSON: () => ({
      endpoint: FAKE_ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'BFakeP256dh', auth: 'fakeAuth' },
    }),
    unsubscribe: async () => {
      device.state.subscription = null;
      return true;
    },
  });
  const device: FakePushDevice = {
    state: {
      permission: options.permission ?? 'default',
      subscription: null,
      shown: [],
    },
    prompts: 0,
    support: () => options.support ?? 'supported',
    permission: () => device.state.permission,
    requestPermission: async () => {
      device.prompts += 1;
      device.state.permission = options.answer ?? 'granted';
      return device.state.permission;
    },
    getSubscription: async () => device.state.subscription,
    subscribe: async () => {
      device.state.subscription = makeSubscription();
      return device.state.subscription;
    },
    shownNotifications: async () =>
      device.state.shown.map((shown) => ({
        ...shown,
        close: () => {
          device.state.shown = device.state.shown.filter((other) => other !== shown);
        },
      })),
    timeZone: () => options.timeZone ?? 'America/Sao_Paulo',
    parts: () => ({ browser: 'Chrome', os: 'Android' }),
  };
  if (options.subscribed) device.state.subscription = makeSubscription();
  return device;
}

export interface FakePushServerState {
  settings: NotificationSettingsDto;
  preferences: BabyPreferencesDto[];
  devices: PushDeviceDto[];
  /** Snoozes per delivery id, and the dismissed delivery ids. */
  snoozes: Record<string, number>;
  dismissed: string[];
}

export const DEFAULT_PUSH_SETTINGS: NotificationSettingsDto = {
  timeZone: null,
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  quietIncludesMedicine: false,
  showNames: false,
};

export interface FakePushCall {
  method: string;
  path: string;
  body?: unknown;
}

/** A scripted push API over in-memory state; records every call. */
export function fakePushServer(initial: Partial<FakePushServerState> = {}) {
  const state: FakePushServerState = {
    settings: initial.settings ?? DEFAULT_PUSH_SETTINGS,
    preferences: initial.preferences ?? [],
    devices: initial.devices ?? [],
    snoozes: initial.snoozes ?? {},
    dismissed: initial.dismissed ?? [],
  };
  const calls: FakePushCall[] = [];

  function handle(method: string, path: string, body: unknown): unknown {
    if (path.endsWith('/push/config')) return { enabled: true, publicKey: 'BFakeKey' };
    const action = /push\/deliveries\/([^/]+)\/actions$/.exec(path);
    if (action) {
      const id = decodeURIComponent(action[1]);
      if ((body as { action: string }).action === 'dismiss') {
        state.dismissed = [...state.dismissed, id];
        return undefined;
      }
      const count = (state.snoozes[id] ?? 0) + 1;
      if (count > 3) throw new ApiError(409, { code: 'snooze_limit_reached' });
      state.snoozes = { ...state.snoozes, [id]: count };
      return undefined;
    }
    if (path.endsWith('/push/settings')) {
      if (method === 'PUT') state.settings = body as NotificationSettingsDto;
      return state.settings;
    }
    if (path.endsWith('/push/preferences')) return state.preferences;
    const prefs = /babies\/([^/]+)\/notification-preferences$/.exec(path);
    if (prefs) {
      const babyId = decodeURIComponent(prefs[1]);
      const stored = { babyId, canReceive: true, ...(body as ReminderPreferences) };
      state.preferences = [...state.preferences.filter((p) => p.babyId !== babyId), stored];
      return stored;
    }
    if (path.endsWith('/push/subscriptions/revoke')) return undefined;
    if (path.endsWith('/push/test')) {
      return { results: state.devices.map((d) => ({ subscriptionId: d.id, status: 'sent' })) };
    }
    if (path.endsWith('/push/subscriptions')) {
      if (method === 'POST') {
        const now = new Date().toISOString();
        const request = body as { deviceLabel?: string; locale: string };
        const existing = state.devices.find((d) => d.id === 'this-device');
        const device: PushDeviceDto = {
          id: 'this-device',
          deviceLabel: request.deviceLabel ?? null,
          locale: request.locale,
          createdAt: existing?.createdAt ?? now,
          lastSeenAt: now,
          lastSuccessAt: null,
        };
        state.devices = [device, ...state.devices.filter((d) => d.id !== device.id)];
        return device;
      }
      return state.devices;
    }
    const one = /push\/subscriptions\/([^/]+)$/.exec(path);
    if (one && method === 'DELETE') {
      state.devices = state.devices.filter((d) => d.id !== decodeURIComponent(one[1]));
      return undefined;
    }
    return undefined;
  }

  async function requestWithMeta<T>(path: string, options: RequestOptions = {}) {
    const method = options.method ?? 'GET';
    calls.push({ method, path, body: options.body });
    const data = handle(method, path, options.body) as T;
    return { data, status: 200, headers: new Headers() };
  }

  const api: ApiClient = {
    requestWithMeta,
    request: async <T>(path: string, options?: RequestOptions) =>
      (await requestWithMeta<T>(path, options)).data,
  };
  return { api, calls, state };
}
