import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRY_SENSITIVITY_THRESHOLDS } from '../cry/sensitivity';
import type { ShownNotification } from '../notifications/pushDevice';
import { notificationTag } from '../pwa/sw/notificationOptions';
import { clearAccountDeviceState } from '../session/deviceState';
import { detectInstallPlatform } from '../install/installPlatform';
import { METER_THRESHOLDS, deniedStepsFor, meterFill, wakeLockNoteKey } from './monitorView';
import { closeCryNotifications } from './monitorNotifications';
import {
  CRY_MONITOR_CONSENT_VERSION,
  SENSITIVITIES,
  clearCryMonitorConsent,
  hasCurrentConsent,
  readConsent,
  readSensitivity,
  writeConsent,
  writeSensitivity,
} from './monitorStorage';
import { ScreenWakeLock, type WakeLockEnvironment, type WakeLockStatus } from './screenWakeLock';
import { detectCryMonitorSupport } from './support';

const CONSENT_KEY = 'lotties.cry-monitor.consent';

beforeEach(() => window.localStorage.clear());

describe('consent on this device', () => {
  it('is absent until given, then stored with its version and time', () => {
    expect(readConsent()).toBeNull();
    expect(hasCurrentConsent()).toBe(false);
    const at = new Date('2026-10-24T21:40:00Z');
    writeConsent(at);
    expect(readConsent()).toEqual({ version: CRY_MONITOR_CONSENT_VERSION, at: at.toISOString() });
    expect(hasCurrentConsent()).toBe(true);
  });

  it('is asked again when the consent text version changes', () => {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ version: CRY_MONITOR_CONSENT_VERSION - 1, at: '2026-10-01T00:00:00Z' }),
    );
    expect(readConsent()?.version).toBe(CRY_MONITOR_CONSENT_VERSION - 1);
    expect(hasCurrentConsent()).toBe(false);
  });

  it('ignores a damaged entry', () => {
    for (const raw of [
      'not json',
      '[]',
      '{"version":"1","at":"x"}',
      '{"version":1,"at":"never"}',
    ]) {
      window.localStorage.setItem(CONSENT_KEY, raw);
      expect(readConsent(), raw).toBeNull();
    }
  });

  it('is withdrawn on this page and cleared with the account at sign-out', () => {
    writeConsent();
    clearCryMonitorConsent();
    expect(hasCurrentConsent()).toBe(false);
    writeConsent();
    writeSensitivity('more');
    clearAccountDeviceState();
    expect(hasCurrentConsent()).toBe(false);
    // The sensitivity is a device preference, like the theme: it stays.
    expect(readSensitivity()).toBe('more');
  });
});

describe('sensitivity on this device', () => {
  it('defaults to Balanced and keeps a valid choice only', () => {
    expect(readSensitivity()).toBe('balanced');
    writeSensitivity('less');
    expect(readSensitivity()).toBe('less');
    window.localStorage.setItem('lotties.cry-monitor.sensitivity', 'loud');
    expect(readSensitivity()).toBe('balanced');
  });

  it('offers the engine levels, and the meter uses the engine thresholds', () => {
    expect([...SENSITIVITIES].sort()).toEqual(Object.keys(CRY_SENSITIVITY_THRESHOLDS).sort());
    expect(METER_THRESHOLDS).toEqual(CRY_SENSITIVITY_THRESHOLDS);
    expect(meterFill(0, 'balanced')).toBe(0);
    expect(meterFill(0.02, 'balanced')).toBe(0.5);
    expect(meterFill(0.02, 'more')).toBe(1);
    expect(meterFill(Number.NaN, 'less')).toBe(0);
  });
});

describe('platform wording', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const FIREFOX =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const DESKTOP_CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  it('picks the microphone steps and the screen note for the device', () => {
    expect(deniedStepsFor(detectInstallPlatform(IPHONE, 5))).toBe('iosSafari');
    expect(deniedStepsFor(detectInstallPlatform(ANDROID, 5))).toBe('chromium');
    expect(deniedStepsFor(detectInstallPlatform(FIREFOX))).toBe('firefox');
    expect(deniedStepsFor(detectInstallPlatform(MAC_SAFARI))).toBe('macSafari');
    expect(deniedStepsFor(detectInstallPlatform(DESKTOP_CHROME))).toBe('chromium');
    expect(wakeLockNoteKey(detectInstallPlatform(IPHONE, 5))).toBe(
      'cryMonitor.listening.wakeLock.ios',
    );
    expect(wakeLockNoteKey(detectInstallPlatform(ANDROID, 5))).toBe(
      'cryMonitor.listening.wakeLock.android',
    );
    expect(wakeLockNoteKey(detectInstallPlatform(DESKTOP_CHROME))).toBe(
      'cryMonitor.listening.wakeLock.generic',
    );
  });
});

