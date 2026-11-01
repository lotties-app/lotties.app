import { describe, expect, it } from 'vitest';
import { readConfig } from './appConfig';

describe('readConfig', () => {
  it('reports missing required variables', () => {
    expect(readConfig({ VITE_OIDC_CLIENT_ID: 'x' })).toEqual({
      ok: false,
      missing: ['VITE_OIDC_AUTHORITY'],
    });
  });

  it('builds config and trims trailing slashes from the api url', () => {
    const result = readConfig({
      VITE_OIDC_AUTHORITY: 'https://idp/',
      VITE_OIDC_CLIENT_ID: 'id',
      VITE_API_BASE_URL: 'http://api///',
    });
    expect(result).toEqual({
      ok: true,
      config: {
        apiBaseUrl: 'http://api',
        oidc: { authority: 'https://idp/', clientId: 'id', audience: undefined },
      },
    });
  });
});
