import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useAuth } from './useAuth';

/** The OIDC library handles the code exchange; this page only shows progress or failure. */
export function CallbackPage() {
  const { error } = useAuth();
  const { t } = useTranslation();

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', gap: 2, p: 2 }}>
      {error ? (
        <>
          <Alert severity="error">{t('auth.signInFailed')}</Alert>
          <Button component={RouterLink} to="/" variant="contained">
            {t('auth.backToSignIn')}
          </Button>
        </>
      ) : (
        <CircularProgress aria-label={t('auth.signingIn')} />
      )}
    </Box>
  );
}
