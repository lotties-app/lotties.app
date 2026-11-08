import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { GUIDE_STEP_COUNT, type ProviderId } from './providers';

/**
 * One provider's steps, as a numbered list (the same text in the wizard and on `/help/own-database`).
 * Written from the providers' public pages and not checked on a real account: the note says so.
 */
export function ProviderGuide({
  provider,
  headingLevel = 'h3',
}: {
  provider: ProviderId;
  headingLevel?: 'h2' | 'h3';
}) {
  const { t } = useTranslation();
  const steps = Array.from({ length: GUIDE_STEP_COUNT[provider] }, (_, index) => index + 1);
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component={headingLevel}>
        {t(`byoDatabase.guides.${provider}.title`)}
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
        {steps.map((step) => (
          <Typography key={step} component="li" variant="body2">
            {t(`byoDatabase.guides.${provider}.step${step}` as 'byoDatabase.guides.other.step1')}
          </Typography>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.guides.note')}
      </Typography>
    </Stack>
  );
}
