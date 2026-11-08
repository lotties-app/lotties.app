import { ApiError } from '../api/ApiError';
import { getOwn } from '../util/ownProperty';
import type { DataStoreStatus } from './dataStoreApi';

/*
 * Server codes to plain-language messages (keys under `byoDatabase.results` and
 * `byoDatabase.health`). The server's codes are coarse on purpose (docs/design/47 section 3.4) and
 * the server's own text is never shown: an unknown code gets the generic message.
 */

export type ResultMessage =
  | 'ok'
  | 'checkFields'
  | 'port'
  | 'unresolvable'
  | 'blockedAddress'
  | 'tls'
  | 'ca'
  | 'unreachable'
  | 'timeout'
  | 'credentials'
  | 'roleTooPowerful'
  | 'schemaConflict'
  | 'schemaAhead'
  | 'quotaFull'
  | 'busy'
  | 'migrating'
  | 'migrationFailed'
  | 'consent'
  | 'rateLimited'
  | 'notConfigured'
  | 'unknown';

const RESULT_MESSAGES: Readonly<Record<string, ResultMessage>> = {
  ok: 'ok',
  endpoint_invalid_field: 'checkFields',
  endpoint_invalid_host: 'checkFields',
  validation_failed: 'checkFields',
  endpoint_port_not_allowed: 'port',
  endpoint_unresolvable: 'unresolvable',
  endpoint_blocked_address: 'blockedAddress',
  endpoint_tls_failed: 'tls',
  store_tls_failed: 'tls',
  endpoint_invalid_ca: 'ca',
  store_unavailable: 'unreachable',
  store_paused_or_unreachable: 'unreachable',
  store_timeout: 'timeout',
  store_credentials_rejected: 'credentials',
  store_role_too_powerful: 'roleTooPowerful',
  store_schema_conflict: 'schemaConflict',
  store_schema_ahead: 'schemaAhead',
  store_quota_full: 'quotaFull',
  store_rate_limited: 'busy',
  store_migrating: 'migrating',
  store_migration_failed: 'migrationFailed',
  byo_consent_required: 'consent',
  rate_limited: 'rateLimited',
  store_not_configured: 'notConfigured',
};

/** The message for a test result or a problem `code` (never the server's text). */
export function resultMessageOf(code: string | null | undefined): ResultMessage {
  return (code && getOwn(RESULT_MESSAGES, code)) || 'unknown';
}

/** The message for a failed save or test request. */
export function errorMessageOf(error: unknown): ResultMessage {
  if (!(error instanceof ApiError)) return 'unknown';
  if (error.status === 429) return 'rateLimited';
  return resultMessageOf(error.code);
}

/** When the server asked to wait before trying again (503 `store_*`, 429), in whole seconds. */
export function retryAfterSecondsOf(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.retryAfterMs === null) return null;
  return Math.max(1, Math.ceil(error.retryAfterMs / 1000));
}

const FINDINGS = [
  'superuser_like',
  'owns_objects',
  'creates_in_public',
  'creates_in_store_schema',
] as const;
export type RoleFinding = (typeof FINDINGS)[number];

/** The findings the app knows how to explain; others are dropped (the general message stays). */
export const knownFindings = (findings: readonly string[]): RoleFinding[] =>
  FINDINGS.filter((finding) => findings.includes(finding));

/** What the status banner says about a store in use or being set up. */
export type StoreHealth =
  | 'ok'
  | 'checking'
  | 'unreachable'
  | 'credentials'
  | 'quotaFull'
  | 'schemaAhead'
  | 'roleTooPowerful'
  | 'schemaConflict'
  | 'migrationFailed'
  | 'disabled'
  | 'notTested';

const BY_STATE: Readonly<Record<string, StoreHealth>> = {
  ready: 'ok',
  migrating: 'checking',
  schema_ahead: 'schemaAhead',
  role_too_powerful: 'roleTooPowerful',
  schema_conflict: 'schemaConflict',
  migration_failed: 'migrationFailed',
  disabled: 'disabled',
};

const BY_LAST_CHECK: Readonly<Record<string, StoreHealth>> = {
  store_credentials_rejected: 'credentials',
  store_quota_full: 'quotaFull',
  store_role_too_powerful: 'roleTooPowerful',
  store_schema_ahead: 'schemaAhead',
  store_schema_conflict: 'schemaConflict',
  store_migrating: 'checking',
  store_migration_failed: 'migrationFailed',
};

/**
 * The banner for a store: its state first; for `unreachable` (and a `pending` store that was
 * tested) the last test says why (credentials, quota...), else "paused or unreachable".
 */
export function storeHealthOf(
  store: Pick<DataStoreStatus, 'state' | 'lastCheckResult'>,
): StoreHealth {
  const byState = getOwn(BY_STATE, store.state);
  if (byState) return byState;
  const lastCheck = store.lastCheckResult;
  const byCheck = lastCheck ? getOwn(BY_LAST_CHECK, lastCheck) : undefined;
  if (store.state === 'pending') {
    if (!lastCheck) return 'notTested';
    if (lastCheck === 'ok') return 'checking';
    return byCheck ?? 'unreachable';
  }
  if (store.state === 'unreachable') return byCheck ?? 'unreachable';
  return 'checking';
}

/** Banner colour per health. */
export const HEALTH_SEVERITY: Readonly<
  Record<StoreHealth, 'success' | 'info' | 'warning' | 'error'>
> = {
  ok: 'success',
  checking: 'info',
  notTested: 'info',
  unreachable: 'warning',
  credentials: 'error',
  quotaFull: 'warning',
  schemaAhead: 'warning',
  roleTooPowerful: 'error',
  schemaConflict: 'error',
  migrationFailed: 'error',
  disabled: 'warning',
};
