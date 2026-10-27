import { CONSENT_VERSION, TERMS_VERSION } from '../legal/consentVersions';
import { PRIVACY_POLICY_VERSION } from '../legal/privacyPolicy';
import { accountDatabaseName } from '../session/accountDatabase';
import { claimDeviceState } from '../session/deviceState';
import { fakeAuth } from '../test/fakeAuth';
import type { ConsentState, ConsentsView } from './consentApi';
import { storeAcceptedConsent } from './consentStorage';

/* Shared by the consent tests: the server's answers and the remembered acceptance of a device. */

export const CONSENTS_PATH = '/api/v1/me/consents';

export const grantedCore = (overrides: Partial<ConsentState> = {}): ConsentState => ({
  accepted: true,
  version: CONSENT_VERSION,
  acceptedAt: '2026-10-27T12:00:00.000Z',
  capacity: 'guardian',
  locale: 'en',
  withdrawnAt: null,
  ...overrides,
});

export const consentsView = (overrides: Partial<ConsentsView> = {}): ConsentsView => ({
  currentVersion: CONSENT_VERSION,
  termsVersion: TERMS_VERSION,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
  core: null,
  optional: { push: null, alexa: null, mcp: null },
  requiresAcceptance: true,
  minorChangeSince: null,
  ...overrides,
});

export const acceptedView = (overrides: Partial<ConsentsView> = {}): ConsentsView =>
  consentsView({ core: grantedCore(), requiresAcceptance: false, ...overrides });

/**
 * Puts a remembered acceptance on the device as the signed-in test account's (the provider claims the device entries for its
 * account first, so an entry stored before that would be cleared as another account's).
 */
export function rememberConsent(version: string, capacity: ConsentState['capacity'] = 'guardian') {
  claimDeviceState(accountDatabaseName(fakeAuth().accountId ?? ''));
  storeAcceptedConsent({ version, capacity: capacity ?? 'guardian' });
}
