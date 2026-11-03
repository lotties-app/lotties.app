import { describe, expect, it } from 'vitest';
import { newTabFor, problemReportUrl, supportUrl } from './outboundLinks';
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

describe('newTabFor', () => {
  it('opens a web address in a new tab without a referrer, and a mailto: in place', () => {
    expect(newTabFor('https://example.org')).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(newTabFor('mailto:a@example.org')).toEqual({});
  });
});
