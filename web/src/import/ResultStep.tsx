import { Alert, Button, Stack, Typography } from '@mui/material';
import type { NapperImportResultDto } from '../sync/contract';

/** Step 5: what was created. */
export function ResultStep({
  result,
  onReset,
}: {
  result: NapperImportResultDto;
  onReset: () => void;
}) {
  const skipped = (result.logs?.skipped ?? 0) + (result.measurements?.skipped ?? 0);
  const existing =
    (result.logs?.alreadyImported ?? 0) + (result.measurements?.alreadyImported ?? 0);
  return (
    <Stack spacing={2}>
      <Alert severity="success">
        Imported {result.eventsCreated} event{result.eventsCreated === 1 ? '' : 's'} and{' '}
        {result.measurementsCreated} measurement{result.measurementsCreated === 1 ? '' : 's'}.
      </Alert>
      {result.createdMedications.length > 0 && (
        <Typography>
          New medications: {result.createdMedications.map((m) => m.name).join(', ')}.
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {existing} record{existing === 1 ? ' was' : 's were'} already imported and {skipped} row
        {skipped === 1 ? ' was' : 's were'} skipped. Your timeline is refreshing now.
      </Typography>
      <Button onClick={onReset} sx={{ minHeight: 48, alignSelf: 'flex-start' }}>
        Import another file
      </Button>
    </Stack>
  );
}
