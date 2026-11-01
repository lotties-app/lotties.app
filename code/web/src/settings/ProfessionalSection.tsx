import { useTranslation } from 'react-i18next';
import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { ProfessionalProfileForm } from '../professional/ProfessionalProfileForm';
import { useProfessionalProfile } from '../professional/professionalApi';
import { SelfDeclaredBadge } from '../professional/DoctorName';
import { useOnline } from '../sync/useOnline';
import { ErrorNotice } from './ErrorNotice';

/**
 * Settings > "I'm a healthcare professional": any user declares (or edits) her professional profile,
 * which a Doctor invite needs (docs/design/16-doctor-access.md). Online only.
 */
export function ProfessionalSection() {
  const { t } = useTranslation();
  const online = useOnline();
  const profile = useProfessionalProfile();

  if (!online && profile.data === undefined) {
    return <Alert severity="warning">{t('errors.offline')}</Alert>;
  }
  if (profile.isError) return <ErrorNotice message={t('doctor.profile.loadFailed')} />;
  if (profile.data === undefined) return <CircularProgress aria-label={t('common.loading')} />;

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">{t('doctor.profile.intro')}</Typography>
      {profile.data && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">{t('doctor.profile.declared')}</Typography>
          <SelfDeclaredBadge verified={profile.data.verified} />
        </Stack>
      )}
      <ProfessionalProfileForm initial={profile.data} />
    </Stack>
  );
}
