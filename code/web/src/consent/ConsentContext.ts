import { createContext, useContext } from 'react';
import type { ConsentCapacity, ConsentsView, OptionalConsentKind } from './consentApi';

/**
 * Where the signed-in account stands with the core consent (docs/design/38-consent-and-terms.md):
 * - `signed-out`: nobody to ask (public pages);
 * - `checking`: no cached answer yet, the server is being asked;
 * - `accepted`: the current version is accepted (confirmed by the server, or the cached answer of this device while it cannot be asked);
 * - `required`: she never accepted, or a material change came since: the consent screen replaces the app.
 */
export type ConsentStatus = 'signed-out' | 'checking' | 'accepted' | 'required';

export interface ConsentApi {
  status: ConsentStatus;
  /** The server's last answer, `null` until it answered (or while signed out). */
  view: ConsentsView | null;
  /**
   * Whether the app may talk to the server about babies: accepted, and either confirmed by the server or known from this device's
   * cache. An unverified `accepted` without a cache (the server could not be asked at the first sign-in) reads local data only.
   */
  syncAllowed: boolean;
  /** The version a "policy updated" notice is shown for (a minor change not dismissed yet), else `null`. */
  noticeVersion: string | null;
  /** Records the core consent for the current version; rejects when the server cannot be reached or refuses. */
  accept: (capacity: ConsentCapacity) => Promise<void>;
  /** Asks the server again (after the device came back online, or on request). */
  refresh: () => Promise<void>;
  /** Hides the notice and remembers the version seen. */
  dismissNotice: () => void;
  /**
   * Records that an optional feature was turned on or off. Never blocks the feature: a failed call is kept on the device and
   * retried (on the next start and when back online).
   */
  recordOptional: (kind: OptionalConsentKind, granted: boolean) => void;
}

const noop = () => undefined;

/** Outside the provider (public pages, tests of single components): nothing to ask, nothing blocked. */
export const SIGNED_OUT_CONSENT: ConsentApi = {
  status: 'signed-out',
  view: null,
  syncAllowed: true,
  noticeVersion: null,
  accept: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
  dismissNotice: noop,
  recordOptional: noop,
};

export const ConsentContext = createContext<ConsentApi>(SIGNED_OUT_CONSENT);

export const useConsent = () => useContext(ConsentContext);
