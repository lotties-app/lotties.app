import type { PushSupport } from './pushSupport';

/*
 * The state of "Notifications on this device" (docs/design/09-push-notifications.md section 11):
 * server switch, platform support, browser permission and the browser's subscription, combined.
 */

export type BrowserPermission = 'default' | 'denied' | 'granted';

export type DevicePushState =
  /** `GET /push/config` says push is off: the Notifications section is not shown. */
  | 'server-disabled'
  | 'unsupported'
  | 'ios-needs-install'
  | 'ios-too-old'
  /** Never asked: Turn on opens the explainer, then the browser prompt. */
  | 'default'
  /** Blocked in the browser: explain how to allow, never prompt again. */
  | 'denied'
  /** Allowed but not subscribed: Turn on subscribes without a prompt. */
  | 'granted-off'
  | 'on';

export interface DevicePushFacts {
  serverEnabled: boolean;
  support: PushSupport;
  permission: BrowserPermission;
  /** The browser holds a push subscription for this origin. */
  subscribed: boolean;
}

export function devicePushState({
  serverEnabled,
  support,
  permission,
  subscribed,
}: DevicePushFacts): DevicePushState {
  if (!serverEnabled) return 'server-disabled';
  if (support !== 'supported') return support;
  if (permission === 'denied') return 'denied';
  if (permission === 'default') return 'default';
  return subscribed ? 'on' : 'granted-off';
}

/** States where the device switch is shown (the others show a message instead). */
export function hasDeviceSwitch(state: DevicePushState): boolean {
  return state === 'default' || state === 'granted-off' || state === 'on' || state === 'denied';
}
