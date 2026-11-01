import { describe, expect, it } from 'vitest';
import { NAVIGATION_DENYLIST, NAVIGATION_FALLBACK } from './navigation';

const denied = (path: string) => NAVIGATION_DENYLIST.some((re) => re.test(path));

describe('service worker navigation fallback', () => {
  it('falls back to the app shell', () => {
    expect(NAVIGATION_FALLBACK).toBe('/index.html');
  });

  it.each(['/api', '/api/', '/api/v1/me', '/auth/callback', '/auth/callback?code=x'])(
    'never serves the app shell for %s',
    (path) => expect(denied(path)).toBe(true),
  );

  it.each(['/', '/day', '/settings', '/invite', '/apiary', '/auth'])(
    'serves the app shell for %s',
    (path) => expect(denied(path)).toBe(false),
  );
});
