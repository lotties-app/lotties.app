import { Button, LinearProgress, Stack, Typography } from '@mui/material';
import type { NapperPreviewDto } from '../sync/contract';
import type { Choices } from './importModel';

interface Props {
  preview: NapperPreviewDto;
  choices: Choices;
  pending: boolean;
  online: boolean;
  onBack: () => void;
  onImport: () => void;
}

/** Step 4: last look, then the one irreversible-ish action (disabled while it runs). */
export function ConfirmStep({ preview, choices, pending, online, onBack, onImport }: Props) {
  const events = preview.logs?.toCreate ?? 0;
  const measurements = preview.measurements?.toCreate ?? 0;
  const created = Object.values(choices).filter((c) => c.action === 'create').length;
  const ignored = Object.values(choices).filter((c) => c.action === 'ignore').length;

  return (
    <Stack spacing={2}>
      <Typography>
        Ready to import {events} event{events === 1 ? '' : 's'} and {measurements} measurement
        {measurements === 1 ? '' : 's'}
        {created > 0 && `, creating ${created} new medication${created === 1 ? '' : 's'}`}
        {ignored > 0 && ` (${ignored} medication name${ignored === 1 ? '' : 's'} ignored)`}.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Everything is saved together or not at all. Importing the same file again later is safe:
        nothing is duplicated, and events you deleted are not brought back.
      </Typography>
      {pending && <LinearProgress aria-label="Importing" />}
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack} disabled={pending} sx={{ minHeight: 48 }}>
          Back
        </Button>
        <Button
          variant="contained"
          onClick={onImport}
          disabled={pending || !online}
          sx={{ minHeight: 48 }}
        >
          {pending ? 'Importing…' : 'Import'}
        </Button>
      </Stack>
    </Stack>
  );
}
