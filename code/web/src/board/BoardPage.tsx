import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { isNativeApp } from '../platform/nativeApp';
import { useOnline } from '../sync/useOnline';
import { Icon } from '../ui/Icon';
import { BoardScreen } from './BoardScreen';
import { useBoardAccess } from './useBoardAccess';

/** The board's width on a computer: room for the list and the drawer side by side. */
export const BOARD_MAX_WIDTH = 1200;

/**
 * The board's own page frame, outside the parents' shell (no baby header, no dock, no quick add of
 * events: nothing of a baby is near it): Back to Hub, the title, then the content.
 */
export function BoardFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        color: 'text.primary',
        pl: 'env(safe-area-inset-left)',
        pr: 'env(safe-area-inset-right)',
      }}
    >
      <Box
        sx={{
          maxWidth: BOARD_MAX_WIDTH,
          mx: 'auto',
          px: 2,
          pt: 'max(8px, env(safe-area-inset-top))',
          pb: 'max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <Box component="header" sx={{ py: 1 }}>
          <Button
            component={RouterLink}
            to="/hub"
            startIcon={<Icon name="arrow-left" size={20} />}
            sx={{ minHeight: 44, ml: -1 }}
          >
            {t('hub.back')}
          </Button>
          <Typography variant="h5" component="h1" sx={{ mt: 0.5 }}>
            {t('board.title')}
          </Typography>
        </Box>
        <Box component="main" sx={{ pt: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * `/hub/board` and `/hub/board/:itemId`: the project board for people with a board role
 * (`GET /board/me`). Online only (nothing of it is stored on the device), never in the native app.
 */
export default function BoardPage() {
  const { t } = useTranslation();
  const online = useOnline();
  const { access, failed, refetch } = useBoardAccess();
  if (isNativeApp()) return <Navigate to="/hub" replace />;

  let content: ReactNode;
  if (!online) {
    // Nothing of the board is kept on the device: without a connection there is nothing to show.
    content = (
      <Alert severity="info" icon={<Icon name="cloud-off" size={20} />}>
        <Typography component="h2" sx={{ fontWeight: 600 }}>
          {t('board.offline.title')}
        </Typography>
        {t('board.offline.text')}
      </Alert>
    );
  } else if (failed) {
    content = (
      <Alert
        severity="error"
        action={
          <Button color="inherit" onClick={refetch} sx={{ minHeight: 44 }}>
            {t('board.retry')}
          </Button>
        }
      >
        {t('board.access.failed')}
      </Alert>
    );
  } else if (access === undefined) {
    content = (
      <Stack spacing={1.5} aria-busy="true" aria-label={t('board.access.checking')}>
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={48} />
        <Skeleton variant="rounded" height={160} />
      </Stack>
    );
  } else if (access === null) {
    content = <Alert severity="info">{t('board.access.none')}</Alert>;
  } else {
    content = <BoardScreen me={access} />;
  }
  return <BoardFrame>{content}</BoardFrame>;
}
