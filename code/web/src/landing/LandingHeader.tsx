import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { BrandMark } from '../ui/BrandMark';
import { PAGE_WIDTH } from './features';

/**
 * Sticky minimal header: the brand and Sign in; for a signed-in visitor (/welcome) "Back to the app"
 * instead.
 */
export function LandingHeader({
  onSignIn,
  signedIn,
}: {
  onSignIn: () => void;
  signedIn?: boolean;
}) {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        pt: 'env(safe-area-inset-top)',
        zIndex: 'appBar',
        bgcolor: 'background.default',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          maxWidth: PAGE_WIDTH,
          mx: 'auto',
          px: 2,
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <BrandMark size={32} showName />
        {signedIn ? (
          <Button
            component={RouterLink}
            to="/"
            variant="contained"
            sx={{ minHeight: 44, flexShrink: 0 }}
          >
            {t('header.backToApp')}
          </Button>
        ) : (
          <Button variant="contained" onClick={onSignIn} sx={{ minHeight: 44, flexShrink: 0 }}>
            {t('header.signIn')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
