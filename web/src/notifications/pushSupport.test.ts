import { describe, expect, it } from 'vitest';
import { deviceParts } from './deviceLabel';
import { devicePushState } from './permissionState';
import { detectPushSupport, iosVersion, type PushEnvironmentFacts } from './pushSupport';

const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const IPHONE_16_3 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPAD_DESKTOP_OLD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0';

const env = (over: Partial<PushEnvironmentFacts>): PushEnvironmentFacts => ({
  userAgent: ANDROID_CHROME,
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  ...over,
});

describe('detectPushSupport', () => {
  it('supports a browser with service worker, Push API and Notification API', () => {
    expect(detectPushSupport(env({}))).toBe('supported');
    expect(detectPushSupport(env({ userAgent: WINDOWS_EDGE }))).toBe('supported');
  });

  it('is unsupported when an API is missing', () => {
    expect(detectPushSupport(env({ hasPushManager: false }))).toBe('unsupported');
    expect(detectPushSupport(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(detectPushSupport(env({ hasNotification: false }))).toBe('unsupported');
  });

  it('is unsupported in in-app browsers and Android WebViews', () => {
    expect(detectPushSupport(env({ userAgent: INSTAGRAM, standalone: true }))).toBe('unsupported');
    expect(detectPushSupport(env({ userAgent: ANDROID_WEBVIEW }))).toBe('unsupported');
  });

  it('asks iOS 16.4+ Safari tabs to install the Home Screen app', () => {
    expect(detectPushSupport(env({ userAgent: IPHONE_17, hasPushManager: false }))).toBe(
      'ios-needs-install',
    );
  });

  it('supports the installed Home Screen app on iOS 16.4+', () => {
    expect(detectPushSupport(env({ userAgent: IPHONE_17, standalone: true }))).toBe('supported');
  });

  it('reports iOS below 16.4 as too old, installed or not', () => {
    expect(detectPushSupport(env({ userAgent: IPHONE_16_3 }))).toBe('ios-too-old');
    expect(detectPushSupport(env({ userAgent: IPHONE_16_3, standalone: true }))).toBe(
      'ios-too-old',
    );
  });

  it('treats iPadOS desktop-mode Safari (Mac user agent + touch) as iOS', () => {
    expect(detectPushSupport(env({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5 }))).toBe(
      'ios-needs-install',
    );
    expect(detectPushSupport(env({ userAgent: IPAD_DESKTOP_OLD, maxTouchPoints: 5 }))).toBe(
      'ios-too-old',
    );
    // A real Mac (no touch) is desktop Safari: push in the tab.
    expect(detectPushSupport(env({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0 }))).toBe(
      'supported',
    );
  });

  it('reads the iOS version from the user agent', () => {
    expect(iosVersion(IPHONE_17)).toEqual({ major: 17, minor: 2 });
    expect(iosVersion(IPAD_DESKTOP)).toEqual({ major: 17, minor: 4 });
    expect(iosVersion('no version')).toBeNull();
  });
});

describe('devicePushState', () => {
  const base = {
    serverEnabled: true,
    support: 'supported',
    permission: 'default',
    subscribed: false,
  } as const;

  it('hides everything when the server has push off', () => {
    expect(devicePushState({ ...base, serverEnabled: false })).toBe('server-disabled');
  });

  it('passes platform limits through', () => {
    expect(devicePushState({ ...base, support: 'ios-needs-install' })).toBe('ios-needs-install');
    expect(devicePushState({ ...base, support: 'unsupported' })).toBe('unsupported');
  });

  it('follows the permission and the subscription', () => {
    expect(devicePushState(base)).toBe('default');
    expect(devicePushState({ ...base, permission: 'denied' })).toBe('denied');
    expect(devicePushState({ ...base, permission: 'granted' })).toBe('granted-off');
    expect(devicePushState({ ...base, permission: 'granted', subscribed: true })).toBe('on');
  });
});

describe('deviceParts', () => {
  it('names common browsers and systems', () => {
    expect(deviceParts(ANDROID_CHROME)).toEqual({ browser: 'Chrome', os: 'Android' });
    expect(deviceParts(WINDOWS_EDGE)).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(deviceParts(MAC_FIREFOX)).toEqual({ browser: 'Firefox', os: 'macOS' });
    expect(deviceParts(IPHONE_17)).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(deviceParts(IPAD_DESKTOP, 5)).toEqual({ browser: 'Safari', os: 'iPadOS' });
  });

  it('returns null for an unknown agent', () => {
    expect(deviceParts('curl/8.0')).toBeNull();
  });
});
