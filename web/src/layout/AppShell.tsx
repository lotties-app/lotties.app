import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Box, CircularProgress, Container } from '@mui/material';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <SelectedBabyProvider>
      <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <Container component="main" maxWidth="md" sx={{ flexGrow: 1, py: 2, pb: 10 }}>
          <Suspense fallback={<CircularProgress aria-label="Loading page" />}>
            <Outlet />
          </Suspense>
        </Container>
        <BottomNav />
      </Box>
    </SelectedBabyProvider>
  );
}
