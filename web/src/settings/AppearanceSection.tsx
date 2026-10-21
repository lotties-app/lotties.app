import { FormControlLabel, Switch } from '@mui/material';
import { useThemeMode } from '../theme/ThemeModeContext';

export function AppearanceSection() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <FormControlLabel
      label="Dark theme"
      control={<Switch checked={mode === 'dark'} onChange={toggleMode} />}
    />
  );
}
