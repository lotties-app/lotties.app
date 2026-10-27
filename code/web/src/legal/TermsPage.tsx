import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { PublicTopBar } from '../landing/PublicTopBar';
import { VersionLine } from '../ui/VersionLine';
import { TermsContent } from './TermsContent';

/**
 * The public terms of use (route `/terms`, no sign-in, also when signed in): the public top bar (Back, Home), the title as the one
 * h1 and the terms. Its own lazy chunk, precached like every chunk and served by the app shell fallback, so it opens offline too.
 */
export default function TermsPage() {
  const { t } = useTranslation();
  const title = t('legal.terms.title');
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Lotties`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <PublicTopBar />
      <Box component="main" sx={{ maxWidth: 760, mx: 'auto', px: 2, py: 3, pb: 8 }}>
        <Stack spacing={2}>
          <Typography variant="h4" component="h1">
            {title}
          </Typography>
          <TermsContent />
        </Stack>
        <Box component="footer" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <VersionLine brand />
        </Box>
      </Box>
    </Box>
  );
}
