import { afterEach, describe, expect, it, vi } from 'vitest';
import { pretendNativeApp } from '../platform/nativeTestKit';
import { setVoicePluginForTests, type LottiesVoicePlugin } from './androidVoiceBridge';
import { siriBridge, voiceKind } from './siriBridge';

/* Voice on Android: siriBridge delegates to the LottiesVoice plugin (a fake here) on Android only. */

let undo: (() => void) | undefined;

afterEach(() => {
  undo?.();
  undo = undefined;
  setVoicePluginForTests(null);
});

function fakePlugin(): LottiesVoicePlugin & { connected: boolean } {
  const fake = {
    connected: false,
    status: vi.fn(async () => ({ connected: fake.connected })),
    connect: vi.fn(async () => {
      fake.connected = true;
      return { connected: true };
    }),
    disconnect: vi.fn(async () => {
      fake.connected = false;
      return { connected: false };
    }),
  };
  return fake;
}

describe('Voice on Android bridge', () => {
  it('is Android voice only in the Android app', () => {
    expect(voiceKind()).toBeNull();
    expect(siriBridge.available()).toBe(false);
    undo = pretendNativeApp('android');
    expect(voiceKind()).toBe('android');
    expect(siriBridge.available()).toBe(true);
  });

  it('connects with the Android client and the server values, then disconnects', async () => {
    undo = pretendNativeApp('android');
    const plugin = fakePlugin();
    setVoicePluginForTests(plugin);

    expect(await siriBridge.status()).toBe(false);
    expect(
      await siriBridge.connect('https://auth.test/realms/x', 'https://lotties.test/api/v1/mcp'),
    ).toBe(true);
    expect(plugin.connect).toHaveBeenCalledWith({
      authority: 'https://auth.test/realms/x',
      clientId: 'lotties-android',
      mcpUrl: 'https://lotties.test/api/v1/mcp',
    });
    expect(await siriBridge.status()).toBe(true);
    await siriBridge.disconnect();
    expect(await siriBridge.status()).toBe(false);
  });

  it('a cancelled sign-in is not connected', async () => {
    undo = pretendNativeApp('android');
    const plugin = fakePlugin();
    vi.mocked(plugin.connect).mockResolvedValueOnce({ connected: false });
    setVoicePluginForTests(plugin);
    expect(await siriBridge.connect('https://auth.test', 'https://lotties.test/mcp')).toBe(false);
  });

  it('never calls the Android plugin outside Android', async () => {
    undo = pretendNativeApp('ios');
    const plugin = fakePlugin();
    setVoicePluginForTests(plugin);
    expect(await siriBridge.status()).toBe(false); // no WebKit handler in the test DOM
    expect(plugin.status).not.toHaveBeenCalled();
  });

  it('works with a Capacitor plugin proxy whose `then` is a native call that never answers', async () => {
    // registerPlugin's proxy turns `.then` into a call to a native method "then"; resolving a promise with the proxy
    // itself would wait for it forever (the Connect button stayed grey).
    const proxy = {
      then: vi.fn(() => undefined),
      status: vi.fn(async () => ({ connected: true })),
    };
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({ registerPlugin: () => proxy }));
    try {
      const fresh = await import('./androidVoiceBridge');
      expect(await fresh.androidVoiceBridge.status()).toBe(true);
      expect(proxy.then).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@capacitor/core');
      vi.resetModules();
    }
  });
});
