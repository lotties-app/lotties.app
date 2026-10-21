import { useTranslation } from 'react-i18next';
import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack } from '@mui/material';
import { useThemeMode } from '../theme/ThemeModeContext';
import type { ThemeMode } from '../theme/theme';
import { InstallAppButton } from '../pwa/InstallAppButton';

const OPTIONS: ThemeMode[] = ['system', 'dark', 'light'];

export function AppearanceSection() {
  const { t } = useTranslation();
  const { mode, setMode } = useThemeMode();
  return (
    <Stack spacing={1}>
      <FormControl>
        <FormLabel id="theme-mode-label">{t('settings.appearance.theme')}</FormLabel>
        <RadioGroup
          aria-labelledby="theme-mode-label"
          value={mode}
          onChange={(_, value) => setMode(value as ThemeMode)}
        >
          {OPTIONS.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              label={t(`settings.appearance.${option}`)}
              control={<Radio />}
            />
          ))}
        </RadioGroup>
      </FormControl>
      <InstallAppButton />
    </Stack>
  );
}
