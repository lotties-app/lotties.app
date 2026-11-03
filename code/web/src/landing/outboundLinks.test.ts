import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  issuePlatform,
  issueScreen,
  newTabFor,
  problemReportUrl,
  supportUrl,
  type IssueContext,
} from './outboundLinks';
import { webAddress } from './repoUrl';

describe('webAddress', () => {
  it('keeps http and https addresses only', () => {
    expect(webAddress(undefined)).toBeNull();
    expect(webAddress('  ')).toBeNull();
    expect(webAddress('not a url')).toBeNull();
    expect(webAddress('javascript:alert(1)')).toBeNull();
    expect(webAddress('mailto:a@example.org')).toBeNull();
    expect(webAddress(' https://example.org/x ')).toBe('https://example.org/x');
    expect(webAddress('http://example.org/')).toBe('http://example.org/');
  });
});

describe('supportUrl', () => {
  it('is hidden without VITE_SUPPORT_URL or with anything but a web address', () => {
    expect(supportUrl({})).toBeNull();
    expect(supportUrl({ VITE_SUPPORT_URL: '' })).toBeNull();
    expect(supportUrl({ VITE_SUPPORT_URL: 'javascript:alert(1)' })).toBeNull();
    expect(supportUrl({ VITE_SUPPORT_URL: 'data:text/html,hi' })).toBeNull();
  });

  it('is the configured web address', () => {
    expect(supportUrl({ VITE_SUPPORT_URL: 'https://example.org/sponsor' })).toBe(
      'https://example.org/sponsor',
    );
  });
});

describe('problemReportUrl', () => {
  const mail = { subject: 'Lotties: a problem', body: 'Lotties v0.1.2' };

  it('is hidden when nothing is configured', () => {
    expect(problemReportUrl({}, mail)).toBeNull();
    expect(problemReportUrl({ VITE_ISSUES_URL: 'javascript:alert(1)' }, mail)).toBeNull();
  });

  it('prefers VITE_ISSUES_URL', () => {
    expect(
      problemReportUrl(
        {
          VITE_ISSUES_URL: 'https://example.org/report',
          VITE_REPO_URL: 'https://example.org/repo',
          VITE_PRIVACY_CONTACT_EMAIL: 'privacy@example.org',
        },
        mail,
      ),
    ).toBe('https://example.org/report');
  });

  it('derives the bare new-issue page from VITE_REPO_URL', () => {
    expect(problemReportUrl({ VITE_REPO_URL: 'https://example.org/repo' }, mail)).toBe(
      'https://example.org/repo/issues/new',
    );
    expect(problemReportUrl({ VITE_REPO_URL: 'https://example.org/repo/' }, mail)).toBe(
      'https://example.org/repo/issues/new',
    );
  });

  it('falls back to an e-mail to the privacy contact with the subject and version only', () => {
    expect(problemReportUrl({ VITE_PRIVACY_CONTACT_EMAIL: 'privacy@example.org' }, mail)).toBe(
      'mailto:privacy@example.org?subject=Lotties%3A%20a%20problem&body=Lotties%20v0.1.2',
    );
    expect(problemReportUrl({ VITE_PRIVACY_CONTACT_EMAIL: 'privacy@example.org' })).toBe(
      'mailto:privacy@example.org',
    );
  });

  it('ignores a placeholder or malformed e-mail', () => {
    expect(problemReportUrl({ VITE_PRIVACY_CONTACT_EMAIL: '<email>' }, mail)).toBeNull();
    expect(problemReportUrl({ VITE_PRIVACY_CONTACT_EMAIL: 'a@b?cc=x@y.z' }, mail)).toBeNull();
  });
});

