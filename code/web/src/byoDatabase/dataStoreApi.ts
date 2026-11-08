import type { ApiClient } from '../api/apiClient';
import { ApiError } from '../api/ApiError';
import { API_PREFIX } from '../sync/contract';

/*
 * Where a baby's records live (docs/design/47-bring-your-own-database.md, API task T6; docs/SPEC.md
 * "The baby's own database"). Owner only, online only. Every route answers a bare 404 while the
 * feature is off on the server or the account is not on its allowlist: the web then shows nothing.
 * Responses never carry a host, user, database, password or CA, and the request body (which holds
 * passwords) is built only when the person presses "Save and test".
 */

export type DataStoreKind = 'hosted' | 'own';

/** The store's state as the server names it (snake_case). Unknown values are kept as strings. */
export type DataStoreState =
  | 'pending'
  | 'migrating'
  | 'ready'
  | 'migration_failed'
  | 'schema_ahead'
  | 'unreachable'
  | 'disabled'
  | 'role_too_powerful'
  | 'schema_conflict';

export interface DataStoreStatus {
  state: DataStoreState | (string & {});
  providerLabel: string | null;
  hasDescriptor: boolean;
  schemaVersion: string | null;
  lastCheckedAt: string | null;
  lastCheckResult: string | null;
  updatedAt: string;
}

export interface DataStoreView {
  kind: DataStoreKind;
  store: DataStoreStatus | null;
}

export interface DataStoreTestResult {
  ok: boolean;
  /** `ok` or a coarse code (`endpoint_*`, `store_*`). */
  result: string;
  /** Why the app role is too powerful: `superuser_like`, `owns_objects`, `creates_in_public`, `creates_in_store_schema`. */
  findings: string[];
  checkedAt: string;
}

/** The typed connection details (never a connection string; the API builds it). */
export interface SaveDataStoreRequest {
  providerLabel: string;
  app: { host: string; port: number; database: string; username: string; password: string };
  migrator: { host: string; port: number; username: string; password: string };
  tls: { sslMode: 'verify_full'; caCertificatePem?: string };
}

export const dataStoreQueryKey = (babyId: string) => ['data-store', babyId] as const;

const path = (babyId: string, rest = '') =>
  `${API_PREFIX}/babies/${encodeURIComponent(babyId)}/data-store${rest}`;

/** A real answer of this route (an older server or a proxy may answer something else with 200). */
export function isDataStoreView(value: unknown): value is DataStoreView {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, store } = value as Partial<DataStoreView>;
  return (kind === 'hosted' || kind === 'own') && (store === null || typeof store === 'object');
}

/** The baby's store; throws on anything that is not this route's answer (the feature then stays hidden). */
export async function getDataStore(api: ApiClient, babyId: string): Promise<DataStoreView> {
  const view = await api.request<unknown>(path(babyId));
  if (!isDataStoreView(view)) throw new Error('Unexpected data-store answer');
  return view;
}

export function saveDataStore(
  api: ApiClient,
  babyId: string,
  request: SaveDataStoreRequest,
): Promise<DataStoreView> {
  return api.request<DataStoreView>(path(babyId), { method: 'PUT', body: request });
}

export function removeDataStore(api: ApiClient, babyId: string): Promise<void> {
  return api.request<void>(path(babyId), { method: 'DELETE' });
}

export function testDataStore(api: ApiClient, babyId: string): Promise<DataStoreTestResult> {
  return api.request<DataStoreTestResult>(path(babyId, '/test'), { method: 'POST' });
}

export function moveIntoDataStore(api: ApiClient, babyId: string): Promise<void> {
  return api.request<void>(path(babyId, '/move-in'), { method: 'POST' });
}

export function moveOutOfDataStore(api: ApiClient, babyId: string): Promise<void> {
  return api.request<void>(path(babyId, '/move-out'), { method: 'POST' });
}

/** The feature does not exist for this person (off on the server, or not on the allowlist). */
export const isFeatureHidden = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

/** Moving records is not built on the server yet (501 `not_implemented`, until API task T7). */
export const isNotImplemented = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 501;
