import { FormControlLabel, Stack, Switch } from '@mui/material';
import { useThemeMode } from '../theme/ThemeModeContext';
import { InstallAppButton } from '../pwa/InstallAppButton';

export function AppearanceSection() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <Stack spacing={1}>
      <FormControlLabel
        label="Dark theme"
        control={<Switch checked={mode === 'dark'} onChange={toggleMode} />}
      />
      <InstallAppButton />
    </Stack>
  );
}
