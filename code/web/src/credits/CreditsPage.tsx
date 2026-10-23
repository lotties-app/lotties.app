import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { PAGE_WIDTH } from '../landing/features';
import { BrandMark } from '../ui/BrandMark';
import { Icon } from '../ui/Icon';
import { CreditsContent } from './CreditsContent';

/**
 * The public credits page (route `/credits`, reachable without signing in, also when signed in):
 * a small header with the brand, the page title as the one h1 and the shared content. Its own lazy
 * chunk, and precached like every other chunk, so it also opens offline.
 */
export default function CreditsPage() {
  const { t } = useTranslation();
  const title = t('credits.title');
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Lotties`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <Box
        component="header"
        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}
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
          <RouterLink to="/" aria-label={t('credits.home')} style={{ color: 'inherit' }}>
            <BrandMark size={32} showName />
          </RouterLink>
        </Box>
      </Box>
      <Box component="main" sx={{ maxWidth: 760, mx: 'auto', px: 2, py: 3, pb: 8 }}>
        <Stack spacing={2}>
          <Button
            component={RouterLink}
            to="/"
            startIcon={<Icon name="arrow-left" size={20} />}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('credits.home')}
          </Button>
          <Typography variant="h4" component="h1">
            {title}
          </Typography>
          <CreditsContent />
        </Stack>
      </Box>
    </Box>
  );
}
