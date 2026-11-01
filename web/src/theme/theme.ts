import { createTheme } from '@mui/material/styles';

export type ColorMode = 'light' | 'dark';

export function buildTheme(mode: ColorMode) {
  return createTheme({
    palette: { mode, primary: { main: '#1976d2' } },
    components: {
      MuiIconButton: { styleOverrides: { root: { minWidth: 48, minHeight: 48 } } },
      MuiBottomNavigationAction: { styleOverrides: { root: { minHeight: 56 } } },
    },
  });
}
