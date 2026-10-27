import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/*
 * The consent routes (docs/design/38-consent-and-terms.md section 4): any signed-in user of any role, open even to a person who has
 * not consented yet. `GET /me/consents`, `PUT /me/consents/core` and `PUT /me/consents/optional/{push|alexa|mcp}`.
 */

export type ConsentCapacity = 'guardian' | 'authorised';
export const CONSENT_CAPACITIES: readonly ConsentCapacity[] = ['guardian', 'authorised'];

export type OptionalConsentKind = 'push' | 'alexa' | 'mcp';
export const OPTIONAL_CONSENT_KINDS: readonly OptionalConsentKind[] = ['push', 'alexa', 'mcp'];

export interface ConsentState {
  /** `true` while in force; `false` for an optional consent turned off. */
  accepted: boolean;
  version: string;
  acceptedAt: string;
  capacity: ConsentCapacity | null;
  locale: string;
  withdrawnAt: string | null;
}

export interface ConsentsView {
  currentVersion: string;
  termsVersion: string;
  privacyPolicyVersion: string;
  core: ConsentState | null;
  optional: Record<OptionalConsentKind, ConsentState | null>;
  requiresAcceptance: boolean;
  /** The current version when only minor changes came since the accepted one (a notice), else `null`. */
  minorChangeSince: string | null;
}

/** The TanStack Query key of the person's consent records (Settings > Privacy and data). */
export const CONSENTS_QUERY_KEY = ['consents'] as const;

const base = `${API_PREFIX}/me/consents`;

export const isOptionalConsentKind = (value: unknown): value is OptionalConsentKind =>
  typeof value === 'string' && (OPTIONAL_CONSENT_KINDS as readonly string[]).includes(value);

export const isConsentCapacity = (value: unknown): value is ConsentCapacity =>
  typeof value === 'string' && (CONSENT_CAPACITIES as readonly string[]).includes(value);

export function getConsents(api: ApiClient): Promise<ConsentsView> {
  return api.request<ConsentsView>(base);
}

/** Records the core consent for `version` (the one the person read); 409 `consent_version_outdated` when it is not the current one. */
export function acceptCoreConsent(
  api: ApiClient,
  version: string,
  capacity: ConsentCapacity,
  locale: string,
): Promise<ConsentsView> {
  return api.request<ConsentsView>(`${base}/core`, {
    method: 'PUT',
    body: { version, capacity, locale },
  });
}

export function setOptionalConsent(
  api: ApiClient,
  kind: OptionalConsentKind,
  granted: boolean,
  locale: string,
): Promise<ConsentsView> {
  return api.request<ConsentsView>(`${base}/optional/${kind}`, {
    method: 'PUT',
    body: { granted, locale },
  });
}
