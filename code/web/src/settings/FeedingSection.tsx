import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormControlLabel, FormHelperText, Stack, Switch } from '@mui/material';
import { loadTimeBottles, storeTimeBottles } from '../presets/timeBottlesStorage';

/** Feeding preference of the signed-in account (all its babies): whether a bottle runs as a timer (off by default). */
export function FeedingSection() {
  const { t } = useTranslation();
  const [on, setOn] = useState(() => loadTimeBottles());
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        label={t('feedingAmounts.timeBottles.label')}
        control={
          <Switch
            checked={on}
            onChange={(_, checked) => {
              setOn(checked);
              storeTimeBottles(checked);
            }}
            slotProps={{ input: { 'aria-describedby': 'time-bottles-hint' } }}
          />
        }
      />
      <FormHelperText id="time-bottles-hint">{t('feedingAmounts.timeBottles.hint')}</FormHelperText>
    </Stack>
  );
}
