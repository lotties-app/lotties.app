import { useTranslation } from 'react-i18next';
import { Alert, Stack, Typography } from '@mui/material';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import { BabyForm } from './BabyForm';
import { useBabyActions } from './useBabyActions';

/** Home empty state: create the first baby (needs a connection). */
export function CreateBabyCard() {
  const { t } = useTranslation();
  const { create } = useBabyActions();
  const { run, pending, error, online } = useServerAction();

  return (
    <Stack spacing={2} sx={{ py: 4, maxWidth: 420, mx: 'auto' }}>
      <Typography variant="h6" component="h2" sx={{ textAlign: 'center' }}>
        {t('baby.noBabyYet')}
      </Typography>
      <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
        {t('baby.createPrompt')}
      </Typography>
      {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      <ErrorNotice message={error} />
      <BabyForm
        submitLabel={t('baby.create')}
        disabled={!online}
        pending={pending}
        onSubmit={(request) => void run(() => create(request))}
      />
    </Stack>
  );
}
