import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthProvider as OidcProvider, useAuth as useOidc } from 'react-oidc-context';
import { UserManager, WebStorageStateStore, type INavigator, type User } from 'oidc-client-ts';
import type { AppConfig } from '../config/appConfig';
import { isNativeApp } from '../platform/nativeApp';
import { capacitorShell } from '../platform/nativeShell';
import { accountDatabaseName } from '../session/accountDatabase';
import { AuthContext, accountIdOf, type AuthApi, type SessionState } from './AuthContext';
import { forgetEndedSession, readEndedSession, rememberEndedSession } from './endedSession';
import type { LoginRedirectState } from './loginRedirect';
import {
  NATIVE_POST_LOGOUT_REDIRECT_URI,
  NATIVE_REDIRECT_URI,
  NativeAuthRedirects,
} from './nativeAuth';
import { SessionRenewal, type RenewalStatus } from './sessionRenewal';
import { registerRedirect, signinArgs, type LoginState } from './signinRequest';

interface Props {
  config: AppConfig['oidc'];
  /** Injected in tests; built from `config` otherwise. */
  userManager?: UserManager;
  /**
   * The system-browser sign-in of the iOS/Android app. Injected in tests; otherwise created when
   * `isNativeApp()`, and `null` in a browser (the library's own redirect, unchanged).
   */
  nativeAuth?: NativeAuthRedirects | null;
  children: ReactNode;
}

const userStore = () => new WebStorageStateStore({ store: window.localStorage });

/**
 * Silent renew is driven by `SessionRenewal` (single-flight, offline-aware), not by the library:
 * its automatic renew ignores a token that already expired before the app opened and would race
 * our own refresh with the same (possibly rotating) refresh token.
 * The native app returns through its URL scheme (auth/nativeAuth.ts) instead of the web origin;
 * everything else (stores, scopes, renewal, per-account data) is the same.
 */
function createUserManager(
  config: AppConfig['oidc'],
  native: NativeAuthRedirects | null,
): UserManager {
  return new UserManager(
    {
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: native ? NATIVE_REDIRECT_URI : `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: native
        ? NATIVE_POST_LOGOUT_REDIRECT_URI
        : `${window.location.origin}/login`,
      scope: 'openid profile email offline_access',
      response_type: 'code',
      automaticSilentRenew: false,
      extraQueryParams: config.audience ? { audience: config.audience } : undefined,
      userStore: userStore(),
    },
    native?.navigator,
  );
}

export function OidcAuthProvider({ config, userManager: injected, nativeAuth, children }: Props) {
  const navigate = useNavigate();
  const [native] = useState(() =>
    nativeAuth !== undefined
      ? nativeAuth
      : isNativeApp()
        ? new NativeAuthRedirects(capacitorShell)
        : null,
  );
  const [userManager] = useState(() => injected ?? createUserManager(config, native));

  const handleSigninCallback = (user: User | void) => {
    const state = (user?.state ?? {}) as LoginState;
    navigate(state.returnTo || '/', { replace: true });
  };
  useNativeRedirects(native, userManager, handleSigninCallback);

  return (
    <OidcProvider userManager={userManager} onSigninCallback={handleSigninCallback}>
      <OidcBridge
        authority={config.authority}
        audience={config.audience}
        userManager={userManager}
        redirectNavigator={native?.navigator}
      >
        {children}
      </OidcBridge>
    </OidcProvider>
  );
}

/**
 * The native app's redirects come back as app URLs, not page loads (react-oidc-context only reads
 * the page URL): completed here, then the same navigation as the web callback.
 */
function useNativeRedirects(
  native: NativeAuthRedirects | null,
  userManager: UserManager,
  onSignedIn: (user: User) => void,
) {
  const navigate = useNavigate();
  const latest = useRef({ navigate, onSignedIn });
  useEffect(() => {
    latest.current = { navigate, onSignedIn };
  });
  useEffect(() => {
    if (!native) return;
    return native.attach(userManager, {
      signedIn: (user) => latest.current.onSignedIn(user),
      signInFailed: () => {
        const state: LoginRedirectState = { failed: true };
        latest.current.navigate('/', { replace: true, state });
      },
      signedOut: () => latest.current.navigate('/', { replace: true }),
    });
  }, [native, userManager]);
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
  audience,
  userManager,
  redirectNavigator,
  children,
}: {
  authority: string;
  audience?: string;
  userManager: UserManager;
  /** The navigator `userManager` was built with, when not the library's default. */
  redirectNavigator?: INavigator;
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
    login: (returnTo, options) =>
      options?.register
        ? registerRedirect(userManager, signinArgs(returnTo, audience), redirectNavigator)
        : oidc.signinRedirect({
            ...signinArgs(returnTo, audience),
            // The system browser keeps the identity provider's cookie, so after a sign-out (or a sign-out whose
            // browser step never finished) it would sign the previous user straight back in. Ask every time.
            ...(redirectNavigator ? { prompt: 'login' } : {}),
          }),
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
