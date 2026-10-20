import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './useAuth';
import type { LoginRedirectState } from './loginRedirect';

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    );
  }

  if (!isAuthenticated) {
    const state: LoginRedirectState = { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }

  return <Outlet />;
}
