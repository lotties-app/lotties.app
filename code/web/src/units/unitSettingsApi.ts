import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';
import { isUnitSetting, type UnitSetting } from './system';

/*
 * The server copy of the setting (any signed-in role, Doctor included): `GET` and `PUT`
 * `/me/unit-settings` with `{ system: "auto" | "metric" | "us" }`. The server may not know the
 * route yet (404) or be unreachable: callers then keep the local value.
 */

const path = `${API_PREFIX}/me/unit-settings`;

/** The saved choice, or `null` when the answer is not a known setting. */
export async function getUnitSettings(api: ApiClient): Promise<UnitSetting | null> {
  const body = await api.request<{ system?: unknown } | undefined>(path);
  return isUnitSetting(body?.system) ? body.system : null;
}

export async function putUnitSettings(api: ApiClient, system: UnitSetting): Promise<void> {
  await api.request(path, { method: 'PUT', body: { system } });
}
