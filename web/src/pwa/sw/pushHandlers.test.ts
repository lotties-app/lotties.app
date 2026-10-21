import { describe, expect, it, vi } from 'vitest';
import {
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
  registerPushHandlers,
  type PushHandlerDeps,
  type WindowClientLike,
} from './pushHandlers';
import { BABY_ID, DELIVERY_ID, dosePayload, RX_ID, TOKEN } from './pushTestKit';
import { buildNotification } from './notificationOptions';
import { validatePayload } from './payload';

const ORIGIN = 'https://lotties.example';

function fakeDeps(
  options: {
    windows?: WindowClientLike[];
    language?: string;
    showNotification?: (title: string, options?: unknown) => Promise<void>;
  } = {},
) {
  const listeners = new Map<string, (event: Event) => void>();
  const showNotification = vi.fn(options.showNotification ?? (() => Promise.resolve()));
  const subscribe = vi.fn().mockResolvedValue({});
  const openWindow = vi.fn().mockResolvedValue(null);
  const matchAll = vi.fn().mockResolvedValue(options.windows ?? []);
  const fetchFn = vi.fn().mockResolvedValue({ ok: true });
  const deps: PushHandlerDeps = {
    scope: {
      location: { origin: ORIGIN },
      navigator: { language: options.language ?? 'en-US' },
      registration: { showNotification, pushManager: { subscribe } },
      clients: { matchAll, openWindow },
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    fetch: fetchFn,
    apiBaseUrl: 'https://api.example',
    timeZone: 'UTC',
  };
  return { deps, listeners, showNotification, subscribe, openWindow, matchAll, fetchFn };
}

const message = (value: unknown) => ({ text: () => JSON.stringify(value) });

const notificationFor = (value: Record<string, unknown>) => {
  const { options } = buildNotification(validatePayload(value), 'UTC');
  return { data: options.data, close: vi.fn() };
};

const fakeWindow = (url: string, focus = vi.fn().mockResolvedValue(undefined)) => ({
  url,
  focus,
  postMessage: vi.fn(),
});

describe('push event', () => {
  it('shows the rendered notification with its tag', async () => {
    const { deps, showNotification } = fakeDeps();
    await handlePush(deps, message(dosePayload({ lang: 'pt-BR' })));
    expect(showNotification).toHaveBeenCalledWith(
      'Lembrete de remédio',
      expect.objectContaining({
        tag: `dose:${RX_ID.replace(/-/g, '')}:202610212100`,
        body: 'Uma dose agendada para 21:00 ainda não foi registrada.',
      }),
    );
  });

  it.each([
    ['no data', null],
    [
      'unreadable data',
      {
        text: () => {
          throw new Error('bad');
        },
      },
    ],
    ['broken JSON', { text: () => '{' }],
    ['an unknown kind', message({ v: 1, kind: 'x' })],
  ])('shows generic text in the device language for %s', async (_, data) => {
    const { deps, showNotification } = fakeDeps({ language: 'pt-BR' });
    await handlePush(deps, data);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      'Lotties',
      expect.objectContaining({ body: 'Abra o app para ver os detalhes.', lang: 'pt-BR' }),
    );
  });

  it('retries with generic text when the browser rejects the options', async () => {
    const show = vi
      .fn<(title: string, options?: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('renotify needs a tag'))
      .mockResolvedValue(undefined);
    const { deps, showNotification } = fakeDeps({ showNotification: show });
    await handlePush(deps, message(dosePayload({ snooze: 1 })));
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[1][0]).toBe('Lotties');
    expect(showNotification.mock.calls[1][1]).not.toHaveProperty('tag');
  });

  it('never rejects, even when nothing can be shown', async () => {
    const { deps } = fakeDeps({ showNotification: () => Promise.reject(new Error('no')) });
    await expect(handlePush(deps, message(dosePayload()))).resolves.toBeUndefined();
  });
});

describe('notificationclick event', () => {
  it('snoozes through the API and opens nothing', async () => {
    const { deps, fetchFn, openWindow } = fakeDeps();
    const notification = notificationFor(dosePayload());
    await handleNotificationClick(deps, 'snooze', notification);
    expect(notification.close).toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.example/api/v1/push/deliveries/${DELIVERY_ID}/actions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'snooze', token: TOKEN }),
      }),
    );
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('focuses an open app window and posts the open message', async () => {
    const other = fakeWindow('https://elsewhere.example/');
    const app = fakeWindow(`${ORIGIN}/day`);
    const { deps, openWindow } = fakeDeps({ windows: [other, app] });
    await handleNotificationClick(deps, '', notificationFor(dosePayload()));
    expect(other.focus).not.toHaveBeenCalled();
    expect(app.focus).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification-open', babyId: BABY_ID, rxId: RX_ID }),
    );
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens the deep link when no app window is open or focus fails', async () => {
    const refused = fakeWindow(`${ORIGIN}/`, vi.fn().mockRejectedValue(new Error('no gesture')));
    for (const windows of [[], [refused]]) {
      const { deps, openWindow } = fakeDeps({ windows });
      await handleNotificationClick(deps, 'open', notificationFor(dosePayload()));
      expect(openWindow).toHaveBeenCalledWith(
        `${ORIGIN}/#notify=dose&baby=${BABY_ID}&rx=${RX_ID}&d=${DELIVERY_ID}&t=${TOKEN}`,
      );
    }
  });

  it('opens the app root for malformed data and never throws', async () => {
    const { deps, openWindow } = fakeDeps();
    await handleNotificationClick(deps, 'snooze', {
      data: { url: 'https://evil.example' },
      close: vi.fn(),
    });
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);

    const broken = fakeDeps();
    broken.matchAll.mockRejectedValue(new Error('gone'));
    await expect(
      handleNotificationClick(broken.deps, '', notificationFor(dosePayload())),
    ).resolves.toBeUndefined();
  });
});

describe('pushsubscriptionchange event', () => {
  const key = new Uint8Array([4, 1, 2]).buffer;

  it('re-subscribes with the old key when there is no new subscription', async () => {
    const { deps, subscribe } = fakeDeps();
    await handleSubscriptionChange(deps, {
      oldSubscription: { options: { applicationServerKey: key } },
    });
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
  });

  it('does nothing when the browser already re-subscribed or the key is unknown', async () => {
    const { deps, subscribe } = fakeDeps();
    await handleSubscriptionChange(deps, {
      oldSubscription: { options: { applicationServerKey: key } },
      newSubscription: {},
    });
    await handleSubscriptionChange(deps, { oldSubscription: null });
    await handleSubscriptionChange(deps, {});
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('swallows subscribe failures', async () => {
    const { deps, subscribe } = fakeDeps();
    subscribe.mockRejectedValue(new Error('permission revoked'));
    await expect(
      handleSubscriptionChange(deps, {
        oldSubscription: { options: { applicationServerKey: key } },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('registerPushHandlers', () => {
  it('wires the three events and keeps the worker alive with waitUntil', async () => {
    const { deps, listeners, showNotification } = fakeDeps();
    registerPushHandlers(deps);
    expect([...listeners.keys()].sort()).toEqual([
      'notificationclick',
      'push',
      'pushsubscriptionchange',
    ]);

    const waitUntil = vi.fn();
    listeners.get('push')!({ data: message(dosePayload()), waitUntil } as unknown as Event);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});
