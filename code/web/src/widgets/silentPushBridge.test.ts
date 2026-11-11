import { afterEach, describe, expect, it, vi } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { nativeSilentPush, REMOTE_CHANGE_EVENT } from './silentPushBridge';

/*
 * The iOS side of the widgets' silent push goes through the app's WebKit message handler `lotties`; the Android side
 * through the `LottiesShared` Capacitor plugin (LottiesSharedPlugin.kt), faked here with the answers it gives.
 */

const android = vi.hoisted(() => {
  const remove = vi.fn(async () => {});
  const listeners: (() => void)[] = [];
  return {
    remove,
    fire: () => listeners.forEach((listener) => listener()),
    plugin: {
      widgetsInstalled: vi.fn(async (): Promise<{ installed?: boolean }> => ({ installed: true })),
      pushToken: vi.fn(async (): Promise<Record<string, unknown>> => ({
        channel: 'fcm',
        token: 'f1:APA91b-x_y',
      })),
      silentPushDone: vi.fn<(options: { changed: boolean }) => Promise<void>>(async () => {}),
      addListener: vi.fn(async (_event: string, listener: () => void) => {
        listeners.push(listener);
        return { remove };
      }),
    },
  };
});

vi.mock('@capacitor/core', () => ({ registerPlugin: () => android.plugin }));

type Scope = { webkit?: { messageHandlers?: Record<string, { postMessage: unknown }> } };

function fakeHandler(answer: (message: { method: string }) => unknown) {
  const postMessage = vi.fn(async (message: { method: string }) => answer(message));
  (window as unknown as Scope).webkit = { messageHandlers: { lotties: { postMessage } } };
  return postMessage;
}

afterEach(() => {
  delete (window as unknown as Scope).webkit;
});

describe('nativeSilentPush.channel', () => {
  it('names the push service of the platform without calling the native layer', () => {
    const undoIos = pretendNativeApp('ios');
    expect(nativeSilentPush.channel()).toBe('apns');
    undoIos();
    const undoAndroid = pretendNativeApp('android');
    expect(nativeSilentPush.channel()).toBe('fcm');
    undoAndroid();

    expect(nativeSilentPush.channel()).toBeNull();
    expect(android.plugin.pushToken).not.toHaveBeenCalled();
    expect(android.plugin.widgetsInstalled).not.toHaveBeenCalled();
  });
});

describe('nativeSilentPush on iOS', () => {
  it('asks the handler whether a widget is installed', async () => {
    const post = fakeHandler(() => true);

    expect(await nativeSilentPush.widgetsInstalled()).toBe(true);
    expect(post).toHaveBeenCalledWith({ method: 'widgetsInstalled' });
  });

  it('reads the APNs token the handler reports, and nothing without one', async () => {
    fakeHandler(() => ({ channel: 'apns', token: 'ab12', apnsEnvironment: 'sandbox' }));
    expect(await nativeSilentPush.pushToken()).toEqual({
      channel: 'apns',
      token: 'ab12',
      apnsEnvironment: 'sandbox',
    });

    fakeHandler(() => undefined);
    expect(await nativeSilentPush.pushToken()).toBeNull();
  });

  it('tells the handler a ping was handled', async () => {
    const post = fakeHandler(() => 'ok');

    await nativeSilentPush.remoteChangeDone(true);

    expect(post).toHaveBeenCalledWith({ method: 'silentPushDone', changed: true });
  });

  it('hears the window event the app dispatches, until stopped', () => {
    fakeHandler(() => 'ok');
    const listener = vi.fn();
    const stop = nativeSilentPush.onRemoteChange(listener);

    window.dispatchEvent(new CustomEvent(REMOTE_CHANGE_EVENT));
    stop();
    window.dispatchEvent(new CustomEvent(REMOTE_CHANGE_EVENT));

    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('nativeSilentPush on Android', () => {
  it('asks the plugin whether a widget is installed', async () => {
    expect(await nativeSilentPush.widgetsInstalled()).toBe(true);

    android.plugin.widgetsInstalled.mockResolvedValueOnce({ installed: false });
    expect(await nativeSilentPush.widgetsInstalled()).toBe(false);
  });

  it('reads the FCM token, and nothing when the build or the phone has no Firebase', async () => {
    expect(await nativeSilentPush.pushToken()).toEqual({ channel: 'fcm', token: 'f1:APA91b-x_y' });

    android.plugin.pushToken.mockResolvedValueOnce({});
    expect(await nativeSilentPush.pushToken()).toBeNull();
  });

  it('tells the plugin a ping was handled', async () => {
    await nativeSilentPush.remoteChangeDone(false);

    expect(android.plugin.silentPushDone).toHaveBeenCalledWith({ changed: false });
  });

  it('hears the plugin event, until stopped', async () => {
    const listener = vi.fn();
    const stop = nativeSilentPush.onRemoteChange(listener);
    await vi.waitFor(() =>
      expect(android.plugin.addListener).toHaveBeenCalledWith('remoteChange', listener),
    );

    android.fire();
    stop();

    expect(listener).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(android.remove).toHaveBeenCalled());
  });
});
