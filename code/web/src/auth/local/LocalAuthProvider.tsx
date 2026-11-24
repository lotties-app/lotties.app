import { useMemo, type ReactNode } from 'react';
import { AuthContext, type AuthApi } from '../AuthContext';

/** Well-known subject identifier matching the API's LocalCurrentUser.LocalSubject. */
const LOCAL_SUBJECT = 'local-self-hosted-user';

/** Well-known issuer matching the API's LocalCurrentUser.LocalIssuer. */
const LOCAL_ISSUER = 'local';

/** Synthetic account ID derived from the local subject, matching demoAccountId format. */
const LOCAL_ACCOUNT_ID = `${LOCAL_ISSUER}:${LOCAL_SUBJECT}`;

/**
 * Auth provider for unauthenticated local/self-hosted deployments. Provides a permanent synthetic
 * user context without OIDC, enabling single-user operation without registration or sign-in.
 * Used when VITE_LOCAL_MODE=true is set at build time.
 */
export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthApi>(
    () => ({
      user: null,
      accountId: LOCAL_ACCOUNT_ID,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      session: 'active',
      sessionEnded: false,
      login: async () => {
        // No-op in local mode: already authenticated with synthetic user.
      },
      logout: async () => {
        // No-op in local mode: no session to end. Reload to reset local state if needed.
        window.location.reload();
      },
      getAccessToken: async () => null,
      renewAccessToken: async () => null,
    }),
    [],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}