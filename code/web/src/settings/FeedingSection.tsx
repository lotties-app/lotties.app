import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FormControlLabel, FormHelperText, Stack, Switch } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { loadTimeBottles, subscribeTimeBottles } from '../presets/timeBottlesStorage';
import { saveTimeBottles } from '../presets/timeBottlesSync';

/**
 * Feeding preference of the signed-in account (all its babies): whether a bottle runs as a timer (off by default).
 * Saved on the server too, so the voice assistants follow it (`presets/timeBottlesSync.ts`).
 */
export function FeedingSection() {
  const { t } = useTranslation();
  const api = useApiClient();
  const on = useSyncExternalStore(subscribeTimeBottles, loadTimeBottles);
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        label={t('feedingAmounts.timeBottles.label')}
        control={
          <Switch
            checked={on}
            onChange={(_, checked) => {
              void saveTimeBottles(api, checked);
            }}
            slotProps={{ input: { 'aria-describedby': 'time-bottles-hint' } }}
          />
        }
      />
      <FormHelperText id="time-bottles-hint">{t('feedingAmounts.timeBottles.hint')}</FormHelperText>
    </Stack>
  );
}
