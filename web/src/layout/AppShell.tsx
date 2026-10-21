import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Container } from '@mui/material';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <SelectedBabyProvider>
      <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <TopBar />
        <Container component="main" maxWidth="md" sx={{ flexGrow: 1, py: 2, pb: 10 }}>
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<CircularProgress aria-label="Loading page" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </Container>
        <BottomNav />
      </Box>
    </SelectedBabyProvider>
  );
}
