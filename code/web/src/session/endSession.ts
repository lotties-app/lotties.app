import type { BabyRoutineDb } from '../db/database';
import { isNativeApp } from '../platform/nativeApp';
import { clearAccountDeviceState } from './deviceState';

/** The widget snapshot and the Siri outbox hold the account's data in the App Group container: gone with the session. */
async function wipeWidgetData(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { nativeWidgetBridge } = await import('../widgets/widgetBridge');
    await nativeWidgetBridge.clearAll();
  } catch {
    // Best effort, like the push release: sign out anyway.
  }
}

/**
 * Removes everything the account left on this device, then ends the OIDC session (which removes
 * the stored OIDC user): this device's push subscription (`releaseDevice`, while the access token
 * still works), the account's database (outbox included), and its localStorage entries.
 * A failed delete (IndexedDB unavailable) does not keep the user signed in: the data stays
 * isolated in the account's own database.
 */
export async function endAccountSession(
  db: BabyRoutineDb,
  logout: () => Promise<void>,
  releaseDevice?: () => Promise<void>,
): Promise<void> {
  try {
    await releaseDevice?.();
  } catch {
    // Push clean-up is best effort: sign out anyway.
  }
  try {
    await db.delete();
  } catch {
    // See above: sign out anyway.
  }
  clearAccountDeviceState();
  await wipeWidgetData();
  await logout();
}
