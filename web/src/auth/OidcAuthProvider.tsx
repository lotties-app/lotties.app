import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthProvider as OidcProvider, useAuth as useOidc } from 'react-oidc-context';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { AppConfig } from '../config/appConfig';
import { accountDatabaseName } from '../session/accountDatabase';
import { AuthContext, accountIdOf, type AuthApi, type SessionState } from './AuthContext';
import { forgetEndedSession, readEndedSession, rememberEndedSession } from './endedSession';
import { SessionRenewal, type RenewalStatus } from './sessionRenewal';

interface LoginState {
  returnTo?: string;
}

interface Props {
  config: AppConfig['oidc'];
  /** Injected in tests; built from `config` otherwise. */
  userManager?: UserManager;
  children: ReactNode;
}

const userStore = () => new WebStorageStateStore({ store: window.localStorage });

/**
 * Silent renew is driven by `SessionRenewal` (single-flight, offline-aware), not by the library:
 * its automatic renew ignores a token that already expired before the app opened and would race
 * our own refresh with the same (possibly rotating) refresh token.
 */
function createUserManager(config: AppConfig['oidc']): UserManager {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    scope: 'openid profile email offline_access',
    response_type: 'code',
    automaticSilentRenew: false,
    extraQueryParams: config.audience ? { audience: config.audience } : undefined,
    userStore: userStore(),
  });
}

export function OidcAuthProvider({ config, userManager: injected, children }: Props) {
  const navigate = useNavigate();
  const [userManager] = useState(() => injected ?? createUserManager(config));

  const handleSigninCallback = (user: User | void) => {
    const state = (user?.state ?? {}) as LoginState;
    navigate(state.returnTo || '/', { replace: true });
  };

  return (
    <OidcProvider userManager={userManager} onSigninCallback={handleSigninCallback}>
      <OidcBridge authority={config.authority} userManager={userManager}>
        {children}
      </OidcBridge>
    </OidcProvider>
  );
}

function sessionOf(status: RenewalStatus): SessionState {
  if (status === 'renewing') return 'renewing';
  return status === 'waiting' ? 'waiting' : 'active';
}

/** Ends a session whose refresh token was rejected; the account's local database is kept. */
function useRenewal(userManager: UserManager, authority: string) {
  const [renewal] = useState(
    () =>
      new SessionRenewal({
        userManager,
        onEnded: async () => {
          const user = await userManager.getUser().catch(() => null);
          const sub = user?.profile.sub;
          rememberEndedSession(
            sub ? accountDatabaseName(accountIdOf(user.profile.iss || authority, sub)) : null,
          );
          await userManager.removeUser();
        },
      }),
  );
  useEffect(() => {
    renewal.start();
    const renewSoon = () => void renewal.renew({ force: true }).catch(() => {});
    userManager.events.addAccessTokenExpiring(renewSoon);
    return () => {
      userManager.events.removeAccessTokenExpiring(renewSoon);
      renewal.stop();
    };
  }, [renewal, userManager]);
  return renewal;
}

function OidcBridge({
  authority,
  userManager,
  children,
}: {
  authority: string;
  userManager: UserManager;
  children: ReactNode;
}) {
  const oidc = useOidc();
  const renewal = useRenewal(userManager, authority);
  const status = useSyncExternalStore(renewal.subscribe, renewal.getSnapshot);
  // A session that ended before this page load (the marker survives reloads).
  const [endedEarlier] = useState(() => readEndedSession() !== undefined);
  const user = oidc.user;

  // Opening the app with an expired token: renew in the background, the app opens meanwhile.
  // A fresh, valid sign-in clears an ended or waiting state.
  useEffect(() => {
    if (!user) return;
    if (!user.expired) {
      renewal.reset();
      forgetEndedSession();
      return;
    }
    if (user.refresh_token) void renewal.renew().catch(() => {});
  }, [user, renewal]);

  const profile = user?.profile;
  // With a refresh token the session lives on while the access token is stale (offline-first);
  // without one, the library's own (expiry-based) state decides, as before.
  const isAuthenticated =
    status !== 'ended' && !!user && (user.refresh_token ? true : oidc.isAuthenticated);
  const accountId =
    isAuthenticated && profile?.sub ? accountIdOf(profile.iss || authority, profile.sub) : null;

  const value: AuthApi = {
    user: profile ? { name: profile.name, email: profile.email, picture: profile.picture } : null,
    accountId,
    isAuthenticated,
    isLoading: oidc.isLoading,
    error: oidc.error ?? null,
    session: sessionOf(status),
    sessionEnded: !isAuthenticated && (status === 'ended' || endedEarlier),
    login: (returnTo) => oidc.signinRedirect({ state: { returnTo } satisfies LoginState }),
    logout: async () => {
      try {
        await oidc.signoutRedirect();
      } catch {
        // Provider without an end_session_endpoint: clear the local session only.
        await oidc.removeUser();
      }
    },
    getAccessToken: () => renewal.getAccessToken(),
    renewAccessToken: async () => (await renewal.renew({ force: true })).access_token,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
