/*
 * Can this browser receive Web Push from the app? Pure: the environment is passed in, so every
 * platform rule is unit-tested (docs/design/09-push-notifications.md sections 11 and 15).
 */

export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install' | 'ios-too-old';

export interface PushEnvironmentFacts {
  userAgent: string;
  /** `navigator.maxTouchPoints`: iPadOS reports a desktop (Macintosh) user agent. */
  maxTouchPoints: number;
  /** Running as an installed app (display-mode standalone or `navigator.standalone`). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

/** In-app browsers (social apps, Android WebView) never get push. */
const IN_APP_BROWSER =
  /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|; wv\)/i;

const IOS_MIN = { major: 16, minor: 4 };

export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ Safari asks for the desktop site: a Mac user agent with a touch screen.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** The iOS/iPadOS version from `OS 16_4` (or Safari's `Version/16.4`); `null` when absent. */
export function iosVersion(userAgent: string): { major: number; minor: number } | null {
  const match = /OS (\d+)[_.](\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function belowMinimum(version: { major: number; minor: number }): boolean {
  return (
    version.major < IOS_MIN.major ||
    (version.major === IOS_MIN.major && version.minor < IOS_MIN.minor)
  );
}

export function detectPushSupport(env: PushEnvironmentFacts): PushSupport {
  if (IN_APP_BROWSER.test(env.userAgent)) return 'unsupported';
  if (isIosDevice(env.userAgent, env.maxTouchPoints)) {
    const version = iosVersion(env.userAgent);
    if (version && belowMinimum(version)) return 'ios-too-old';
    // Only the Home Screen web app gets push on iOS; a browser tab never does.
    if (!env.standalone) return 'ios-needs-install';
  }
  return env.hasServiceWorker && env.hasPushManager && env.hasNotification
    ? 'supported'
    : 'unsupported';
}
