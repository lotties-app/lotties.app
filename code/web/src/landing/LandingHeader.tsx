import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { BrandMark } from '../ui/BrandMark';
import { PAGE_WIDTH } from './features';

/** Sticky minimal header: the brand and Sign in. */
export function LandingHeader({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
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
        <Button variant="contained" onClick={onSignIn} sx={{ minHeight: 44, flexShrink: 0 }}>
          {t('header.signIn')}
        </Button>
      </Box>
    </Box>
  );
}
