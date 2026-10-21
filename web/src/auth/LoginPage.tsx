import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Box, Button, Container, Typography } from '@mui/material';
import Dexie from 'dexie';
import { createDatabase } from '../db/database';
import { countUnsyncedMutations } from '../db/outbox';
import { unsyncedChangesLabel } from '../session/usePushThenProceed';
import { readEndedSession } from './endedSession';
import { useAuth } from './useAuth';
import type { LoginRedirectState } from './loginRedirect';

/**
 * Unsynced changes left in the database of a session that ended (`null` while counting or when
 * unknown). The database is only read: it stays for the next sign-in of the same account.
 */
function useEndedSessionUnsynced(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const name = readEndedSession();
    if (!name) return;
    let cancelled = false;
    void (async () => {
      if (!(await Dexie.exists(name).catch(() => false))) return;
      const db = createDatabase(name);
      try {
        const unsynced = await countUnsyncedMutations(db);
        if (!cancelled) setCount(unsynced);
      } catch {
        // Unreadable store: the generic notice is enough.
      } finally {
        db.close();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

function EndedSessionNotice() {
  const { t } = useTranslation();
  const unsynced = useEndedSessionUnsynced();
  return (
    <Alert severity="info" sx={{ mb: 2, textAlign: 'start' }}>
      {unsynced
        ? t('auth.unsyncedKept', { changes: unsyncedChangesLabel(unsynced) })
        : t('auth.signInAgainToSync')}
    </Alert>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading, error, login, sessionEnded } = useAuth();
  const from = (useLocation().state as LoginRedirectState | null)?.from ?? '/';

  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <Container maxWidth="xs" sx={{ minHeight: '100dvh', display: 'grid', alignContent: 'center' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {t('app.name')}
        </Typography>
        {sessionEnded && <EndedSessionNotice />}
        {error && !sessionEnded && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('auth.signInFailed')}
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={isLoading}
          onClick={() => void login(from)}
          sx={{ minHeight: 56 }}
        >
          {t('auth.signIn')}
        </Button>
      </Box>
    </Container>
  );
}
