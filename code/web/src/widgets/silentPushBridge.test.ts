import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSilentPush, REMOTE_CHANGE_EVENT } from './silentPushBridge';

/* The iOS side of the widgets' silent push goes through the app's WebKit message handler `lotties`. */

type Scope = { webkit?: { messageHandlers?: Record<string, { postMessage: unknown }> } };

function fakeHandler(answer: (message: { method: string }) => unknown) {
  const postMessage = vi.fn(async (message: { method: string }) => answer(message));
  (window as unknown as Scope).webkit = { messageHandlers: { lotties: { postMessage } } };
  return postMessage;
}

afterEach(() => {
  delete (window as unknown as Scope).webkit;
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
