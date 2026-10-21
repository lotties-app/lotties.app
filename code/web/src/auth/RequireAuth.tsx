import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, CircularProgress } from '@mui/material';
import { SignInRedirect } from './SignInRedirect';
import { useAuth } from './useAuth';
import type { LoginRedirectState } from './loginRedirect';

/**
 * Protected routes. Signed out, the visitor goes straight to the identity provider and returns to
 * the page. After a sign-in error or an ended session the landing page is shown instead (with its
 * explanation and a button), so a failing redirect can never loop.
 */
export function RequireAuth() {
  const { isAuthenticated, isLoading, error, sessionEnded } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label={t('common.loading')} />
      </Box>
    );
  }

  if (isAuthenticated) return <Outlet />;

  const from = location.pathname + location.search;
  if (error || sessionEnded) {
    const state: LoginRedirectState = { from };
    return <Navigate to="/" replace state={state} />;
  }
  return <SignInRedirect returnTo={from} />;
}
