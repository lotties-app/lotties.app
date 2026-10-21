import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { UserManager, type SigninRedirectArgs } from 'oidc-client-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { useTestLocale } from '../test/locale';
import type { AuthApi } from './AuthContext';
import { OidcAuthProvider } from './OidcAuthProvider';
import { registrationEndpoint } from './signinRequest';
import { useAuth } from './useAuth';

const AUTHORITY = 'https://issuer.test/realms/baby';
const KEYCLOAK_AUTH = `${AUTHORITY}/protocol/openid-connect/auth`;

function managerWith(authorizationEndpoint: string) {
  return new UserManager({
    authority: AUTHORITY,
    client_id: 'web',
    redirect_uri: 'http://localhost/auth/callback',
    scope: 'openid',
    metadata: { issuer: AUTHORITY, authorization_endpoint: authorizationEndpoint },
    extraQueryParams: { audience: 'api' },
  });
}

let api: AuthApi | null = null;
function Capture() {
  const auth = useAuth();
  useEffect(() => {
    api = auth;
  });
  return null;
}

function renderProvider(manager: UserManager, audience?: string) {
  render(
    <I18nProvider>
      <MemoryRouter>
        <OidcAuthProvider
          config={{ authority: AUTHORITY, clientId: 'web', audience }}
          userManager={manager}
        >
          <Capture />
        </OidcAuthProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

let calls: { args: SigninRedirectArgs; endpoint: string | undefined }[];

beforeEach(() => {
  api = null;
  calls = [];
  vi.spyOn(UserManager.prototype, 'signinRedirect').mockImplementation(async function (
    this: UserManager,
    args?: SigninRedirectArgs,
  ) {
    const metadata = await this.metadataService.getMetadata();
    calls.push({ args: args ?? {}, endpoint: metadata.authorization_endpoint });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registrationEndpoint', () => {
  it('maps the Keycloak authorization endpoint to its registrations endpoint', () => {
    expect(registrationEndpoint(KEYCLOAK_AUTH)).toBe(
      `${AUTHORITY}/protocol/openid-connect/registrations`,
    );
  });

  it('knows no registration endpoint for other providers', () => {
    expect(registrationEndpoint('https://tenant.auth0.com/authorize')).toBeNull();
    expect(registrationEndpoint(undefined)).toBeNull();
  });
});

describe('login', () => {
  it('sends the app language as ui_locales and keeps the audience and the return path', async () => {
    renderProvider(managerWith(KEYCLOAK_AUTH), 'api');
    await waitFor(() => expect(api).not.toBeNull());
    await api!.login('/day');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({
      ui_locales: 'en',
      state: { returnTo: '/day' },
      extraQueryParams: { audience: 'api' },
    });
    expect(calls[0].args.prompt).toBeUndefined();
    expect(calls[0].endpoint).toBe(KEYCLOAK_AUTH);
  });

  it('follows the active language', async () => {
    await useTestLocale('pt-BR');
    renderProvider(managerWith(KEYCLOAK_AUTH));
    await waitFor(() => expect(api).not.toBeNull());
    await api!.login('/');
    expect(calls[0].args.ui_locales).toBe('pt-BR');
    expect(calls[0].args.extraQueryParams).toBeUndefined();
  });

  it('opens Keycloak registration through its registrations endpoint', async () => {
    renderProvider(managerWith(KEYCLOAK_AUTH), 'api');
    await waitFor(() => expect(api).not.toBeNull());
    await api!.login('/', { register: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe(`${AUTHORITY}/protocol/openid-connect/registrations`);
    expect(calls[0].args).toMatchObject({
      ui_locales: 'en',
      state: { returnTo: '/' },
      extraQueryParams: { audience: 'api' },
    });
  });

  it('uses prompt=create on the normal endpoint for other providers', async () => {
    renderProvider(managerWith('https://tenant.example/authorize'));
    await waitFor(() => expect(api).not.toBeNull());
    await api!.login('/', { register: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe('https://tenant.example/authorize');
    expect(calls[0].args).toMatchObject({ prompt: 'create', ui_locales: 'en' });
  });
});
