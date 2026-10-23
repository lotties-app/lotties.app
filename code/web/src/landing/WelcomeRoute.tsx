import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { useAuth } from '../auth/useAuth';

// The same chunk as the landing page at `/`.
const LandingPage = lazy(() => import('./LandingPage'));

const BLANK = <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }} />;

/**
 * `/welcome`: the landing page for a signed-in person who opens it on purpose (Hub > Home page),
 * with "Back to the app" instead of sign-in. `/` keeps opening the app when signed in
 * (`LandingGate`); a signed-out visitor here goes to `/`, where the landing page already is.
 */
export function WelcomeRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return BLANK;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={BLANK}>
      <LandingPage welcome />
    </Suspense>
  );
}
