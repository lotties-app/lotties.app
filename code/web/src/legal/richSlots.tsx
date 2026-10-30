import { formatDate } from '../i18n/format';
import type { PolicyDocument } from './policyTypes';
import { privacyContacts } from './privacyConfig';
import { PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_VERSION } from './privacyPolicy';
import { MailOrText, Rich, type Slots } from './RichText';

/** No value to fill in: for inline text that only holds links. */
export const NO_SLOTS: Slots = {
  controller: null,
  contact: null,
  dpo: null,
  version: null,
  lastUpdated: null,
};

/**
 * The values of `{controller}`, `{contact}`, `{dpo}`, `{version}` and `{lastUpdated}`: the owner's
 * build-time settings (privacyConfig.ts), or the policy's own default text when one is not set.
 */
export function slotsFor(
  policy: Pick<PolicyDocument, 'locale' | 'fallbacks'>,
  version: string = PRIVACY_POLICY_VERSION,
  lastUpdated: string = PRIVACY_POLICY_LAST_UPDATED,
): Slots {
  const contacts = privacyContacts();
  // The default contact and encarregado texts only hold links, so they need no values themselves.
  const none: Slots = {
    controller: null,
    contact: null,
    dpo: null,
    version: null,
    lastUpdated: null,
  };
  return {
    controller: contacts.controllerName ?? policy.fallbacks.controller,
    contact: contacts.contactEmail ? (
      <MailOrText value={contacts.contactEmail} />
    ) : (
      <Rich text={policy.fallbacks.contact} slots={none} />
    ),
    dpo: contacts.dpo ? (
      <MailOrText value={contacts.dpo} />
    ) : (
      <Rich text={policy.fallbacks.dpo} slots={none} />
    ),
    version,
    lastUpdated: formatDate(lastUpdated, 'dayMonthYear', policy.locale),
  };
}
