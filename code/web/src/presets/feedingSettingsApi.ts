import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/*
 * The server copy of the feeding settings (any signed-in role, Doctor included): `GET` and `PUT`
 * `/me/feeding-settings` with `{ timeBottleFeedings: boolean }`. Assistants (Alexa, MCP) read it to
 * start a bottle as a timer. Before the first save the server answers `null`; it may also be
 * unreachable: callers then keep the local value.
 */

const path = `${API_PREFIX}/me/feeding-settings`;

/** The saved "Time bottle feedings" value, or `null` when the account never saved it. */
export async function getTimeBottleFeedings(api: ApiClient): Promise<boolean | null> {
  const body = await api.request<{ timeBottleFeedings?: unknown } | undefined>(path);
  return typeof body?.timeBottleFeedings === 'boolean' ? body.timeBottleFeedings : null;
}

export async function putTimeBottleFeedings(api: ApiClient, on: boolean): Promise<void> {
  await api.request(path, { method: 'PUT', body: { timeBottleFeedings: on } });
}
