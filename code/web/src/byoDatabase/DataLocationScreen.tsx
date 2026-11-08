import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import { Alert, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import type { Baby } from '../db/models';
import { BackToHostedAction, SavedStoreActions } from './StoreActions';
import { DataLocationChoice } from './DataLocationChoice';
import { isFeatureHidden, type DataStoreStatus, type DataStoreView } from './dataStoreApi';
import { HEALTH_SEVERITY, storeHealthOf } from './storeMessages';
import { SetupWizard } from './SetupWizard';
import { StoreStatusBanner } from './StoreStatusBanner';
import { UpdateConnectionDetails } from './UpdateConnectionDetails';
import { useDataStore } from './useDataStore';

/** A store Lotties cannot use right now (the banner is a warning or an error). */
const isTroubled = (store: DataStoreStatus): boolean =>
  ['warning', 'error'].includes(HEALTH_SEVERITY[storeHealthOf(store)]);

/**
 * The records are in the family's own database: how it is doing, new connection details when the
 * old ones stopped working, and the way back (which needs the database readable, so a troubled
 * store says to fix the connection first).
 */
function OwnStoreView({ babyId, view }: { babyId: string; view: DataStoreView }) {
  const { t } = useTranslation();
  const troubled = !!view.store && isTroubled(view.store);
  return (
    <Stack spacing={2}>
      {view.store && <StoreStatusBanner store={view.store} />}
      {view.store?.providerLabel && (
        <Typography variant="body2">
          {t('byoDatabase.status.provider', { provider: view.store.providerLabel })}
        </Typography>
      )}
      <UpdateConnectionDetails babyId={babyId} providerLabel={view.store?.providerLabel ?? null} />
      <DataLocationChoice current="own" />
      {troubled && <Alert severity="info">{t('byoDatabase.update.moveOutHint')}</Alert>}
      <BackToHostedAction babyId={babyId} />
    </Stack>
  );
}

/** The records are with Lotties: the choice, a saved database if any, and the setup wizard. */
function HostedView({ babyId, view }: { babyId: string; view: DataStoreView }) {
  const { t } = useTranslation();
  const [wizard, setWizard] = useState(false);
  const saved = view.store?.hasDescriptor ? view.store : null;
  return (
    <Stack spacing={2}>
      <DataLocationChoice current="hosted" />
      {saved && !wizard && (
        <Stack spacing={1}>
          <Typography variant="subtitle1" component="h3">
            {t('byoDatabase.status.savedTitle')}
          </Typography>
          <StoreStatusBanner store={saved} />
          {isTroubled(saved) && (
            <UpdateConnectionDetails babyId={babyId} providerLabel={saved.providerLabel} />
          )}
          <SavedStoreActions
            babyId={babyId}
            ready={saved.lastCheckResult === 'ok' || saved.state === 'ready'}
          />
        </Stack>
      )}
      {wizard ? (
        <SetupWizard babyId={babyId} onClose={() => setWizard(false)} />
      ) : (
        <Button
          variant="contained"
          onClick={() => setWizard(true)}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t(saved ? 'byoDatabase.actions.replace' : 'byoDatabase.actions.setUp')}
        </Button>
      )}
    </Stack>
  );
}

/**
 * Settings > Where your data lives (docs/design/47-bring-your-own-database.md section 8): the person
 * keeps using Lotties as before; only where the baby's care records are stored changes. Owner only;
 * a 404 (the feature is off for her) sends her back to Settings, which shows no entry.
 */
export function DataLocationScreen({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const query = useDataStore(baby);
  if (query.isError && isFeatureHidden(query.error)) return <Navigate to="/settings" replace />;
  return (
    <Stack spacing={2}>
      <Typography variant="body1">{t('byoDatabase.intro')}</Typography>
      {query.isPending && query.fetchStatus === 'idle' && (
        <Alert severity="info">{t('byoDatabase.offline')}</Alert>
      )}
      {query.isPending && query.fetchStatus !== 'idle' && (
        <CircularProgress aria-label={t('common.loading')} />
      )}
      {query.isError && <Alert severity="error">{t('byoDatabase.loadFailed')}</Alert>}
      {query.data?.kind === 'own' && <OwnStoreView babyId={baby.id} view={query.data} />}
      {query.data?.kind === 'hosted' && <HostedView babyId={baby.id} view={query.data} />}
      <Link
        component={RouterLink}
        to="/help/own-database"
        sx={{ alignSelf: 'flex-start', py: 0.75 }}
      >
        {t('byoDatabase.help.link')}
      </Link>
    </Stack>
  );
}
