import { SOURCE_REPOSITORY } from '../credits/curatedCredits';

/*
 * Who is responsible for the data and how to reach them, chosen by the owner at build time
 * (public values, baked into the bundle like VITE_REPO_URL; documented in docs/DEPLOY.md and
 * docs/PRIVACY-OWNER-CHECKLIST.md). Unset, empty or still a `<placeholder>`, a value falls back to the
 * policy's own default text (privacy.<lang>.ts `fallbacks`), so the page never shows a marker.
 */

/** The three values the owner sets before publishing to the stores. */
export const PRIVACY_SETTINGS = [
  'VITE_PRIVACY_CONTROLLER_NAME',
  'VITE_PRIVACY_CONTACT_EMAIL',
  'VITE_PRIVACY_DPO',
] as const;
export type PrivacySetting = (typeof PRIVACY_SETTINGS)[number];

export interface PrivacyContacts {
  /** The controller (person or company) as it should be published; `null` = the default text. */
  controllerName: string | null;
  /** The address for privacy requests; `null` = the repository's issue tracker and private reports. */
  contactEmail: string | null;
  /** The data protection contact (encarregado): a name, an email or both; `null` = the contact above. */
  dpo: string | null;
}

type Env = Record<string, string | undefined>;

const MAX_TEXT = 200;
const PLACEHOLDER = /<[^>]*>/;
/** A plain address (no display name, no `?subject=`): what a `mailto:` link can carry as is. */
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** A trimmed value, or `null` when it is empty, a `<placeholder>`, too long or has control characters. */
function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > MAX_TEXT) return null;
  // eslint-disable-next-line no-control-regex
  if (PLACEHOLDER.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/** Whether `value` is a plain email address (what a `mailto:` link can carry safely). */
export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value);
}

export function privacyContacts(env: Env = import.meta.env as Env): PrivacyContacts {
  const email = text(env.VITE_PRIVACY_CONTACT_EMAIL);
  return {
    controllerName: text(env.VITE_PRIVACY_CONTROLLER_NAME),
    contactEmail: email && isEmailAddress(email) ? email : null,
    dpo: text(env.VITE_PRIVACY_DPO),
  };
}

/** The settings still on their defaults: the owner's to-do before a store submission. */
export function missingPrivacySettings(env: Env = import.meta.env as Env): PrivacySetting[] {
  const contacts = privacyContacts(env);
  const values: Record<PrivacySetting, string | null> = {
    VITE_PRIVACY_CONTROLLER_NAME: contacts.controllerName,
    VITE_PRIVACY_CONTACT_EMAIL: contacts.contactEmail,
    VITE_PRIVACY_DPO: contacts.dpo,
  };
  return PRIVACY_SETTINGS.filter((setting) => values[setting] === null);
}

/** The repository's public issue tracker (the default contact for questions). */
export const ISSUES_URL = `${SOURCE_REPOSITORY}/issues`;

/** A private report to the maintainers on GitHub (the default contact for anything personal). */
export const PRIVATE_REPORT_URL = `${SOURCE_REPOSITORY}/security/advisories/new`;
