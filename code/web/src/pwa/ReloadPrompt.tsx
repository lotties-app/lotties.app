import { Button, Snackbar } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isNativeApp } from '../platform/nativeApp';

/**
 * Registers the service worker (the PWA's offline copy and updates). Mounted once, inside App.
 * Not in the iOS/Android app: its bundled assets are the offline copy and a store release is the
 * update, so no service worker is registered there.
 */
export function ReloadPrompt() {
  return isNativeApp() ? null : <ServiceWorkerReloadPrompt />;
}

/**
 * Shows a snackbar when a new service worker is waiting. Nothing reloads until the user
 * presses "Reload", so unsaved input is never lost.
 */
function ServiceWorkerReloadPrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // Registration failures only mean no offline support; the app keeps working online.
      console.warn('Service worker registration failed', error);
    },
  });

  return (
    <Snackbar
      open={needRefresh}
      message={t('pwa.newVersion')}
      action={
        <Button color="primary" size="small" onClick={() => void updateServiceWorker(true)}>
          {t('common.reload')}
        </Button>
      }
      onClose={() => setNeedRefresh(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 80, sm: 24 } }}
    />
  );
}
