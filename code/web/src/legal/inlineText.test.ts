import { describe, expect, it } from 'vitest';
import { linkTarget, parseInline } from './inlineText';

const URLS = {
  issuesUrl: 'https://example.org/issues',
  advisoryUrl: 'https://example.org/advisories',
  repoUrl: 'https://example.org/repo',
};

describe('policy inline text', () => {
  it('splits text, links and values', () => {
    expect(parseInline('See [Settings](/settings#account), write to {contact}.', URLS)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', label: 'Settings', href: '/settings#account', target: 'route' },
      { kind: 'text', text: ', write to ' },
      { kind: 'slot', name: 'contact' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('fills the address tokens of a link', () => {
    expect(parseInline('the [tracker]({issuesUrl})', URLS)[1]).toEqual({
      kind: 'link',
      label: 'tracker',
      href: 'https://example.org/issues',
      target: 'external',
    });
  });

  it('keeps an unknown value or an unsafe link as plain text', () => {
    expect(parseInline('a {nope} b', URLS)).toEqual([{ kind: 'text', text: 'a {nope} b' }]);
    expect(parseInline('[x](javascript:alert(1))', URLS)[0].kind).toBe('text');
    expect(parseInline('[x](http://insecure.example)', URLS)).toEqual([
      { kind: 'text', text: '[x](http://insecure.example)' },
    ]);
  });

  it.each([
    ['#privacy-rights', 'anchor'],
    ['/hub/export', 'route'],
    ['/hub/family#doctor-access', 'route'],
    ['https://www.gov.br/anpd/pt-br', 'external'],
    ['mailto:privacy@example.org', 'external'],
    ['//evil.example', null],
    ['javascript:alert(1)', null],
    ['data:text/html,x', null],
  ])('classifies %s as %s', (href, target) => {
    expect(linkTarget(href)).toBe(target);
  });
});
