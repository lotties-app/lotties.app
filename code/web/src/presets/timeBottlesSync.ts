import type { ApiClient } from '../api/apiClient';
import { getTimeBottleFeedings, putTimeBottleFeedings } from './feedingSettingsApi';
import {
  isTimeBottlesPending,
  loadTimeBottles,
  setTimeBottlesPending,
  storeTimeBottles,
} from './timeBottlesStorage';

/*
 * "Time bottle feedings" is a setting of the account kept on the server (`/me/feeding-settings`,
 * so Alexa and the MCP server can start a bottle as a timer) and cached in localStorage so the
 * synchronous `loadTimeBottles()` keeps working offline. A change is written to the cache at once
 * and marked pending until the server confirms it; a pending value is retried on the next load
 * and when the device comes back online, and is never overwritten by the server's older one.
 */

async function push(api: ApiClient, on: boolean): Promise<void> {
  try {
    await putTimeBottleFeedings(api, on);
  } catch {
    return; // Stays pending: retried on the next load or when back online.
  }
  if (loadTimeBottles() === on) setTimeBottlesPending(false); // else a newer choice is on its way
}

/** The person's choice: cache it now, send it to the server in the background. */
export async function saveTimeBottles(api: ApiClient, on: boolean): Promise<void> {
  storeTimeBottles(on);
  setTimeBottlesPending(true);
  await push(api, on);
}

/**
 * On load / back online: send an unconfirmed local choice; else adopt the server's value; if the
 * server never had one, upload the value this device already has (a person who opted in before
 * the setting moved to the server keeps it).
 */
export async function syncTimeBottles(api: ApiClient): Promise<void> {
  if (isTimeBottlesPending()) return push(api, loadTimeBottles());
  let remote: boolean | null;
  try {
    remote = await getTimeBottleFeedings(api);
  } catch {
    return; // 404, offline or any failure: the local value stands.
  }
  if (isTimeBottlesPending()) return; // The person changed it while we asked.
  if (remote === null) {
    if (loadTimeBottles()) await push(api, true);
    return;
  }
  if (remote !== loadTimeBottles()) storeTimeBottles(remote);
}
