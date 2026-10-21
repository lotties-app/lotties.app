import { useTranslation } from 'react-i18next';
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

function summaryKey(created: number, ignored: number) {
  if (created > 0 && ignored > 0) return 'import.confirm.summaryBoth';
  if (created > 0) return 'import.confirm.summaryCreated';
  return ignored > 0 ? 'import.confirm.summaryIgnored' : 'import.confirm.summary';
}

/** Step 4: last look, then the one irreversible-ish action (disabled while it runs). */
export function ConfirmStep({ preview, choices, pending, online, onBack, onImport }: Props) {
  const { t } = useTranslation();
  const events = preview.logs?.toCreate ?? 0;
  const measurements = preview.measurements?.toCreate ?? 0;
  const created = Object.values(choices).filter((c) => c.action === 'create').length;
  const ignored = Object.values(choices).filter((c) => c.action === 'ignore').length;

  return (
    <Stack spacing={2}>
      <Typography>
        {t(summaryKey(created, ignored), {
          events: t('import.confirm.events', { count: events }),
          measurements: t('import.confirm.measurements', { count: measurements }),
          created: t('import.confirm.newMedications', { count: created }),
          ignored: t('import.confirm.ignoredNames', { count: ignored }),
        })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('import.confirm.note')}
      </Typography>
      {pending && <LinearProgress aria-label={t('import.confirm.importing')} />}
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack} disabled={pending} sx={{ minHeight: 48 }}>
          {t('common.back')}
        </Button>
        <Button
          variant="contained"
          onClick={onImport}
          disabled={pending || !online}
          sx={{ minHeight: 48 }}
        >
          {pending ? t('import.confirm.importingEllipsis') : t('import.confirm.import')}
        </Button>
      </Stack>
    </Stack>
  );
}
