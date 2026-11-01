import { useTranslation } from 'react-i18next';
import { Alert, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { formatTime } from '../i18n/format';
import { isNativeApp } from '../platform/nativeApp';
import { applyUpdate, checkForUpdates, useUpdateSnapshot } from '../pwa/updateStore';
import { RADIUS } from '../theme/tokens';

/**
 * Hub > Check for updates: asks the browser for the newest service worker and says plainly what
 * happened: checking, up to date, a new version ready (reload to switch) or a failed check. The
 * state is announced politely; nothing reloads until the person presses the button, so unsynced
 * work is never cut off.
 */
export function UpdatesScreen() {
  const { t } = useTranslation();
  const { state, checkedAt } = useUpdateSnapshot();
  const { version } = readBuildInfo();
  const busy = state === 'checking';

  return (
    <Paper sx={{ p: 2.5, borderRadius: `${RADIUS.card}px` }}>
      <Stack spacing={2}>
        <Typography color="text.secondary">{t('hub.updates.current', { version })}</Typography>

        {/* One live region carries every state, so a screen reader hears each change. */}
        <div role="status" aria-live="polite" data-testid="update-status">
          {busy && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} aria-hidden />
              <Typography>{t('hub.updates.checking')}</Typography>
            </Stack>
          )}
          {state === 'upToDate' && (
            <Alert severity="success">
              {t('hub.updates.upToDate')}
              {checkedAt !== null &&
                ` ${t('hub.updates.checkedAt', { time: formatTime(checkedAt) })}`}
            </Alert>
          )}
          {state === 'ready' && (
            <Alert severity="info">
              <Typography sx={{ fontWeight: 600 }}>{t('hub.updates.ready')}</Typography>
              <Typography variant="body2">{t('hub.updates.readyHint')}</Typography>
            </Alert>
          )}
          {state === 'error' && <Alert severity="warning">{t('hub.updates.error')}</Alert>}
          {state === 'unsupported' && (
            <Alert severity="info">
              {isNativeApp()
                ? t('hub.updates.unsupportedNative')
                : t('hub.updates.unsupportedBrowser')}
            </Alert>
          )}
        </div>

        {state === 'ready' ? (
          <Button
            variant="contained"
            onClick={() => void applyUpdate()}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {t('hub.updates.reload')}
          </Button>
        ) : (
          state !== 'unsupported' && (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => void checkForUpdates()}
              sx={{ minHeight: 48, alignSelf: 'flex-start' }}
            >
              {state === 'error' ? t('hub.updates.retry') : t('hub.updates.check')}
            </Button>
          )
        )}
      </Stack>
    </Paper>
  );
}
