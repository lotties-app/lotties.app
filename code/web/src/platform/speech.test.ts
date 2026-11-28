import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setSpeechPluginForTests,
  speechErrorCode,
  speechPlatform,
  type LottiesSpeechPlugin,
} from './speech';
import type { ListenState } from './speechTypes';

/* The speech platform: the LottiesSpeech plugin inside the app, the web engine only in a browser. */

function fakePlugin(overrides: Partial<LottiesSpeechPlugin> = {}) {
  const listeners: ((event: { state?: string }) => void)[] = [];
  const removed = vi.fn(async () => undefined);
  const plugin: LottiesSpeechPlugin = {
    capabilities: vi.fn(async () => ({
      platform: 'android',
      osVersion: '14 (API 34)',
      recognitionAvailable: true,
      onDeviceAvailable: true,
      onDeviceReason: null,
      languageInstalled: false,
      languageDownloadable: true,
      languagePending: false,
      canDownload: true,
      biasing: true,
      microphonePermission: 'prompt',
      speechPermission: 'not_needed',
    })),
    listenOnce: vi.fn(async () => {
      for (const listener of listeners) listener({ state: 'ready' });
      for (const listener of listeners) listener({ state: 'bogus' });
      return {
        alternatives: ['dormiu', 'dormi'],
        confidences: [0.8, -1],
        startedAt: 10,
        endOfSpeechAt: 900,
        resultAt: 1200,
        onDevice: true,
      };
    }),
    cancel: vi.fn(async () => undefined),
    downloadModel: vi.fn(async () => ({ status: 'started' })),
    addListener: vi.fn(async (_name, listener) => {
      listeners.push(listener);
      return { remove: removed };
    }),
    ...overrides,
  };
  return { plugin, removed };
}

const inApp = (platform: 'android' | 'ios') =>
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => platform });

afterEach(() => {
  setSpeechPluginForTests(null);
  vi.unstubAllGlobals();
});

const REQUEST = { locale: 'pt-BR', hints: ['mamadeira'], maxResults: 5, timeoutMs: 15_000 };

describe('speech platform in the app', () => {
  it('maps what the plugin reports', async () => {
    inApp('android');
    const { plugin } = fakePlugin();
    setSpeechPluginForTests(plugin);
    const capabilities = await speechPlatform().capabilities('pt-BR');
    expect(plugin.capabilities).toHaveBeenCalledWith({ locale: 'pt-BR' });
    expect(capabilities).toMatchObject({
      platform: 'android',
      onDeviceAvailable: true,
      languageInstalled: false,
      languageDownloadable: true,
      canDownload: true,
      microphone: 'prompt',
      speech: 'not_needed',
    });
  });

  it('asks the plugin for on-device recognition only, with the hints, and forwards states', async () => {
    inApp('ios');
    const { plugin, removed } = fakePlugin();
    setSpeechPluginForTests(plugin);
    const states: ListenState[] = [];
    const engine = speechPlatform().engine();
    const result = await engine?.listen(REQUEST, (s) => states.push(s));
    expect(plugin.listenOnce).toHaveBeenCalledWith({
      locale: 'pt-BR',
      onDevice: true,
      hints: ['mamadeira'],
      maxResults: 5,
      timeoutMs: 15_000,
    });
    expect(result).toEqual({
      alternatives: ['dormiu', 'dormi'],
      confidences: [0.8, null],
      startedAt: 10,
      endOfSpeechAt: 900,
      resultAt: 1200,
      onDevice: true,
    });
    expect(states).toEqual(['starting', 'ready']);
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('never retries on the server when on-device fails: the error comes back as it is', async () => {
    inApp('android');
    const error = Object.assign(new Error('no on-device recogniser'), {
      code: 'on_device_unavailable',
    });
    const { plugin, removed } = fakePlugin({
      listenOnce: vi.fn(async () => Promise.reject(error)),
    });
    setSpeechPluginForTests(plugin);
    await expect(
      speechPlatform()
        .engine()
        ?.listen(REQUEST, () => undefined),
    ).rejects.toMatchObject({ code: 'on_device_unavailable' });
    expect(plugin.listenOnce).toHaveBeenCalledTimes(1);
    expect(plugin.listenOnce).toHaveBeenCalledWith(expect.objectContaining({ onDevice: true }));
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('uses no answer the plugin does not mark as recognised on the device', async () => {
    inApp('android');
    const { plugin } = fakePlugin({
      listenOnce: vi.fn(async () => ({ alternatives: ['dormiu'], onDevice: false })),
    });
    setSpeechPluginForTests(plugin);
    await expect(
      speechPlatform()
        .engine()
        ?.listen(REQUEST, () => undefined),
    ).rejects.toMatchObject({ code: 'not_supported' });
  });

  it('starts the language download and reads its status', async () => {
    inApp('android');
    const { plugin } = fakePlugin();
    setSpeechPluginForTests(plugin);
    await expect(speechPlatform().downloadModel('pt-BR')).resolves.toBe('started');
    expect(plugin.downloadModel).toHaveBeenCalledWith({ locale: 'pt-BR' });
  });
});

describe('speech platform in a browser', () => {
  it('has no engine at all (no Web Speech) and never loads the plugin', async () => {
    vi.stubGlobal('webkitSpeechRecognition', class {});
    const { plugin } = fakePlugin();
    setSpeechPluginForTests(plugin);
    const platform = speechPlatform();
    expect(platform.engine()).toBeNull();
    await expect(platform.capabilities('pt-BR')).resolves.toMatchObject({
      platform: 'web',
      onDeviceAvailable: false,
      onDeviceReason: 'no_native_app',
    });
    await expect(platform.downloadModel('pt-BR')).resolves.toBe('unsupported');
    expect(plugin.capabilities).not.toHaveBeenCalled();
  });
});

describe('speechErrorCode', () => {
  it('keeps known codes and folds everything else into recognizer_error', () => {
    expect(speechErrorCode({ code: 'denied' })).toBe('denied');
    expect(speechErrorCode({ code: 'EXOTIC' })).toBe('recognizer_error');
    expect(speechErrorCode(new Error('x'))).toBe('recognizer_error');
    expect(speechErrorCode(null)).toBe('recognizer_error');
  });
});
