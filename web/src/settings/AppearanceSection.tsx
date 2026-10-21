import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack } from '@mui/material';
import { useThemeMode } from '../theme/ThemeModeContext';
import type { ThemeMode } from '../theme/theme';
import { InstallAppButton } from '../pwa/InstallAppButton';

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export function AppearanceSection() {
  const { mode, setMode } = useThemeMode();
  return (
    <Stack spacing={1}>
      <FormControl>
        <FormLabel id="theme-mode-label">Theme</FormLabel>
        <RadioGroup
          aria-labelledby="theme-mode-label"
          value={mode}
          onChange={(_, value) => setMode(value as ThemeMode)}
        >
          {OPTIONS.map((o) => (
            <FormControlLabel key={o.value} value={o.value} label={o.label} control={<Radio />} />
          ))}
        </RadioGroup>
      </FormControl>
      <InstallAppButton />
    </Stack>
  );
}
