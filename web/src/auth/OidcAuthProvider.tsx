import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthProvider as OidcProvider, useAuth as useOidc } from 'react-oidc-context';
import { WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AppConfig } from '../config/appConfig';
import { AuthContext, accountIdOf, type AuthApi } from './AuthContext';

interface LoginState {
  returnTo?: string;
}

interface Props {
  config: AppConfig['oidc'];
  children: ReactNode;
}

const userStore = new WebStorageStateStore({ store: window.localStorage });

export function OidcAuthProvider({ config, children }: Props) {
  const navigate = useNavigate();

  const handleSigninCallback = (user: User | void) => {
    const state = (user?.state ?? {}) as LoginState;
    navigate(state.returnTo || '/', { replace: true });
  };

  return (
    <OidcProvider
      authority={config.authority}
      client_id={config.clientId}
      redirect_uri={`${window.location.origin}/auth/callback`}
      post_logout_redirect_uri={`${window.location.origin}/login`}
      scope="openid profile email offline_access"
      response_type="code"
      automaticSilentRenew
      extraQueryParams={config.audience ? { audience: config.audience } : undefined}
      userStore={userStore}
      onSigninCallback={handleSigninCallback}
    >
      <OidcBridge authority={config.authority}>{children}</OidcBridge>
    </OidcProvider>
  );
}

function OidcBridge({ authority, children }: { authority: string; children: ReactNode }) {
  const oidc = useOidc();
  const profile = oidc.user?.profile;
  const accountId =
    oidc.isAuthenticated && profile?.sub
      ? accountIdOf(profile.iss || authority, profile.sub)
      : null;

  const value: AuthApi = {
    user: profile ? { name: profile.name, email: profile.email, picture: profile.picture } : null,
    accountId,
    isAuthenticated: oidc.isAuthenticated,
    isLoading: oidc.isLoading,
    error: oidc.error ?? null,
    login: (returnTo) => oidc.signinRedirect({ state: { returnTo } satisfies LoginState }),
    logout: async () => {
      try {
        await oidc.signoutRedirect();
      } catch {
        // Provider without an end_session_endpoint: clear the local session only.
        await oidc.removeUser();
      }
    },
    getAccessToken: async () => oidc.user?.access_token ?? null,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
