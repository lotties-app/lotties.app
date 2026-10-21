import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Alert, Button } from '@mui/material';
import { useAuth } from '../auth/useAuth';
import { useSyncStatus } from '../sync/SyncEngineContext';
import { useOnline } from '../sync/useOnline';

/** A renewal that finishes this fast is not worth announcing (no flash on every cold start). */
export const RENEWING_NOTICE_DELAY_MS = 800;

/** `true` once `key` stayed set for `delayMs` (`null` = inactive). */
function useDelayed(key: string | null, delayMs: number): boolean {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const id = setTimeout(() => setReady(key), delayMs);
    return () => clearTimeout(id);
  }, [key, delayMs]);
  return key !== null && ready === key;
}

/**
 * Calm, non-blocking session notices under the header: the expired sign-in is being renewed
 * (the app keeps working on local data), or the server needs a new sign-in before it accepts
 * changes again (nothing is lost: they stay queued on this device).
 */
export function SessionBanner() {
  const { t } = useTranslation();
  const { session, login } = useAuth();
  const { authRequired } = useSyncStatus();
  const online = useOnline();
  const { pathname, search } = useLocation();
  const renewing = useDelayed(
    online && session !== 'active' ? 'renewing' : null,
    RENEWING_NOTICE_DELAY_MS,
  );

  if (authRequired) {
    return (
      <Alert
        severity="warning"
        sx={{ mx: 2, mb: 1 }}
        action={
          <Button color="inherit" size="small" onClick={() => void login(pathname + search)}>
            {t('auth.signIn')}
          </Button>
        }
      >
        {t('auth.signInAgainToSync')}
      </Alert>
    );
  }
  if (!renewing) return null;
  return (
    <Alert severity="info" role="status" sx={{ mx: 2, mb: 1 }}>
      {t('auth.renewing')}
    </Alert>
  );
}
