import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { BabyAvatar } from '../baby/BabyAvatar';
import { useNow } from '../events/time';
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatRelative,
  formatUnit,
} from '../i18n/format';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { clinicalAge } from './clinicalAge';
import { lastSectionOf, patientPath, PATIENT_SORTS, type PatientSort } from './dashboardStorage';
import type { DoctorPatient } from './doctorApi';
import { useDoctorDashboard } from './DoctorDashboardContext';
import { quietDays } from './patientCards';
import { matchesName } from './useDoctorData';

const decimal = (value: number) => formatNumber(value, { maximumFractionDigits: 1 });

function Stat({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="p" noWrap>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, fontVariantNumeric: 'lining-nums tabular-nums' }}
      >
        {value}
      </Typography>
      {detail && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
        >
          {detail}
        </Typography>
      )}
    </Box>
  );
}

function WeekStats({ patient }: { patient: DoctorPatient }) {
  const { t } = useTranslation();
  const week = patient.week;
  const perDay = (value: string) => t('doctorDashboard.summary.perDay', { value });
  const sleep =
    week?.sleepMinutesPerDay != null
      ? perDay(formatDuration(week.sleepMinutesPerDay * 60_000))
      : '–';
  const feeds = week?.feedsPerDay != null ? perDay(decimal(week.feedsPerDay)) : '–';
  const ml =
    week?.bottleMlPerDay != null
      ? perDay(formatUnit(Math.round(week.bottleMlPerDay), 'milliliter'))
      : null;
  const diapers = week?.diapersPerDay != null ? perDay(decimal(week.diapersPerDay)) : '–';
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
        {t('doctorDashboard.card.week')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
        <Stat label={t('doctorDashboard.card.sleep')} value={sleep} />
        <Stat label={t('doctorDashboard.card.feeds')} value={feeds} detail={ml} />
        <Stat label={t('doctorDashboard.card.diapers')} value={diapers} />
      </Box>
    </Box>
  );
}

