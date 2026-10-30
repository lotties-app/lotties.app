/*
 * Which device and browser the install guide is for. Pure: the user agent and touch points are
 * passed in, so every row of the platform table is unit-tested (docs/design/29-install-guide.md).
 */
import { isInAppBrowser, isIosDevice } from '../notifications/pushSupport';

export type InstallOs = 'ios' | 'android' | 'desktop';
export type InstallBrowser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';

export interface InstallPlatform {
  os: InstallOs;
  browser: InstallBrowser;
  /** iPad (also iPadOS asking for the desktop site: a Mac user agent with a touch screen). */
  tablet: boolean;
  /** A social app's built-in browser or a WebView: it cannot install, open the real browser. */
  inAppBrowser: boolean;
  /** macOS (Safari there installs with File > Add to Dock). */
  mac: boolean;
}

function iosBrowser(ua: string): InstallBrowser {
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/EdgiOS/i.test(ua)) return 'edge';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (/OPiOS|OPT\/|DuckDuckGo|GSA\//i.test(ua)) return 'other';
  return /Safari/i.test(ua) ? 'safari' : 'other';
}

function otherBrowser(ua: string): InstallBrowser {
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Edg(e|A)?\//i.test(ua)) return 'edge';
  if (/OPR\/|Opera|YaBrowser|Vivaldi/i.test(ua)) return 'other';
  if (/Chrome|Chromium/i.test(ua)) return 'chrome';
  return /Safari/i.test(ua) ? 'safari' : 'other';
}

export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  const inAppBrowser = isInAppBrowser(userAgent);
  if (isIosDevice(userAgent, maxTouchPoints)) {
    return {
      os: 'ios',
      browser: iosBrowser(userAgent),
      tablet: /iPad/i.test(userAgent) || /Macintosh/i.test(userAgent),
      inAppBrowser,
      mac: false,
    };
  }
  return {
    os: /Android/i.test(userAgent) ? 'android' : 'desktop',
    browser: otherBrowser(userAgent),
    tablet: false,
    inAppBrowser,
    mac: /Macintosh|Mac OS X/i.test(userAgent),
  };
}

/** The platform of this browser (`navigator`), for components. */
export function currentInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return detectInstallPlatform('');
  return detectInstallPlatform(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
}

/** The steps a browser without an install prompt follows (the guide sheet and the /install page). */
export type GuideId =
  | 'iosSafari'
  | 'iosOther'
  | 'inApp'
  | 'androidChrome'
  | 'androidSamsung'
  | 'androidFirefox'
  | 'desktopChromium'
  | 'macSafari'
  | 'unsupported';

export function guideFor(platform: InstallPlatform): GuideId {
  if (platform.inAppBrowser) return 'inApp';
  if (platform.os === 'ios') return platform.browser === 'safari' ? 'iosSafari' : 'iosOther';
  if (platform.os === 'android') {
    if (platform.browser === 'samsung') return 'androidSamsung';
    if (platform.browser === 'firefox') return 'androidFirefox';
    // Chrome, Edge and other Chromium browsers on Android have the same menu entry.
    return 'androidChrome';
  }
  if (platform.browser === 'chrome' || platform.browser === 'edge') return 'desktopChromium';
  if (platform.browser === 'safari' && platform.mac) return 'macSafari';
  return 'unsupported';
}
