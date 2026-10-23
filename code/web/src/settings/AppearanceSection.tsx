import { useTranslation } from 'react-i18next';
import {
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
} from '@mui/material';
import { useThemeMode } from '../theme/ThemeModeContext';
import { useNightFeed } from '../theme/NightFeedContext';
import type { ThemeMode } from '../theme/theme';
import { NIGHT_FEED_SETTINGS, type NightFeedSetting } from '../theme/nightFeed';
import { InstallButton } from '../install/InstallButton';

const OPTIONS: ThemeMode[] = ['system', 'light', 'dark'];

const NIGHT_FEED_LABEL_KEY = {
  off: 'settings.appearance.nightFeedOff',
  ask: 'settings.appearance.nightFeedAsk',
  auto: 'settings.appearance.nightFeedAuto',
} as const satisfies Record<NightFeedSetting, string>;

export function AppearanceSection() {
  const { t } = useTranslation();
  const { mode, setMode } = useThemeMode();
  const nightFeed = useNightFeed();
  return (
    <Stack spacing={2}>
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
      <FormControl>
        <FormLabel id="night-feed-label">{t('settings.appearance.nightFeed')}</FormLabel>
        <RadioGroup
          row
          aria-labelledby="night-feed-label"
          aria-describedby="night-feed-hint"
          value={nightFeed.setting}
          onChange={(_, value) => nightFeed.setSetting(value as NightFeedSetting)}
        >
          {NIGHT_FEED_SETTINGS.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              label={t(NIGHT_FEED_LABEL_KEY[option])}
              control={<Radio />}
            />
          ))}
        </RadioGroup>
        <FormHelperText id="night-feed-hint">
          {t('settings.appearance.nightFeedHint')}
        </FormHelperText>
      </FormControl>
      <InstallButton />
    </Stack>
  );
}
