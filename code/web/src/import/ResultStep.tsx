import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Typography } from '@mui/material';
import type { NapperImportResultDto } from '../sync/contract';
import { EnrichSummary } from './EnrichSummary';

/** Step 5: what was created. */
export function ResultStep({
  result,
  onReset,
}: {
  result: NapperImportResultDto;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const skipped = (result.logs?.skipped ?? 0) + (result.measurements?.skipped ?? 0);
  const existing =
    (result.logs?.alreadyImported ?? 0) + (result.measurements?.alreadyImported ?? 0);
  return (
    <Stack spacing={2}>
      <Alert severity="success">
        {t('import.result.imported', {
          events: t('import.confirm.events', { count: result.eventsCreated }),
          measurements: t('import.confirm.measurements', { count: result.measurementsCreated }),
        })}
      </Alert>
      <EnrichSummary count={result.eventsEnriched} fields={result.enrichedFields} done />
      {result.createdMedications.length > 0 && (
        <Typography>
          {t('import.result.newMedications', {
            names: result.createdMedications.map((m) => m.name).join(', '),
          })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('import.result.existing', { count: existing })}{' '}
        {t('import.result.skippedRows', { count: skipped })} {t('import.result.refreshing')}
      </Typography>
      <Button onClick={onReset} sx={{ minHeight: 48, alignSelf: 'flex-start' }}>
        {t('import.result.another')}
      </Button>
    </Stack>
  );
}
