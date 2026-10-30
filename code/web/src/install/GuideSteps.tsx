import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { DeviceHint } from './DeviceHint';
import type { Hint, StepKey } from './guides';

/** The drawing (when there is one) and the numbered steps, side by side from 600 px. */
export function GuideSteps({ hint, steps }: { hint: Hint | null; steps: readonly StepKey[] }) {
  const { t } = useTranslation();
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { xs: 'center', sm: 'flex-start' } }}
    >
      {hint && (
        <Box sx={{ flexShrink: 0, width: hint.device === 'phone' ? 120 : 220, maxWidth: '100%' }}>
          <DeviceHint hint={hint} />
        </Box>
      )}
      <Box component="ol" sx={{ m: 0, pl: 3, minWidth: 0, alignSelf: 'stretch' }}>
        {steps.map((key) => (
          <Box component="li" key={key} sx={{ mb: 1, overflowWrap: 'anywhere' }}>
            <Typography component="span">{t(key)}</Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
