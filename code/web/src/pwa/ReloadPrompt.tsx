import { useEffect } from 'react';
import { Button } from '@mui/material';
import { AppSnackbar } from '../ui/AppSnackbar';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isNativeApp } from '../platform/nativeApp';
import { setRegistration, setReload, setWaiting } from './updateStore';

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
 * presses "Reload", so unsaved input is never lost. The registration, the waiting flag and the
 * reload function also feed the update store behind Hub > Check for updates.
 */
function ServiceWorkerReloadPrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      setRegistration(registration);
    },
    onRegisterError(error) {
      // Registration failures only mean no offline support; the app keeps working online.
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    setReload(updateServiceWorker);
    return () => setReload(undefined);
  }, [updateServiceWorker]);
  useEffect(() => {
    setWaiting(needRefresh);
  }, [needRefresh]);

  return (
    <AppSnackbar
      open={needRefresh}
      message={t('pwa.newVersion')}
      action={
        <Button color="primary" size="small" onClick={() => void updateServiceWorker(true)}>
          {t('common.reload')}
        </Button>
      }
      onClose={() => setNeedRefresh(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    />
  );
}
