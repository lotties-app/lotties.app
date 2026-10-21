import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import LandingPage from '../landing/LandingPage';
import { useNightFeed } from '../theme/NightFeedContext';
import { useThemeMode } from '../theme/ThemeModeContext';

/*
 * Developer-only (route `/dev/landing`, never in production builds): the public landing page with
 * a stubbed sign-in, so it can be looked at in every scheme and language without an identity
 * provider. `?state=default|failed|ended`, `?unsynced=3` (ended), `?scheme=light|dark|night`.
 * A click on Sign in or Create an account records the call in `window.__landingLogin`.
 */

const STATES = ['default', 'failed', 'ended'] as const;
type PreviewState = (typeof STATES)[number];

function stubAuth(state: PreviewState): AuthApi {
  const win = window as unknown as { __landingLogin?: unknown[] };
  return {
    user: null,
    accountId: null,
    isAuthenticated: false,
    isLoading: false,
    error: state === 'failed' ? new Error('preview') : null,
    session: 'active',
    sessionEnded: state === 'ended',
    login: async (returnTo, options) => {
      (win.__landingLogin ??= []).push({ returnTo, ...options });
    },
    logout: async () => {},
    getAccessToken: async () => null,
    renewAccessToken: async () => null,
  };
}

export default function LandingPreview() {
  const [params] = useSearchParams();
  const requested = params.get('state');
  const state = STATES.find((s) => s === requested) ?? 'default';
  const unsynced = params.has('unsynced') ? Number(params.get('unsynced')) : null;
  const auth = useMemo(() => stubAuth(state), [state]);
  const { setMode } = useThemeMode();
  const night = useNightFeed();
  const scheme = params.get('scheme');

  useEffect(() => {
    if (scheme === 'night') {
      if (!night.active) night.toggle();
    } else if (scheme === 'light' || scheme === 'dark') {
      setMode(scheme);
      if (night.active) night.toggle();
    }
    // Applies once per requested scheme, like the other previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);

  return (
    <AuthContext value={auth}>
      <LandingPage unsyncedOverride={state === 'ended' ? unsynced : null} />
    </AuthContext>
  );
}
