import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormControlLabel, FormHelperText, Stack, Switch } from '@mui/material';
import { loadTimeBottles, storeTimeBottles } from '../presets/timeBottlesStorage';

interface Props {
  babyId: string;
}

/** Feeding preferences of this device: whether a bottle runs as a timer (off by default). */
export function FeedingSection({ babyId }: Props) {
  const { t } = useTranslation();
  const [on, setOn] = useState(() => loadTimeBottles(babyId));
  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        label={t('feedingAmounts.timeBottles.label')}
        control={
          <Switch
            checked={on}
            onChange={(_, checked) => {
              setOn(checked);
              storeTimeBottles(babyId, checked);
            }}
            slotProps={{ input: { 'aria-describedby': 'time-bottles-hint' } }}
          />
        }
      />
      <FormHelperText id="time-bottles-hint">{t('feedingAmounts.timeBottles.hint')}</FormHelperText>
    </Stack>
  );
}
