import { useTranslation } from 'react-i18next';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { CONTENT_MAX_WIDTH } from '../theme/tokens';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';

/** Full-bleed page background with a centred content column (max 480px). */
export function AppShell() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  return (
    <SelectedBabyProvider>
      <Box
        sx={{
          minHeight: '100dvh',
          bgcolor: 'background.default',
          pl: 'env(safe-area-inset-left)',
          pr: 'env(safe-area-inset-right)',
        }}
      >
        <Box
          sx={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: CONTENT_MAX_WIDTH,
            mx: 'auto',
          }}
        >
          <TopBar />
          <Box component="main" sx={{ flexGrow: 1, px: 2, py: 1, pb: 12, minWidth: 0 }}>
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<CircularProgress aria-label={t('app.loadingPage')} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </Box>
        </Box>
        <BottomNav />
      </Box>
    </SelectedBabyProvider>
  );
}
