import { Button, Snackbar } from '@mui/material';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Shows a snackbar when a new service worker is waiting. Nothing reloads until the user
 * presses "Reload", so unsaved input is never lost. Mounted once, inside App.
 */
export function ReloadPrompt() {
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
      message="New version available"
      action={
        <Button color="primary" size="small" onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
      }
      onClose={() => setNeedRefresh(false)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 80, sm: 24 } }}
    />
  );
}
