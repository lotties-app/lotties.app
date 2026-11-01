import { lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { useAuth } from '../auth/useAuth';

// The landing page is its own chunk: signed-in visitors never download it.
const LandingPage = lazy(() => import('./LandingPage'));

/**
 * Layout route above the protected app: at `/` a signed-out visitor sees the public landing page;
 * everything else (and a signed-in or still-loading `/`) falls through to the routes below.
 */
export function LandingGate() {
  const { isAuthenticated, isLoading } = useAuth();
  const { pathname } = useLocation();
  if (pathname !== '/' || isLoading || isAuthenticated) return <Outlet />;
  return (
    <Suspense fallback={<Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }} />}>
      <LandingPage />
    </Suspense>
  );
}
