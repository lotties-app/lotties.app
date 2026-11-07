import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { exportBackup } from '../api/backupApi';
import { offlineMessage } from '../api/errorMessages';
import { canWrite } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby } from '../db/models';
import { countUnsyncedMutations } from '../db/outbox';
import { formatNumber } from '../i18n/format';
import { unsyncedChangesLabel } from '../session/usePushThenProceed';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { useOnline } from '../sync/useOnline';
import { Icon } from '../ui/Icon';
import { backupFileName, describeBackupError, saveBlob } from './backupModel';
import { babyShownName } from '../baby/shownName';

type Phase = 'idle' | 'sending' | 'exporting' | 'done';

/** Binary units keep the conventional `KB`/`MB` labels; only the number is localized. */
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
  const megabytes = formatNumber(bytes / 1024 / 1024, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${megabytes} MB`;
}

/**
 * "Export data" (Hub > App): downloads everything the app stores about the baby as one backup file.
 * The server builds the file, so first the changes still waiting on this device are sent; when some
 * cannot be sent the person chooses to export without them. Owners and Parents only.
 */
export function ExportSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const online = useOnline();
  const [compress, setCompress] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [unsent, setUnsent] = useState(0);
  const [saved, setSaved] = useState<{ name: string; size: number } | null>(null);
  const busy = phase === 'sending' || phase === 'exporting';

  if (!canWrite(baby)) {
    return <Typography color="text.secondary">{t('backup.export.blocked')}</Typography>;
  }

  const run = async (skipSend: boolean) => {
    if (!online) return setError(offlineMessage());
    setError(null);
    setSaved(null);
    try {
      if (!skipSend) {
        setPhase('sending');
        await engine.syncNow();
        const left = await countUnsyncedMutations(db, baby.id);
        if (left > 0) {
          setUnsent(left);
          return setPhase('idle');
        }
      }
      setUnsent(0);
      setPhase('exporting');
      const file = await exportBackup(api, baby.id, compress);
      const name = backupFileName(babyShownName(baby), new Date(), compress);
      await saveBlob(file, name);
      setSaved({ name, size: file.size });
      setPhase('done');
    } catch (e) {
      setError(describeBackupError(e));
      setPhase('idle');
    }
  };

  return (
    <Stack spacing={2}>
      <Typography>{t('backup.export.intro', { name: babyShownName(baby) })}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('backup.export.includes')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('backup.export.excludes')}
      </Typography>
      <Alert severity="info">{t('backup.privacy')}</Alert>
      {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      <ErrorNotice message={error} />
      {unsent > 0 && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void run(true)} disabled={busy}>
              {t('backup.export.exportAnyway')}
            </Button>
          }
        >
          {t('backup.export.unsent', { changes: unsyncedChangesLabel(unsent) })}
        </Alert>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={compress}
            onChange={(e) => setCompress(e.target.checked)}
            disabled={busy}
          />
        }
        label={t('backup.export.compress')}
        sx={{ minHeight: 44 }}
      />
      <Button
        variant="contained"
        startIcon={<Icon name="archive" />}
        onClick={() => void run(false)}
        disabled={busy || !online}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('backup.export.button')}
      </Button>
      {busy && (
        <>
          <LinearProgress aria-label={t('backup.export.working')} />
          <Typography role="status" variant="body2" color="text.secondary">
            {phase === 'sending' ? t('backup.export.sending') : t('backup.export.working')}
          </Typography>
        </>
      )}
      {saved && (
        <Alert severity="success" role="status">
          {t('backup.export.saved', { name: saved.name, size: formatSize(saved.size) })}
        </Alert>
      )}
    </Stack>
  );
}
