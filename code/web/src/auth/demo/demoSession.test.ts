import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDemoSession,
  demoAccountId,
  isDemoAccountId,
  readDemoSession,
  subjectOfToken,
  writeDemoSession,
} from './demoSession';

const token = (payload: object) =>
  `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('demo session store', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a session and forgets it', () => {
    const session = { accessToken: 't', sub: 'abc', expiresAt: '2999-01-01T00:00:00Z' };
    writeDemoSession(session);
    expect(readDemoSession()).toEqual(session);
    clearDemoSession();
    expect(readDemoSession()).toBeNull();
  });

  it('ignores an expired or malformed session', () => {
    writeDemoSession({ accessToken: 't', sub: 'abc', expiresAt: '2000-01-01T00:00:00Z' });
    expect(readDemoSession()).toBeNull();
    window.localStorage.setItem('lotties.demo.session', '{not json');
    expect(readDemoSession()).toBeNull();
    window.localStorage.setItem('lotties.demo.session', JSON.stringify({ accessToken: 1 }));
    expect(readDemoSession()).toBeNull();
  });

  it('reads the subject of a token and rejects garbage', () => {
    expect(subjectOfToken(token({ sub: 'demo-1' }))).toBe('demo-1');
    expect(subjectOfToken(token({ nope: 1 }))).toBeNull();
    expect(subjectOfToken('garbage')).toBeNull();
  });

  it('recognises demo account ids', () => {
    expect(isDemoAccountId(demoAccountId('x'))).toBe(true);
    expect(isDemoAccountId('https://issuer.test|x')).toBe(false);
    expect(isDemoAccountId(null)).toBe(false);
  });
});
