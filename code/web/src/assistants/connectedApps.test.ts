import { describe, expect, it } from 'vitest';
import { connectedAppsUrl } from './connectedApps';

describe('connectedAppsUrl', () => {
  it('is the account console Applications page of the realm', () => {
    expect(connectedAppsUrl('https://auth.lotties.app/realms/lotties.app')).toBe(
      'https://auth.lotties.app/realms/lotties.app/account/applications',
    );
  });

  it('ignores trailing slashes and spaces of the authority', () => {
    expect(connectedAppsUrl(' https://id.test/realms/x/ ')).toBe(
      'https://id.test/realms/x/account/applications',
    );
  });
});
