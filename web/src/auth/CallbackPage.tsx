import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useAuth } from './useAuth';

/** The OIDC library handles the code exchange; this page only shows progress or failure. */
export function CallbackPage() {
  const { error } = useAuth();

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', gap: 2, p: 2 }}>
      {error ? (
        <>
          <Alert severity="error">{error.message}</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Back to sign in
          </Button>
        </>
      ) : (
        <CircularProgress aria-label="Signing in" />
      )}
    </Box>
  );
}
