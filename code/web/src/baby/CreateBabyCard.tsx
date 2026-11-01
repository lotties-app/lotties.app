import { useTranslation } from 'react-i18next';
import { Alert, Card, Stack, Typography } from '@mui/material';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import { CategoryIcon } from '../ui/CategoryIcon';
import { BabyForm } from './BabyForm';
import { useBabyActions } from './useBabyActions';

/** Now when there is no baby yet: create the first one (needs a connection). */
export function CreateBabyCard() {
  const { t } = useTranslation();
  const { create } = useBabyActions();
  const { run, pending, error, online } = useServerAction();

  return (
    <Card component="section" sx={{ p: 3, my: 2, maxWidth: 420, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <CategoryIcon name="seedling" category="care" size={32} />
          <Typography variant="h4" component="h2">
            {t('baby.noBabyYet')}
          </Typography>
          <Typography color="text.secondary">{t('baby.createPrompt')}</Typography>
        </Stack>
        {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
        <ErrorNotice message={error} />
        <BabyForm
          submitLabel={t('baby.create')}
          disabled={!online}
          pending={pending}
          onSubmit={(request) => void run(() => create(request))}
        />
      </Stack>
    </Card>
  );
}
