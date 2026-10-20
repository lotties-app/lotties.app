import { useMemo } from 'react';
import { CssBaseline, ThemeProvider, Typography, Box, useMediaQuery } from '@mui/material';
import { buildTheme } from './theme';

export default function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => buildTheme(prefersDark ? 'dark' : 'light'), [prefersDark]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box component="main" sx={{ p: 2, minHeight: '100vh' }}>
        <Typography variant="h4" component="h1">
          Baby Routine
        </Typography>
      </Box>
    </ThemeProvider>
  );
}
