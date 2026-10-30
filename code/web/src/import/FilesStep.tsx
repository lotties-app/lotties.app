import { useTranslation } from 'react-i18next';
import { Button, IconButton, Stack, Typography } from '@mui/material';
import { formatNumber } from '../i18n/format';
import { MAX_IMPORT_LABEL, type FileKind, type PickedFiles } from './importModel';
import { Icon } from '../ui/Icon';

const KINDS: FileKind[] = ['logs', 'measurements'];

/** Binary units keep the conventional `KB`/`MB` labels; only the number is localized. */
function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
  const megabytes = formatNumber(bytes / 1024 / 1024, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${megabytes} MB`;
}

interface Props {
  files: PickedFiles;
  onPick: (kind: FileKind, file: File) => void;
  onRemove: (kind: FileKind) => void;
  onPreview: () => void;
  pending: boolean;
}

/** Step 1: pick the logs and/or measurements export. */
export function FilesStep({ files, onPick, onRemove, onPreview, pending }: Props) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('import.files.intro', { limit: MAX_IMPORT_LABEL })}
      </Typography>
      {KINDS.map((kind) => {
        const file = files[kind];
        return (
          <Stack key={kind} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              component="label"
              variant="outlined"
              startIcon={<Icon name="upload-file" />}
              sx={{ minHeight: 48, flexShrink: 0, maxWidth: '100%' }}
            >
              {kind === 'logs'
                ? t('import.files.chooseLogs')
                : t('import.files.chooseMeasurements')}
              <input
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = '';
                  if (picked) onPick(kind, picked);
                }}
              />
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {file
                ? t('import.files.fileLabel', { name: file.name, size: formatSize(file.size) })
                : kind === 'logs'
                  ? t('import.files.logsHint')
                  : t('import.files.measurementsHint')}
            </Typography>
            {file && (
              <IconButton
                aria-label={t('import.files.remove', { name: file.name })}
                onClick={() => onRemove(kind)}
              >
                <Icon name="close" />
              </IconButton>
            )}
          </Stack>
        );
      })}
      <Button
        variant="contained"
        onClick={onPreview}
        disabled={pending || (!files.logs && !files.measurements)}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('import.files.preview')}
      </Button>
    </Stack>
  );
}
