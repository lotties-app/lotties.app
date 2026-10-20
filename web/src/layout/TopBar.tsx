import { AppBar, IconButton, Toolbar } from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useThemeMode } from '../theme/ThemeModeContext';
import { BabySwitcher } from './BabySwitcher';
import { UserMenu } from './UserMenu';

export function TopBar() {
  const { mode, toggleMode } = useThemeMode();

  return (
    <AppBar position="sticky" color="primary" enableColorOnDark>
      <Toolbar>
        <BabySwitcher />
        <IconButton
          color="inherit"
          onClick={toggleMode}
          aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
        <UserMenu />
      </Toolbar>
    </AppBar>
  );
}
