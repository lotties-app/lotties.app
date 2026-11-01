import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useLandingCatalog } from '../i18n/useLandingCatalog';
import { BrandMark } from '../ui/BrandMark';
import { useAuth } from './useAuth';
import type { LoginRedirectState } from './loginRedirect';

/**
 * A signed-out visit to a protected page: goes straight to the identity provider (no page in
 * between) and shows a calm placeholder meanwhile. Started once per mount; when it cannot start,
 * the landing page explains and offers a retry instead of looping.
 */
export function SignInRedirect({ returnTo }: { returnTo: string }) {
  const { t } = useTranslation('landing');
  const catalogReady = useLandingCatalog();
  const { login } = useAuth();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    login(returnTo).catch(() => setFailed(true));
  }, [login, returnTo]);

  if (failed) {
    const state: LoginRedirectState = { from: returnTo, failed: true };
    return <Navigate to="/" replace state={state} />;
  }
  return (
    <Box
      role="status"
      sx={{
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        minHeight: '100dvh',
        gap: 2,
        p: 2,
      }}
    >
      <BrandMark size={64} decorative />
      <Typography color="text.secondary">{catalogReady ? t('signingIn.text') : null}</Typography>
      <CircularProgress size={20} aria-hidden />
    </Box>
  );
}
