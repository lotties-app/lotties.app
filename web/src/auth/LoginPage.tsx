import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Box, Button, Container, Typography } from '@mui/material';
import { useAuth } from './useAuth';
import type { LoginRedirectState } from './loginRedirect';

export function LoginPage() {
  const { isAuthenticated, isLoading, error, login } = useAuth();
  const from = (useLocation().state as LoginRedirectState | null)?.from ?? '/';

  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <Container maxWidth="xs" sx={{ minHeight: '100dvh', display: 'grid', alignContent: 'center' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Baby Routine
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error.message}
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={isLoading}
          onClick={() => void login(from)}
          sx={{ minHeight: 56 }}
        >
          Sign in
        </Button>
      </Box>
    </Container>
  );
}
