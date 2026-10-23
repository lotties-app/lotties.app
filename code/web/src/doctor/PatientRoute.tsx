import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { rememberVisit, sectionOfPath } from './dashboardStorage';
import { PatientContext } from './DoctorDashboardContext';
import { hasScope, type DoctorScope } from './scopes';
import { useDoctorBabies } from './useDoctorData';
import type { Baby } from '../db/models';
import type { ReactNode } from 'react';

/**
 * `/doctor/:babyId/*`: resolves the patient from the device (a baby the user follows as its
 * Doctor), remembers the visit (last patient, last section, recents) and renders the section. An
 * unknown id (access removed, a mistyped link) gets a way back to the Patients list.
 */
export function PatientRoute() {
  const { t } = useTranslation();
  const { babyId } = useParams();
  const { pathname } = useLocation();
  const section = sectionOfPath(pathname);
  const babies = useDoctorBabies();
  const baby = babies?.find((candidate) => candidate.id === babyId);

  useEffect(() => {
    if (baby) rememberVisit(baby.id, section);
  }, [baby, section]);

  if (!babies) {
    return (
      <Stack spacing={1.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={48} />
        <Skeleton variant="rounded" height={160} />
      </Stack>
    );
  }
  if (!baby) {
    return (
      <Stack spacing={2} sx={{ py: 3, maxWidth: 520 }}>
        <Typography variant="h5" component="h1">
          {t('doctorDashboard.patients.title')}
        </Typography>
        <Alert severity="info">{t('doctorDashboard.patient.notFound')}</Alert>
        <Button
          component={Link}
          to="/doctor"
          variant="contained"
          startIcon={<Icon name="arrow-left" size={20} />}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          {t('doctorDashboard.patient.back')}
        </Button>
      </Stack>
    );
  }
  return (
    <PatientContext value={baby}>
      <Outlet />
    </PatientContext>
  );
}

/** "Not shared with you": the family did not share the section `scope`. */
export function NotShared({ scope, compact = false }: { scope: DoctorScope; compact?: boolean }) {
  const { t } = useTranslation();
  const body = t('doctorDashboard.notShared.body', {
    section: t(`doctorDashboard.scopes.names.${scope}`),
  });
  if (compact) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('doctorDashboard.notShared.title')}
      </Typography>
    );
  }
  return (
    <Box
      sx={{ display: 'grid', justifyItems: 'center', gap: 1, py: 4, px: 2, textAlign: 'center' }}
    >
      <CategoryIcon name="lock" category="health" size={24} />
      <Typography variant="h6" component="p">
        {t('doctorDashboard.notShared.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
        {body}
      </Typography>
    </Box>
  );
}

/**
 * Renders `children` when the family shares `scope` with the user, else the page `title` and
 * "Not shared with you".
 */
export function WhenShared({
  baby,
  scope,
  title,
  children,
}: {
  baby: Baby;
  scope: DoctorScope;
  title: string;
  children: ReactNode;
}) {
  if (hasScope(baby, scope)) return children;
  return (
    <Stack spacing={1}>
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      <NotShared scope={scope} />
    </Stack>
  );
}
