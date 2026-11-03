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

/** The platform labels of the bug form's `platform` dropdown (.github/ISSUE_TEMPLATE/bug.yml). */
export type IssuePlatform = 'Web browser' | 'iOS app' | 'Android app';

/**
 * What the GitHub bug form is prefilled with: four technical facts, never an account, a baby, a
 * name, a token or an event. Each key is a field id of .github/ISSUE_TEMPLATE/bug.yml.
 */
export interface IssueContext {
  /** The app version as the About screen shows it (`v0.1.54`). */
  version: string;
  platform: IssuePlatform;
  /** The UI language (`en`, `pt-BR`). */
  language: string;
  /** The route path; `issueScreen` strips ids from it. */
  screen: string;
}

/** The bug form's platform label: the Lotties iOS/Android app, otherwise a web browser. */
export function issuePlatform(native: 'ios' | 'android' | null): IssuePlatform {
  if (native === 'ios') return 'iOS app';
  if (native === 'android') return 'Android app';
  return 'Web browser';
}

/** A path segment kept as is: a plain lower-case word of a route (`hub`, `cry-monitor`). */
const ROUTE_WORD = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * `pathname` without anything that could identify a record or carry a secret: no query or hash,
 * and every segment that is not a plain route word (a UUID, a number, a token, a key) becomes
 * `:id`, as does the segment after `invite` (`/invite/<token>`).
 */
export function issueScreen(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  const segments = path.split('/').filter((s) => s !== '');
  const safe = segments.map((segment, i) =>
    ROUTE_WORD.test(segment) && segment.length <= 32 && segments[i - 1] !== 'invite'
      ? segment
      : ':id',
  );
  return `/${safe.join('/')}`;
}

/** Whether `url` is a GitHub repository's new-issue page (`https://github.com/<owner>/<repo>/issues/new`). */
function isGithubNewIssue(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname.replace(/^www\./, '') === 'github.com' &&
    /^\/[^/]+\/[^/]+\/issues\/new\/?$/.test(url.pathname)
  );
}

/** `address` with the bug form and `issue` as query parameters when it is GitHub's new-issue page. */
function withIssueForm(address: string, issue: IssueContext | undefined): string {
  if (!issue) return address;
  const url = new URL(address);
  if (!isGithubNewIssue(url)) return address;
  const params: [string, string][] = [
    ['template', 'bug.yml'],
    ['version', issue.version],
    ['platform', issue.platform],
    ['language', issue.language],
    ['screen', issueScreen(issue.screen)],
  ];
  for (const [key] of params) url.searchParams.delete(key);
  // encodeURIComponent, not URLSearchParams: a space is %20, never `+`.
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const kept = url.searchParams.toString();
  url.search = '';
  url.hash = '';
  return `${url.toString()}?${kept ? `${kept}&` : ''}${query}`;
}

/**
 * "Report a problem": `VITE_ISSUES_URL` when it is a web address; otherwise the repository's
 * new-issue page when `VITE_REPO_URL` is set; otherwise a `mailto:` to `VITE_PRIVACY_CONTACT_EMAIL`
 * with `mail` as subject and body; otherwise `null` (hidden). A GitHub new-issue page opens the bug
 * form prefilled with `issue` (docs/agents/ISSUE-TRIAGE.md); any other address is left untouched.
 */
export function problemReportUrl(
  env: Env = import.meta.env as Env,
  mail?: ProblemMail,
  issue?: IssueContext,
): string | null {
  const issues = webAddress(env.VITE_ISSUES_URL);
  if (issues) return withIssueForm(issues, issue);
  const repo = repoUrl(env);
  if (repo) return withIssueForm(`${repo.replace(/\/+$/, '')}/issues/new`, issue);
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
