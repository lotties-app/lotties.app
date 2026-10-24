import { useTranslation } from 'react-i18next';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { canLog } from '../baby/permissions';
import { BottleLevelPromptHost } from '../events/BottleLevelPromptHost';
import { DeletedEventSnackbar } from '../events/DeletedEventSnackbar';
import { RejectedChangeSnackbar } from '../sync/RejectedChangeSnackbar';
import { NotificationLinkProvider } from '../notifications/NotificationLinkProvider';
import { useCloseResolvedNotifications } from '../notifications/useCloseResolvedNotifications';
import { usePushReconcile } from '../notifications/usePushReconcile';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { CONTENT_MAX_WIDTH } from '../theme/tokens';
import { AddSheetProvider } from './AddSheetProvider';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { NAV_CONTENT_PADDING } from './navMetrics';
import { OffTabAdd } from './OffTabAdd';
import { SessionBanner } from './SessionBanner';
import { NightFeedBanner } from './NightFeedBanner';

/** Tabs that open the More sheet themselves; every other page gets `OffTabAdd`. */
const OWN_ADD_FLOW = ['/', '/day'];

function ShellBody() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { baby } = useSelectedBaby();
  const writable = !!baby && canLog(baby);
  usePushReconcile();
  useCloseResolvedNotifications();
  return (
    <AddSheetProvider enabled={writable}>
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
          <TopBar baby={baby} />
          <SessionBanner />
          <NightFeedBanner />
          <Box
            component="main"
            sx={{ flexGrow: 1, px: 2, py: 1, pb: NAV_CONTENT_PADDING, minWidth: 0 }}
          >
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<CircularProgress aria-label={t('app.loadingPage')} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </Box>
        </Box>
        <BottomNav />
        <DeletedEventSnackbar />
        <BottleLevelPromptHost />
        <RejectedChangeSnackbar />
        <UndoSnackbar />
        {writable && !OWN_ADD_FLOW.includes(pathname) && <OffTabAdd key={baby.id} baby={baby} />}
      </Box>
    </AddSheetProvider>
  );
}

/** Full-bleed page background with a centred content column (max 480px). */
export function AppShell() {
  return (
    <SelectedBabyProvider>
      <NotificationLinkProvider>
        <ShellBody />
      </NotificationLinkProvider>
    </SelectedBabyProvider>
  );
}