function PatientCard({ patient, now }: { patient: DoctorPatient; now: number }) {
  const { t } = useTranslation();
  const dailyLog = patient.scopes.includes('daily_log');
  const growth = patient.scopes.includes('growth');
  const quiet = dailyLog ? quietDays(patient.lastEventAt, now) : null;
  const activity = !dailyLog
    ? t('doctorDashboard.card.dailyLogOff')
    : patient.lastEventAt
      ? t('doctorDashboard.card.lastLog', {
          when: formatRelative(Date.parse(patient.lastEventAt), now),
        })
      : t('doctorDashboard.card.noLogs');
  const flags = [
    ...(patient.pendingProposals
      ? [
          patient.pendingProposals === 1
            ? t('doctorDashboard.card.proposalPending')
            : t('doctorDashboard.card.proposalsPending', { number: patient.pendingProposals }),
        ]
      : []),
    ...(patient.vaccinesDue
      ? [t('doctorDashboard.card.vaccinesDue', { count: patient.vaccinesDue })]
      : []),
  ];
  const to = patientPath(patient.babyId, lastSectionOf(patient.babyId));

  return (
    <Paper
      component="li"
      sx={(theme) => ({
        position: 'relative',
        listStyle: 'none',
        borderRadius: `${RADIUS.card}px`,
        p: 2,
        display: 'grid',
        gap: 1.5,
        alignContent: 'start',
        '&:focus-within': { outline: `2px solid ${palette(theme).primary.main}` },
      })}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <BabyAvatar id={patient.babyId} name={patient.name} />
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2" noWrap>
            <Box
              component={Link}
              to={to}
              sx={{
                color: 'inherit',
                textDecoration: 'none',
                outline: 'none',
                // The whole card opens the patient (the name is the link's text).
                '&::after': { content: '""', position: 'absolute', inset: 0 },
              }}
            >
              {patient.name}
            </Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {clinicalAge(patient.birthDate, new Date(now))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {activity}
          </Typography>
        </Stack>
        <Icon name="chevron-right" />
      </Box>
      {quiet !== null && (
        <Chip
          size="small"
          variant="outlined"
          icon={<Icon name="info" size={16} />}
          label={t('doctorDashboard.card.quiet', { count: quiet })}
          sx={{ justifySelf: 'start' }}
        />
      )}
      {dailyLog && <WeekStats patient={patient} />}
      {growth && (
        <Stat
          label={t('doctorDashboard.card.weight')}
          value={
            patient.latestWeight
              ? t('doctorDashboard.card.weightOn', {
                  weight: formatUnit(patient.latestWeight.weightKg, 'kilogram'),
                  date: formatDate(patient.latestWeight.date, 'dayMonth'),
                })
              : t('doctorDashboard.card.noWeight')
          }
        />
      )}
      {flags.length > 0 && (
        <Box
          component="ul"
          aria-label={t('doctorDashboard.card.flags')}
          sx={{ m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 0.75, listStyle: 'none' }}
        >
          {flags.map((flag) => (
            <Box component="li" key={flag}>
              <Chip size="small" color="primary" variant="outlined" label={flag} />
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

function EmptyPatients() {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 5, textAlign: 'center' }}>
      <CategoryIcon name="stethoscope" category="health" size={32} />
      <Typography variant="h6" component="h2">
        {t('doctorDashboard.patients.emptyTitle')}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 460 }}>
        {t('doctorDashboard.patients.emptyBody')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
        {t('doctorDashboard.patients.emptyProfile')}
      </Typography>
      <Button component={Link} to="/doctor/settings#professional" sx={{ minHeight: 44 }}>
        {t('doctor.profile.sectionTitle')}
      </Button>
    </Box>
  );
}

/**
 * `/doctor`: the doctor's Patients home (docs/design/19-doctor-dashboard.md section 5.1). One card
 * per patient with age, the last log (a calm flag after a few quiet days), the last seven days per
 * day, the latest weight and small notices, each only for the sections the family shared. Search
 * and sort (recent activity, name, age); the sort is also the switcher's order.
 */
export function PatientsHome({ initialNow }: { initialNow?: number }) {
  const { t } = useTranslation();
  const { patients, sort, setSort, loading, failed, online, refresh } = useDoctorDashboard();
  const clock = useNow(60_000);
  const now = initialNow ?? clock;
  const [search, setSearch] = useState('');
  const shown = patients?.filter((patient) => matchesName(patient.name, search));

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1">
          {t('doctorDashboard.patients.title')}
        </Typography>
        <Typography color="text.secondary">{t('doctorDashboard.onlyShared')}</Typography>
      </Stack>
      {!online && <Alert severity="info">{t('doctorDashboard.patients.offline')}</Alert>}
      {online && failed && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={refresh} sx={{ minHeight: 40 }}>
              {t('doctorDashboard.patients.retry')}
            </Button>
          }
        >
          {t('doctorDashboard.patients.loadFailed')}
        </Alert>
      )}
      {!patients ? (
        <Stack spacing={1.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton variant="rounded" height={180} />
          <Skeleton variant="rounded" height={180} />
        </Stack>
      ) : patients.length === 0 ? (
        <EmptyPatients />
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              type="search"
              size="small"
              label={t('doctorDashboard.patients.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: '1 1 220px' }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Icon name="search" size={20} />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              select
              size="small"
              label={t('doctorDashboard.patients.sort')}
              value={sort}
              onChange={(event) => setSort(event.target.value as PatientSort)}
              sx={{ flex: '0 1 200px', minWidth: 170 }}
            >
              {PATIENT_SORTS.map((option) => (
                <MenuItem key={option} value={option}>
                  {t(`doctorDashboard.patients.sorts.${option}`)}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
            {loading
              ? t('common.loading')
              : t('doctorDashboard.patients.count', { count: shown?.length ?? 0 })}
          </Typography>
          {shown && shown.length === 0 ? (
            <Typography color="text.secondary">
              {t('doctorDashboard.patients.noMatch', { search: search.trim() })}
            </Typography>
          ) : (
            <Box
              component="ul"
              aria-label={t('doctorDashboard.patients.list')}
              sx={{
                m: 0,
                p: 0,
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
              }}
            >
              {shown?.map((patient) => (
                <PatientCard key={patient.babyId} patient={patient} now={now} />
              ))}
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
