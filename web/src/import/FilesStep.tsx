import { Button, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { MAX_IMPORT_LABEL, type FileKind, type PickedFiles } from './importModel';

const KINDS: { kind: FileKind; label: string; hint: string }[] = [
  { kind: 'logs', label: 'logs CSV', hint: 'Events: feedings, sleep, diapers, medicine' },
  { kind: 'measurements', label: 'measurements CSV', hint: 'Weight, height, head circumference' },
];

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Choose one or both Napper export files (up to {MAX_IMPORT_LABEL} each). Importing the same
        file again is safe: records that already exist are skipped, nothing is duplicated.
      </Typography>
      {KINDS.map(({ kind, label, hint }) => {
        const file = files[kind];
        return (
          <Stack key={kind} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              sx={{ minHeight: 48, flexShrink: 0 }}
            >
              Choose {label}
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
              {file ? `${file.name} (${formatSize(file.size)})` : hint}
            </Typography>
            {file && (
              <IconButton aria-label={`Remove ${file.name}`} onClick={() => onRemove(kind)}>
                <CloseIcon />
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
        Preview import
      </Button>
    </Stack>
  );
}
