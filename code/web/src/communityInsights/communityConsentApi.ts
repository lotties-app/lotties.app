import type { ApiClient } from '../api/apiClient';
import { API_PREFIX } from '../sync/contract';

/*
 * A baby's community insights consent (docs/design/34-community-insights.md section 3, API task T2;
 * docs/SPEC.md "Community insights consent"). Owner and Parent only, online only. Both routes
 * answer a bare 404 while the feature is off on the server (the default): the web then shows
 * nothing. Only the record: nothing is collected, computed or published.
 */

/** The opt-in screen this build shows (`locales/<lang>/communityInsights.json`); the server refuses a yes for another one. */
export const COMMUNITY_CONSENT_TEXT_VERSION = 'ci-1';

export type CommunityConsentStatus = 'none' | 'on' | 'off' | 'renewal_needed';

export interface CommunityConsentChange {
  action: 'granted' | 'withdrawn' | (string & {});
  at: string;
  textVersion: string;
  policyVersion: string;
  /** The member's display name ("Former member" once her account is deleted); never an id. */
  byName: string;
  byMe: boolean;
}

export interface CommunityConsentView {
  status: CommunityConsentStatus | (string & {});
  currentTextVersion: string;
  latest: CommunityConsentChange | null;
  /** Newest first. */
  history: CommunityConsentChange[];
}

export interface SetCommunityConsentRequest {
  granted: boolean;
  textVersion?: string;
  guardianConfirmed?: boolean;
  locale?: string;
}

export const communityConsentQueryKey = (babyId: string) => ['community-consent', babyId] as const;

const path = (babyId: string) =>
  `${API_PREFIX}/babies/${encodeURIComponent(babyId)}/community-consent`;

/** A real answer of this route (an older server or a proxy may answer something else with 200). */
export function isCommunityConsentView(value: unknown): value is CommunityConsentView {
  if (typeof value !== 'object' || value === null) return false;
  const { status, currentTextVersion, history } = value as Partial<CommunityConsentView>;
  return (
    typeof status === 'string' && typeof currentTextVersion === 'string' && Array.isArray(history)
  );
}

/** The state; throws on anything that is not this route's answer (the section then stays hidden). */
export async function getCommunityConsent(
  api: ApiClient,
  babyId: string,
): Promise<CommunityConsentView> {
  const view = await api.request<unknown>(path(babyId));
  if (!isCommunityConsentView(view)) throw new Error('Unexpected community-consent answer');
  return view;
}

export async function setCommunityConsent(
  api: ApiClient,
  babyId: string,
  request: SetCommunityConsentRequest,
): Promise<CommunityConsentView> {
  const view = await api.request<unknown>(path(babyId), { method: 'PUT', body: request });
  if (!isCommunityConsentView(view)) throw new Error('Unexpected community-consent answer');
  return view;
}
