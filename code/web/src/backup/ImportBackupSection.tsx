import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { importBackup, previewBackup, type BackupTarget } from '../api/backupApi';
import { offlineMessage } from '../api/errorMessages';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { canWrite } from '../baby/permissions';
import type { Baby } from '../db/models';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { useOnline } from '../sync/useOnline';
import { Icon } from '../ui/Icon';
import { BackupReport } from './BackupReport';
import {
  MAX_UPLOAD_LABEL,
  changesNothing,
  describeBackupError,
  prepareUpload,
  type BackupReportDto,
  type PreparedUpload,
} from './backupModel';

type Mode = 'restore' | 'merge';
type Busy = 'reading' | 'previewing' | 'importing' | null;

interface Picked {
  name: string;
  upload: PreparedUpload;
}

function targetOf(mode: Mode, baby: Baby | undefined): BackupTarget | null {
  if (mode === 'restore') return { kind: 'restore' };
  return baby ? { kind: 'merge', babyId: baby.id } : null;
}

/**
 * "Import backup" (Hub > App): reads a backup file this app exported, shows what importing it would do
 * (a dry run on the server, nothing is saved), and only then, on confirmation, imports it. Into a new
 * baby of the person (anyone) or into the selected baby (Owners and Parents). Importing the same file
 * again changes nothing.
 */
export function ImportBackupSection({ baby }: { baby: Baby | undefined }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const engine = useSyncEngine();
  const { select } = useSelectedBaby();
  const online = useOnline();
  const mergeBaby = baby && canWrite(baby) ? baby : undefined;
  const [mode, setMode] = useState<Mode>('restore');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [preview, setPreview] = useState<BackupReportDto | null>(null);
  const [done, setDone] = useState<BackupReportDto | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveMode: Mode = mergeBaby ? mode : 'restore';

  const check = async (upload: PreparedUpload, forMode: Mode) => {
    const target = targetOf(forMode, mergeBaby);
    if (!target) return;
    if (!online) return setError(offlineMessage());
    setBusy('previewing');
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewBackup(api, target, upload.body, upload.contentType));
    } catch (e) {
      setError(describeBackupError(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (file: File) => {
    setDone(null);
    setPreview(null);
    setPicked(null);
    setBusy('reading');
    setError(null);
    try {
      const upload = await prepareUpload(file);
      if (!upload) {
        setBusy(null);
        return setError(t('backup.errors.tooLarge', { limit: MAX_UPLOAD_LABEL }));
      }
      setPicked({ name: file.name, upload });
      await check(upload, effectiveMode);
    } catch {
      setError(t('backup.import.readFailed', { name: file.name }));
      setBusy(null);
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    setDone(null);
    if (picked) void check(picked.upload, next);
  };

  const confirm = async () => {
    const target = targetOf(effectiveMode, mergeBaby);
    if (!picked || !target) return;
    if (!online) return setError(offlineMessage());
    setBusy('importing');
    setError(null);
    try {
      const report = await importBackup(api, target, picked.upload.body, picked.upload.contentType);
      setDone(report);
      setPreview(null);
      setPicked(null);
      // The records arrive on this device through the normal sync.
      await engine.syncNow();
    } catch (e) {
      setError(describeBackupError(e));
    } finally {
      setBusy(null);
    }
  };

  const importing = busy === 'importing';
  return (
    <Stack spacing={2}>
      <Typography>{t('backup.import.intro')}</Typography>
      <Alert severity="info">{t('backup.privacy')}</Alert>
      {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      <ErrorNotice message={error} />

      {mergeBaby && (
        <FormControl>
          <FormLabel id="backup-mode-label">{t('backup.import.modeLabel')}</FormLabel>
          <RadioGroup
            aria-labelledby="backup-mode-label"
            value={effectiveMode}
            onChange={(e) => changeMode(e.target.value as Mode)}
          >
            <FormControlLabel
              value="restore"
              control={<Radio />}
              label={t('backup.import.modeRestore')}
              disabled={busy !== null}
              sx={{ minHeight: 44 }}
            />
            <FormControlLabel
              value="merge"
              control={<Radio />}
              label={t('backup.import.modeMerge', { name: mergeBaby.name })}
              disabled={busy !== null}
              sx={{ minHeight: 44 }}
            />
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            {effectiveMode === 'restore'
              ? t('backup.import.restoreHint')
              : t('backup.import.mergeHint', { name: mergeBaby.name })}
          </Typography>
        </FormControl>
      )}
      {!mergeBaby && (
        <Typography variant="body2" color="text.secondary">
          {t('backup.import.restoreHint')}
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          component="label"
          variant="outlined"
          startIcon={<Icon name="upload-file" />}
          disabled={busy !== null || !online}
          sx={{ minHeight: 48, flexShrink: 0, maxWidth: '100%' }}
        >
          {t('backup.import.choose')}
          <input
            hidden
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void pick(file);
            }}
          />
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {picked ? picked.name : t('backup.import.hint', { limit: MAX_UPLOAD_LABEL })}
        </Typography>
      </Stack>

      {busy && (
        <>
          <LinearProgress aria-label={t(`backup.import.busy.${busy}`)} />
          <Typography role="status" variant="body2" color="text.secondary">
            {t(`backup.import.busy.${busy}`)}
          </Typography>
        </>
      )}

      {preview && !done && (
        <Stack spacing={2}>
          <Alert severity={preview.canImport ? 'success' : 'warning'}>
            {preview.canImport ? t('backup.import.previewNotice') : t('backup.import.cannotImport')}
          </Alert>
          {preview.mode === 'restore' && preview.babyExists && (
            <Alert severity="info">{t('backup.import.alreadyRestored')}</Alert>
          )}
          <BackupReport report={preview} />
          {preview.canImport && changesNothing(preview) && (
            <Typography role="status">{t('backup.import.nothingToDo')}</Typography>
          )}
          <Button
            variant="contained"
            onClick={() => void confirm()}
            disabled={busy !== null || !online || !preview.canImport || changesNothing(preview)}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {effectiveMode === 'restore'
              ? t('backup.import.confirmRestore')
              : t('backup.import.confirmMerge', { name: mergeBaby?.name ?? '' })}
          </Button>
        </Stack>
      )}

      {done && !importing && (
        <Stack spacing={2}>
          <Alert severity="success" role="status">
            {done.mode === 'restore'
              ? t('backup.import.doneRestore')
              : t('backup.import.doneMerge')}
          </Alert>
          <BackupReport report={done} />
          <Button
            component={RouterLink}
            to="/"
            variant="outlined"
            onClick={() => done.mode === 'restore' && select(done.babyId)}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {t('backup.import.open')}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
