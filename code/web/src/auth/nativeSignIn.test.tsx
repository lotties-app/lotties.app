import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { UserManager, type User } from 'oidc-client-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { fakeNativeShell, type FakeNativeShell } from '../platform/nativeTestKit';
import type { AuthApi } from './AuthContext';
import type { LoginRedirectState } from './loginRedirect';
import { NATIVE_REDIRECT_URI, NativeAuthRedirects } from './nativeAuth';
import { OidcAuthProvider } from './OidcAuthProvider';
import { useAuth } from './useAuth';

const AUTHORITY = 'https://auth.test/realms/lotties.app';
const DISCOVERY = {
  issuer: AUTHORITY,
  authorization_endpoint: `${AUTHORITY}/protocol/openid-connect/auth`,
  token_endpoint: `${AUTHORITY}/protocol/openid-connect/token`,
  end_session_endpoint: `${AUTHORITY}/protocol/openid-connect/logout`,
};

let api: AuthApi | null = null;
let location: { pathname: string; state: unknown } | null = null;

function Capture() {
  const auth = useAuth();
  const current = useLocation();
  useEffect(() => {
    api = auth;
    location = current;
  });
  return <span>{current.pathname}</span>;
}

/** The provider as App mounts it inside the native app (the adapter injected with a fake shell). */
function renderNative(shell: FakeNativeShell) {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/']}>
        <OidcAuthProvider
          config={{ authority: AUTHORITY, clientId: 'lotties-web' }}
          nativeAuth={new NativeAuthRedirects(shell, 30)}
        >
          <Capture />
        </OidcAuthProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  api = null;
  location = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(DISCOVERY), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OidcAuthProvider in the native app', () => {
  it('signs in through the system browser and returns to the requested page', async () => {
    const shell = fakeNativeShell();
    const user = { state: { returnTo: '/day' }, profile: { sub: 'parent' } } as unknown as User;
    const callback = vi.spyOn(UserManager.prototype, 'signinCallback').mockResolvedValue(user);
    renderNative(shell);
    await waitFor(() => expect(api?.isLoading).toBe(false));

    let login!: Promise<void>;
    act(() => {
      login = api!.login('/day');
    });
    await waitFor(() => expect(shell.opened).toHaveLength(1));
    const request = new URL(shell.opened[0]);
    expect(request.searchParams.get('redirect_uri')).toBe(NATIVE_REDIRECT_URI);
    expect(request.searchParams.get('scope')).toBe('openid profile email offline_access');

    const redirect = `${NATIVE_REDIRECT_URI}?code=abc&state=${request.searchParams.get('state')}`;
    await act(async () => {
      shell.openAppUrl(redirect);
      await login;
    });

    expect(callback).toHaveBeenCalledWith(redirect);
    expect(await screen.findByText('/day')).toBeTruthy();
  });

  it('opens account creation in the system browser too', async () => {
    const shell = fakeNativeShell();
    renderNative(shell);
    await waitFor(() => expect(api?.isLoading).toBe(false));

    act(() => {
      void api!.login('/', { register: true });
    });

    await waitFor(() => expect(shell.opened).toHaveLength(1));
    const request = new URL(shell.opened[0]);
    expect(request.pathname).toMatch(/\/protocol\/openid-connect\/registrations$/);
    expect(request.searchParams.get('redirect_uri')).toBe(NATIVE_REDIRECT_URI);
  });

  it('shows the failed sign-in on the landing page when a launch redirect cannot complete', async () => {
    // A request started before the OS stopped the app: its state is still stored.
    const shell = fakeNativeShell();
    const earlier = new UserManager(
      {
        authority: AUTHORITY,
        client_id: 'lotties-web',
        redirect_uri: NATIVE_REDIRECT_URI,
        metadata: DISCOVERY,
      },
      new NativeAuthRedirects(fakeNativeShell()).navigator,
    );
    void earlier.signinRedirect().catch(() => {});
    await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0));
    const stateKey = Object.keys(window.localStorage).find((key) => key.startsWith('oidc.'))!;
    shell.launch = `${NATIVE_REDIRECT_URI}?code=abc&state=${stateKey.slice('oidc.'.length)}`;
    vi.spyOn(UserManager.prototype, 'signinCallback').mockRejectedValue(new Error('expired'));

    renderNative(shell);

    await waitFor(() => expect((location?.state as LoginRedirectState | null)?.failed).toBe(true));
  });
});
