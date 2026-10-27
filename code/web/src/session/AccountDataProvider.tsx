import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import { Box, CircularProgress } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { useConsent } from '../consent/ConsentContext';
import { releaseThisDevice } from '../notifications/pushActions';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { SyncProvider } from '../sync/SyncProvider';
import type { SyncEngineOptions } from '../sync/SyncEngine';
import { deleteLegacyDatabase, openAccountDatabase } from './accountDatabase';
import { AccountSessionContext, type AccountSession } from './AccountSessionContext';
import { claimDeviceState } from './deviceState';
import { endAccountSession } from './endSession';

type EngineOverrides = Omit<SyncEngineOptions, 'db' | 'api' | 'getAccessToken'>;

interface Props {
  syncOptions?: EngineOverrides;
  children: ReactNode;
}

/**
 * Opens the signed-in account's local database and sync engine. While signed out (or while auth
 * is still resolving) there is no database at all: the children render without one, and every
 * screen that needs it sits behind `RequireAuth`. Another account gets another database (the
 * subtree is keyed by account), so data and queues never cross users.
 */
export function AccountDataProvider({ syncOptions, children }: Props) {
  const { isAuthenticated, accountId } = useAuth();
  if (!isAuthenticated || !accountId) return children;
  return (
    <AccountData key={accountId} accountId={accountId} syncOptions={syncOptions}>
      {children}
    </AccountData>
  );
}

function AccountData({ accountId, syncOptions, children }: Props & { accountId: string }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const api = useApiClient();
  const consent = useConsent();
  const [ending, setEnding] = useState(false);
  // Claimed before the first render of the children, so they never read the previous account's
  // saved selection. Idempotent, so a StrictMode double call is harmless.
  const [db] = useState(() => {
    const database = openAccountDatabase(accountId);
    claimDeviceState(database.name);
    return database;
  });

  useEffect(() => {
    void deleteLegacyDatabase();
    // Keep auto-open so a StrictMode remount (same instance) can reopen the store.
    return () => db.close({ disableAutoOpen: false });
  }, [db]);

  const session: AccountSession = {
    end: async () => {
      // Unmount every screen first, so no live query touches the database while it is deleted.
      flushSync(() => setEnding(true));
      await endAccountSession(db, logout, releaseThisDevice(api));
    },
  };

  if (ending) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress aria-label={t('auth.signingOut')} />
      </Box>
    );
  }
  return (
    <AccountSessionContext value={session}>
      <DatabaseProvider db={db}>
        <SyncProvider options={syncOptions} enabled={consent.syncAllowed}>
          {children}
        </SyncProvider>
      </DatabaseProvider>
    </AccountSessionContext>
  );
}
