import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { useAuth } from '../auth/useAuth';
import { useEndedSessionUnsynced } from '../auth/useEndedSessionUnsynced';
import type { LoginRedirectState } from '../auth/loginRedirect';
import { useLandingCatalog } from '../i18n/useLandingCatalog';
import { DataChoiceStrip } from './DataChoiceStrip';
import { FeatureGrid } from './FeatureGrid';
import { Hero } from './Hero';
import { ImportantNotice } from './ImportantNotice';
import { InstallStrip } from './InstallStrip';
import { LandingFooter } from './LandingFooter';
import { LandingHeader } from './LandingHeader';
import { OpenSourceStrip } from './OpenSourceStrip';
import { SessionNotice, type NoticeKind } from './SessionNotice';
import { PhoneAppStrip } from './PhoneAppStrip';
import { ShowcaseStrip } from './ShowcaseStrip';
import { StepsStrip } from './StepsStrip';
import { StoryStrip } from './StoryStrip';

/** Visible only while it has keyboard focus. */
const SKIP_LINK_SX = {
  position: 'absolute',
  left: 8,
  top: -100,
  zIndex: 'tooltip',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 2,
  py: 1.5,
  borderRadius: 2,
  '&:focus': { top: 8 },
} as const;

/**
 * The public home page (route `/` while signed out). Sign in and Create an account start the
 * identity provider redirect straight away; a failed or ended sign-in explains itself in a card
 * above the hero. Loaded as its own chunk, so the signed-in app only loads it on /welcome, where a
 * signed-in person opens it on purpose (`welcome`: "Back to the app" instead of sign-in).
 */
export default function LandingPage({
  unsyncedOverride,
  welcome = false,
}: {
  unsyncedOverride?: number | null;
  welcome?: boolean;
}) {
  const { t } = useTranslation('landing');
  const ready = useLandingCatalog();
  const { login, error, sessionEnded } = useAuth();
  const state = useLocation().state as LoginRedirectState | null;
  const from = state?.from ?? '/';
  const [startFailed, setStartFailed] = useState(false);
  const countedUnsynced = useEndedSessionUnsynced();
  const unsynced = unsyncedOverride === undefined ? countedUnsynced : unsyncedOverride;

  // "Create my real account" from a demo lands here with ?signup=1: go straight to the sign-up.
  const [params] = useSearchParams();
  const signup = params.get('signup') === '1' && !welcome;
  const signupStarted = useRef(false);
  useEffect(() => {
    if (!signup || signupStarted.current) return;
    signupStarted.current = true;
    login('/', { register: true }).catch(() => setStartFailed(true));
  }, [signup, login]);

  const title = ready ? t('meta.title') : null;
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  if (!ready) return <Box sx={{ minHeight: '100dvh' }} />;

  const start = (register: boolean) => {
    setStartFailed(false);
    login(from, register ? { register: true } : undefined).catch(() => setStartFailed(true));
  };
  const kind: NoticeKind | null = welcome
    ? null
    : error || state?.failed || startFailed
      ? 'failed'
      : sessionEnded
        ? 'ended'
        : null;

  return (
    <Box sx={{ position: 'relative', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Button component="a" href="#landing-main" sx={SKIP_LINK_SX}>
        {t('skipToContent')}
      </Button>
      <LandingHeader onSignIn={() => start(false)} signedIn={welcome} />
      <Box component="main" id="landing-main" tabIndex={-1} sx={{ outline: 'none' }}>
        <Hero
          notice={
            kind && <SessionNotice kind={kind} unsynced={unsynced} onSignIn={() => start(false)} />
          }
          onSignIn={() => start(false)}
          onRegister={() => start(true)}
          signedIn={welcome}
        />
        <StoryStrip />
        <InstallStrip />
        <FeatureGrid />
        <ShowcaseStrip />
        <PhoneAppStrip />
        <StepsStrip />
        <DataChoiceStrip />
        <ImportantNotice />
        <OpenSourceStrip />
      </Box>
      <LandingFooter />
    </Box>
  );
}