describe('feature detection', () => {
  const full = {
    getUserMedia: () => undefined,
    AudioWorkletNode: function AudioWorkletNode() {},
    WebAssembly: {},
    Worker: function Worker() {},
  };

  it('needs the microphone API, an AudioWorklet, WebAssembly and workers', () => {
    expect(detectCryMonitorSupport(full)).toBe(true);
    for (const missing of ['getUserMedia', 'AudioWorkletNode', 'WebAssembly', 'Worker'] as const) {
      expect(detectCryMonitorSupport({ ...full, [missing]: undefined }), missing).toBe(false);
    }
  });

  it('says no in this test browser (no microphone API)', async () => {
    const { cryMonitorSupported, resetCryMonitorSupport } = await import('./support');
    resetCryMonitorSupport();
    expect(cryMonitorSupported()).toBe(false);
  });
});

/** A controllable Wake Lock API and page visibility. */
function wakeLockFake(options: { supported?: boolean; refuse?: boolean } = {}) {
  let visible: DocumentVisibilityState = 'visible';
  const listeners = new Set<() => void>();
  const sentinels: { released: boolean; release: () => Promise<void> }[] = [];
  const request = vi.fn(async () => {
    if (options.refuse) throw new DOMException('refused', 'NotAllowedError');
    const sentinel = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  const env: WakeLockEnvironment = {
    wakeLock: options.supported === false ? undefined : { request },
    visibility: () => visible,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setVisible = (value: DocumentVisibilityState) => {
    visible = value;
    for (const listener of listeners) listener();
  };
  return { env, request, sentinels, setVisible, listeners };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('screen wake lock', () => {
  it('requests the lock on start and releases it on stop', async () => {
    const fake = wakeLockFake();
    const statuses: WakeLockStatus[] = [];
    const lock = new ScreenWakeLock(fake.env, (s) => statuses.push(s));
    lock.start();
    await settle();
    expect(fake.request).toHaveBeenCalledWith('screen');
    expect(lock.status).toBe('on');
    lock.stop();
    expect(fake.sentinels[0].released).toBe(true);
    expect(fake.listeners.size).toBe(0);
    expect(statuses).toEqual(['on', 'off']);
  });

  it('requests it again when the page comes back (the browser released it while hidden)', async () => {
    const fake = wakeLockFake();
    const lock = new ScreenWakeLock(fake.env, () => undefined);
    lock.start();
    await settle();
    fake.sentinels[0].released = true; // the browser dropped it
    fake.setVisible('hidden');
    expect(fake.request).toHaveBeenCalledTimes(1);
    fake.setVisible('visible');
    await settle();
    expect(fake.request).toHaveBeenCalledTimes(2);
    expect(lock.status).toBe('on');
    // Still held: a visibility change asks nothing more.
    fake.setVisible('visible');
    await settle();
    expect(fake.request).toHaveBeenCalledTimes(2);
    lock.stop();
  });

  it('reports unsupported and denied for the page warning', async () => {
    const none = new ScreenWakeLock(wakeLockFake({ supported: false }).env, () => undefined);
    none.start();
    expect(none.status).toBe('unsupported');
    const refused = new ScreenWakeLock(wakeLockFake({ refuse: true }).env, () => undefined);
    refused.start();
    await settle();
    expect(refused.status).toBe('denied');
    refused.stop();
    expect(refused.status).toBe('off');
  });

  it('releases a lock that arrives after stop', async () => {
    const fake = wakeLockFake();
    const lock = new ScreenWakeLock(fake.env, () => undefined);
    lock.start();
    lock.stop();
    await settle();
    expect(fake.sentinels[0].released).toBe(true);
    expect(lock.status).toBe('off');
  });
});

describe("closing this device's cry alerts", () => {
  const BABY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const shown = (tag: string): ShownNotification & { closed: boolean } => {
    const n = {
      tag,
      data: null,
      closed: false,
      close: () => {
        n.closed = true;
      },
    };
    return n;
  };

  afterEach(() => vi.restoreAllMocks());

  it("closes the baby's cry alert by its tag and nothing else", async () => {
    const tag = notificationTag({
      v: 1,
      id: 'd1',
      kind: 'cry_detected',
      babyId: BABY,
      at: Date.UTC(2026, 9, 24, 21, 40),
      lang: 'en',
    } as Parameters<typeof notificationTag>[0]);
    expect(tag).toBe('cry:7c9e6679742540de944be07fc1f90ae7');
    const list = [shown(tag), shown('cry:other'), shown('fussy:7c9e6679742540de944be07fc1f90ae7')];
    const closed = await closeCryNotifications({ shownNotifications: async () => list }, BABY);
    expect(closed).toBe(1);
    expect(list.map((n) => n.closed)).toEqual([true, false, false]);
  });

  it('never throws when the browser cannot list notifications', async () => {
    const closed = await closeCryNotifications(
      {
        shownNotifications: async () => {
          throw new Error('no service worker');
        },
      },
      BABY,
    );
    expect(closed).toBe(0);
  });
});
