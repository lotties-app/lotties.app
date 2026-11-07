import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ACCOUNT_DELETION_PREVIEW_KEY,
  deleteAccount,
  getDeletionPreview,
  identityOutcome,
  type AccountDeletionBaby,
  type IdentityRemoval,
} from '../account/accountApi';
import { downloadAccountData } from '../account/exportAccountData';
import { downloadProfessionalData } from '../account/exportProfessionalData';
import { useApiClient } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import { countUnsyncedMutations } from '../db/outbox';
import { releaseThisDevice } from '../notifications/pushActions';
import { useSignOut } from '../session/useSignOut';
import { unsyncedChangesLabel } from '../session/usePushThenProceed';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';
import { babyShownName } from '../baby/shownName';

function BabyList({ title, babies }: { title?: string; babies: AccountDeletionBaby[] }) {
  if (babies.length === 0) return null;
  return (
    <Stack>
      {title && <Typography variant="subtitle2">{title}</Typography>}
      <List dense disablePadding>
        {babies.map((baby) => (
          <ListItem key={baby.id} disableGutters>
            {babyShownName(baby)}
          </ListItem>
        ))}
      </List>
    </Stack>
  );
}

/** What the sign-in account outcome tells the user after the deletion; nothing when it is gone. */
const IDENTITY_NOTICE = {
  removed: null,
  not_configured: 'account.identityKept',
  failed: 'account.identityFailed',
} as const satisfies Record<IdentityRemoval, string | null>;

/**
 * Where the section is shown: the family's Settings (`family`, the default: the download is what
 * the device holds) or the doctor's shell (`professional`: the download is only what she produced,
 * never her patients' records, and the privacy link stays inside /doctor).
 */
export type AccountSectionVariant = 'family' | 'professional';

/** Settings > Account and data: download your data, then delete the account (store requirement). Online only. */
export function DeleteAccountSection({ variant = 'family' }: { variant?: AccountSectionVariant }) {
  const professional = variant === 'professional';
  const { t } = useTranslation();
  const db = useDatabase();
  const api = useApiClient();
  const engine = useSyncEngine();
  const queryClient = useQueryClient();
  const { signOut } = useSignOut();
  const action = useServerAction();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [exportFailed, setExportFailed] = useState<string | null>(null);
  const [finished, setFinished] = useState<IdentityRemoval | null>(null);
  const unsynced = useLiveQuery(() => countUnsyncedMutations(db), [db]) ?? 0;
  const preview = useQuery({
    queryKey: ACCOUNT_DELETION_PREVIEW_KEY,
    queryFn: () => getDeletionPreview(api),
    enabled: open && action.online,
    gcTime: 0,
  });

  const close = () => {
    setOpen(false);
    setUnderstood(false);
    action.clearError();
  };

  const download = async () => {
    if (!professional) {
      setExportFailed((await downloadAccountData(db)) ? null : t('account.exportFailed'));
      return;
    }
    try {
      setExportFailed((await downloadProfessionalData(db, api)) ? null : t('account.exportFailed'));
    } catch {
      setExportFailed(t('account.exportProfessionalFailed'));
    }
  };

  const confirm = async () => {
    engine.stop();
    await engine.whenIdle();
    const ok = await action.run(async () => {
      // Best effort and before the delete: afterwards the request would provision a new, empty user.
      await releaseThisDevice(api)().catch(() => undefined);
      setFinished(identityOutcome(await deleteAccount(api)));
    });
    if (!ok) {
      engine.start();
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_DELETION_PREVIEW_KEY });
    }
  };

  const data = preview.data;
  const blocked = (data?.blockedBabies.length ?? 0) > 0;
  const identityNotice = finished ? IDENTITY_NOTICE[finished] : null;

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">{t('account.intro')}</Typography>
      <Link
        component={RouterLink}
        to={professional ? '/doctor/privacy' : '/hub/privacy'}
        sx={{
          alignSelf: 'flex-start',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {t('account.privacy')}
      </Link>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2">
          {t(professional ? 'account.exportHintProfessional' : 'account.exportHint')}
        </Typography>
        <Button variant="outlined" onClick={() => void download()}>
          {t('account.export')}
        </Button>
        {exportFailed && <ErrorNotice message={exportFailed} />}
      </Stack>
      <Button
        color="error"
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(true)}
      >
        {t('account.delete')}
      </Button>
      {open && (
        <Dialog open onClose={finished ? undefined : close} fullWidth maxWidth="sm">
          <DialogTitle>{finished ? t('account.doneTitle') : t('account.confirmTitle')}</DialogTitle>
          <DialogContent>
            {finished ? (
              <Stack spacing={2}>
                <Typography>{t('account.doneBody')}</Typography>
                {identityNotice && <Alert severity="warning">{t(identityNotice)}</Alert>}
              </Stack>
            ) : (
              <Stack spacing={2}>
                {!action.online && <Alert severity="warning">{t('errors.offline')}</Alert>}
                {preview.isError && <ErrorNotice message={t('account.previewFailed')} />}
                {data && (
                  <>
                    <BabyList title={t('account.willDelete')} babies={data.deletedBabies} />
                    <BabyList title={t('account.willLeave')} babies={data.sharedBabies} />
                    {blocked && (
                      <Alert severity="error">
                        <Typography variant="body2" gutterBottom>
                          {t('account.blocked')}
                        </Typography>
                        <BabyList babies={data.blockedBabies} />
                      </Alert>
                    )}
                    <Typography variant="body2">{t('account.whatElse')}</Typography>
                    <Typography variant="body2">
                      {t(
                        data.identityRemovable
                          ? 'account.identityWillGo'
                          : 'account.identityWillStay',
                      )}
                    </Typography>
                    {unsynced > 0 && (
                      <Alert severity="warning">
                        {t('account.unsynced', { changes: unsyncedChangesLabel(unsynced) })}
                      </Alert>
                    )}
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={understood}
                          onChange={(e) => setUnderstood(e.target.checked)}
                        />
                      }
                      label={t('account.understand')}
                    />
                  </>
                )}
                {action.error && <ErrorNotice message={action.error} />}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            {finished ? (
              <Button onClick={() => void signOut()}>{t('account.finish')}</Button>
            ) : (
              <>
                <Button onClick={close}>{t('common.cancel')}</Button>
                <Button
                  color="error"
                  onClick={() => void confirm()}
                  disabled={!data?.canDelete || !understood || action.pending}
                >
                  {t('account.confirm')}
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
