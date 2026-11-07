import { useEffect, useMemo, type ReactNode } from 'react';
import { AuthContext, type AuthApi } from '../AuthContext';
import { demoAccountId, isExpired, leaveDemo, type DemoSession } from './demoSession';

/**
 * Auth for a demo session: no identity provider. The stored demo token is the access token, it is
 * never renewed, and signing in or out simply ends the demo (the local database goes with it).
 * When the token expires the demo ends and the landing page opens.
 */
export function DemoAuthProvider({
  session,
  children,
}: {
  session: DemoSession;
  children: ReactNode;
}) {
  useEffect(() => {
    if (isExpired(session)) {
      void leaveDemo();
      return;
    }
    const wait = Date.parse(session.expiresAt) - Date.now();
    // setTimeout caps at ~24.8 days; a demo lives days.
    const id = setTimeout(() => void leaveDemo(), Math.min(wait, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [session]);

  const value = useMemo<AuthApi>(
    () => ({
      user: null,
      accountId: demoAccountId(session.sub),
      isAuthenticated: true,
      isLoading: false,
      error: null,
      session: 'active',
      sessionEnded: false,
      login: (_returnTo, options) => leaveDemo({ register: options?.register }),
      logout: () => leaveDemo(),
      getAccessToken: async () => session.accessToken,
      // The server rejected the token (account gone): the demo is over.
      renewAccessToken: async () => {
        void leaveDemo();
        return null;
      },
    }),
    [session],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}