describe('problemReportUrl with the GitHub bug form', () => {
  const mail = { subject: 'Lotties: a problem', body: 'Lotties v0.1.2' };
  const issue: IssueContext = {
    version: 'v0.1.2',
    platform: 'Web browser',
    language: 'pt-BR',
    screen: '/hub/about',
  };
  const repo = 'https://github.com/lotties-app/lotties.app';

  it('prefills the bug form from VITE_REPO_URL, every value encoded', () => {
    expect(problemReportUrl({ VITE_REPO_URL: repo }, mail, issue)).toBe(
      `${repo}/issues/new?template=bug.yml&version=v0.1.2&platform=Web%20browser` +
        '&language=pt-BR&screen=%2Fhub%2Fabout',
    );
  });

  it('prefills a VITE_ISSUES_URL that is a GitHub new-issue page, keeping its own parameters', () => {
    expect(
      problemReportUrl(
        { VITE_ISSUES_URL: `${repo}/issues/new?labels=beta`, VITE_REPO_URL: 'https://example.org' },
        mail,
        { ...issue, platform: 'iOS app', language: 'en', screen: '/' },
      ),
    ).toBe(
      `${repo}/issues/new?labels=beta&template=bug.yml&version=v0.1.2&platform=iOS%20app` +
        '&language=en&screen=%2F',
    );
  });

  it('strips ids, tokens, the query and the hash from the screen', () => {
    const url = problemReportUrl({ VITE_REPO_URL: repo }, mail, {
      ...issue,
      screen: '/0b5c4a7e-1d2f-4c3b-9a8e-7f6d5c4b3a21/timeline?event=abc#x',
    });
    expect(new URL(url ?? '').searchParams.get('screen')).toBe('/:id/timeline');
    expect(url).not.toContain('0b5c4a7e');
    expect(issueScreen('/hub/board/42')).toBe('/hub/board/:id');
    expect(issueScreen('/invite/abcdefgh')).toBe('/invite/:id');
    expect(issueScreen('/doctor/patients/Xy9_kL-2')).toBe('/doctor/patients/:id');
    expect(issueScreen('/hub/cry-monitor/')).toBe('/hub/cry-monitor');
    expect(issueScreen('')).toBe('/');
  });

  it('names the platform of the native app or the browser', () => {
    expect(issuePlatform('ios')).toBe('iOS app');
    expect(issuePlatform('android')).toBe('Android app');
    expect(issuePlatform(null)).toBe('Web browser');
    const url = problemReportUrl({ VITE_REPO_URL: repo }, mail, {
      ...issue,
      platform: issuePlatform('android'),
    });
    expect(new URL(url ?? '').searchParams.get('platform')).toBe('Android app');
  });

  it('leaves any other address untouched', () => {
    expect(problemReportUrl({ VITE_ISSUES_URL: 'https://example.org/report' }, mail, issue)).toBe(
      'https://example.org/report',
    );
    expect(problemReportUrl({ VITE_ISSUES_URL: `${repo}/issues` }, mail, issue)).toBe(
      `${repo}/issues`,
    );
    expect(problemReportUrl({ VITE_REPO_URL: 'https://example.org/repo' }, mail, issue)).toBe(
      'https://example.org/repo/issues/new',
    );
  });

  it('matches the field ids and option labels of .github/ISSUE_TEMPLATE/bug.yml', () => {
    const form = readFileSync(
      resolve(__dirname, '..', '..', '..', '..', '.github', 'ISSUE_TEMPLATE', 'bug.yml'),
      'utf8',
    );
    const lines = form.split(/\r?\n/).map((line) => line.trim());
    for (const id of ['version', 'platform', 'language', 'screen']) {
      expect(lines).toContain(`id: ${id}`);
    }
    for (const label of ['Web browser', 'iOS app', 'Android app', 'en', 'pt-BR']) {
      expect(lines).toContain(`- ${label}`);
    }
  });

  it('keeps the e-mail fallback as it was (subject and version only)', () => {
    expect(
      problemReportUrl({ VITE_PRIVACY_CONTACT_EMAIL: 'privacy@example.org' }, mail, issue),
    ).toBe('mailto:privacy@example.org?subject=Lotties%3A%20a%20problem&body=Lotties%20v0.1.2');
  });
});

describe('newTabFor', () => {
  it('opens a web address in a new tab without a referrer, and a mailto: in place', () => {
    expect(newTabFor('https://example.org')).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(newTabFor('mailto:a@example.org')).toEqual({});
  });
});
