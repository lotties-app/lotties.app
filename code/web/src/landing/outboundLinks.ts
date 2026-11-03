import { isEmailAddress, privacyContacts } from '../legal/privacyConfig';
import { repoUrl, webAddress } from './repoUrl';

/*
 * The footer's outbound links, chosen by the owner at build time (public values baked into the
 * bundle like VITE_REPO_URL; docs/DEPLOY.md "Footer links"). Each is hidden when its value is
 * unset. They are plain links: no payment, no form, nothing about a person or a baby in the
 * address.
 */

type Env = Record<string, string | undefined>;

/**
 * "Support the developer": `VITE_SUPPORT_URL`, only when it is a web address
 * (docs/design/43-funding-options.md: a link out, never a payment inside the app).
 */
export function supportUrl(env: Env = import.meta.env as Env): string | null {
  return webAddress(env.VITE_SUPPORT_URL);
}

/** The subject and plain body line of the e-mail fallback (the app version only, nothing else). */
export interface ProblemMail {
  subject: string;
  body: string;
}

/**
 * "Report a problem": `VITE_ISSUES_URL` when it is a web address; otherwise the repository's bare
 * new-issue page when `VITE_REPO_URL` is set; otherwise a `mailto:` to `VITE_PRIVACY_CONTACT_EMAIL`
 * with `mail` as subject and body; otherwise `null` (hidden).
 */
export function problemReportUrl(
  env: Env = import.meta.env as Env,
  mail?: ProblemMail,
): string | null {
  const issues = webAddress(env.VITE_ISSUES_URL);
  if (issues) return issues;
  const repo = repoUrl(env);
  if (repo) return `${repo.replace(/\/+$/, '')}/issues/new`;
  const email = privacyContacts(env).contactEmail;
  if (!email || !isEmailAddress(email)) return null;
  if (!mail) return `mailto:${email}`;
  const subject = encodeURIComponent(mail.subject);
  const body = encodeURIComponent(mail.body);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

/** The attributes of a link that opens in a new tab and tells the other site nothing. */
export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** `NEW_TAB` for a web address; nothing for a `mailto:` link (the mail app opens instead). */
export function newTabFor(href: string): typeof NEW_TAB | Record<string, never> {
  return href.startsWith('mailto:') ? {} : NEW_TAB;
}
