import { describe, expect, it } from 'vitest';
import { nativeContentSecurityPolicy, originOf } from '../../native-csp';

describe('nativeContentSecurityPolicy', () => {
  it('allows the bundle, the API origin and the identity provider origin as fetch targets', () => {
    const policy = nativeContentSecurityPolicy(
      'https://lotties.app',
      'https://auth.lotties.app/realms/lotties.app',
    );

    expect(policy).toContain("connect-src 'self' https://lotties.app https://auth.lotties.app;");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("object-src 'none'");
  });

  it('lists each origin once and ignores values that are not http(s) origins', () => {
    expect(nativeContentSecurityPolicy('https://a.test/api', 'https://a.test/realms/x')).toContain(
      "connect-src 'self' https://a.test;",
    );
    expect(nativeContentSecurityPolicy('', 'javascript:alert(1)')).toContain("connect-src 'self';");
  });

  it('never allows inline or remote scripts', () => {
    const policy = nativeContentSecurityPolicy('https://lotties.app', 'https://auth.lotties.app');
    const script = policy.split('; ').find((part) => part.startsWith('script-src'));
    expect(script).toBe("script-src 'self'");
  });
});

describe('originOf', () => {
  it('returns the origin of http and https URLs only', () => {
    expect(originOf('https://auth.lotties.app/realms/x')).toBe('https://auth.lotties.app');
    expect(originOf('http://localhost:8080')).toBe('http://localhost:8080');
    expect(originOf('capacitor://localhost')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
