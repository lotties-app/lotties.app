import { useTranslation } from 'react-i18next';
import { Alert, Chip, Stack, Typography } from '@mui/material';
import { BabyForm } from '../baby/BabyForm';
import { isOwner } from '../baby/permissions';
import { useBabyActions } from '../baby/useBabyActions';
import type { Baby } from '../db/models';
import { formatDate } from '../i18n/format';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';

/** Baby details (editable by the Owner) and the current user's role. */
export function BabySection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const { update } = useBabyActions();
  const { run, pending, error, online } = useServerAction();
  const owner = isOwner(baby);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography>{t('settings.baby.role')}</Typography>
        <Chip
          label={t(`baby.roles.${baby.role}`)}
          size="small"
          color={owner ? 'primary' : 'default'}
        />
      </Stack>
      {!owner && <Typography color="text.secondary">{t('settings.baby.ownerOnly')}</Typography>}
      {owner && !online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      <ErrorNotice message={error} />
      {owner ? (
        <BabyForm
          key={`${baby.name}|${baby.birthDate}`}
          initial={{ name: baby.name, birthDate: baby.birthDate }}
          submitLabel={t('settings.baby.save')}
          disabled={!online}
          pending={pending}
          onSubmit={(request) => void run(() => update(baby.id, request))}
        />
      ) : (
        <Stack>
          <Typography variant="subtitle1">{baby.name}</Typography>
          <Typography color="text.secondary">
            {t('settings.baby.born', { date: formatDate(baby.birthDate) })}
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
