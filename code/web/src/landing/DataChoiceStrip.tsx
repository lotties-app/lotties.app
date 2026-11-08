import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { PAGE_WIDTH } from './features';

/**
 * "Your data, your choice": the bring-your-own-database option in plain words
 * (docs/BYO-DATABASE.md, docs/design/47-bring-your-own-database.md section 10). An option, off by
 * default for now; Lotties hosting stays the default; never more than the code does (the landing
 * test scans it with `findForbiddenClaims`).
 */
export function DataChoiceStrip() {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="section"
      aria-labelledby="landing-data-choice"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Box
        sx={(theme) => ({
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3,
          bgcolor: (theme.vars ?? theme).palette.surfaceRaised,
          border: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Stack spacing={1.5}>
          <Typography id="landing-data-choice" variant="h4" component="h2">
            {t('dataChoice.title')}
          </Typography>
          <Typography>{t('dataChoice.body')}</Typography>
          <Typography>{t('dataChoice.honest')}</Typography>
          <Typography color="text.secondary">{t('dataChoice.availability')}</Typography>
        </Stack>
      </Box>
    </Box>
  );
}
