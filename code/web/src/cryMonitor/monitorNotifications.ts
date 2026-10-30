import type { PushDevice } from '../notifications/pushDevice';
import { cryDetectedTag } from '../pwa/sw/notificationOptions';

/*
 * The `cry_detected` push on the monitor's own device (docs/design/09-push-notifications.md section
 * 2.12): the server cannot tell which subscription is the monitor, and the service worker always shows
 * a push, so the device that heard the crying may also get the alert when its member turned it on. The
 * monitor page closes it here: on each detected cry and on a short interval while listening. There is
 * no service-worker message for a push, so the interval is the path. Other devices keep their alert.
 */

/** How often the listening page looks for the baby's alert on this device. */
export const CLOSE_CRY_NOTIFICATIONS_EVERY_MS = 10_000;

/** Closes this browser's cry alerts of `babyId`; returns how many. Never throws. */
export async function closeCryNotifications(
  device: Pick<PushDevice, 'shownNotifications'>,
  babyId: string,
): Promise<number> {
  try {
    const tag = cryDetectedTag(babyId);
    const shown = (await device.shownNotifications()).filter((n) => n.tag === tag);
    for (const notification of shown) notification.close();
    return shown.length;
  } catch {
    return 0;
  }
}
