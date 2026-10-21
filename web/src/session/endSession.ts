import type { BabyRoutineDb } from '../db/database';
import { clearAccountDeviceState } from './deviceState';

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
  await logout();
}
