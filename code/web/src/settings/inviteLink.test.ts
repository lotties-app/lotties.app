import { describe, expect, it } from 'vitest';
import { inviteLink } from './inviteLink';

describe('inviteLink', () => {
  it('puts the token in the URL fragment, never in the path', () => {
    const link = inviteLink('abc_DEF-123');
    expect(link).toBe(`${window.location.origin}/invite#abc_DEF-123`);
    expect(new URL(link).pathname).toBe('/invite');
  });
});
