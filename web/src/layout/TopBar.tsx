import { AppBar, Button, IconButton, Toolbar } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useThemeMode } from '../theme/ThemeModeContext';
import { UserMenu } from './UserMenu';

export function TopBar() {
  const { mode, toggleMode } = useThemeMode();

  return (
    <AppBar position="sticky" color="primary" enableColorOnDark>
      <Toolbar>
        {/* Placeholder: replaced by the real baby switcher in a later task. */}
        <Button
          color="inherit"
          endIcon={<ArrowDropDownIcon />}
          sx={{ minHeight: 48, flexGrow: 1, justifyContent: 'flex-start' }}
        >
          Baby (placeholder)
        </Button>
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
