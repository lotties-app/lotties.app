import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert, Box, Button, ButtonBase, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { BabyAvatar } from '../baby/BabyAvatar';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useDatabase } from '../db/DatabaseContext';
import { useNow } from '../events/time';
import { formatAge, formatRelative } from '../i18n/format';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { markPatientChosen, patientRows, type PatientRow } from './patientsModel';

function PatientCard({
  row,
  now,
  onOpen,
  onNotes,
}: {
  row: PatientRow;
  now: number;
  onOpen: () => void;
  onNotes: () => void;
}) {
  const { t } = useTranslation();
  const { baby, lastEventAt, sharedNotes } = row;
  const last = lastEventAt
    ? t('doctor.patients.lastEntry', { when: formatRelative(Date.parse(lastEventAt), now) })
    : t('doctor.patients.noEntries');
  return (
    <Paper
      component="li"
      sx={{ borderRadius: `${RADIUS.card}px`, overflow: 'hidden', listStyle: 'none' }}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={t('doctor.patients.open', { name: baby.name })}
        sx={{
          width: '100%',
          p: 2,
          display: 'flex',
          gap: 1.5,
          justifyContent: 'flex-start',
          textAlign: 'start',
        }}
      >
        <BabyAvatar id={baby.id} name={baby.name} />
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2">
            {baby.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatAge(baby.birthDate, new Date(now))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {last}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('doctor.patients.sharedNotes', { count: sharedNotes })}
          </Typography>
        </Stack>
        <Icon name="chevron-right" />
      </ButtonBase>
      <Box sx={{ px: 2, pb: 1.5 }}>
        <Button
          size="small"
          startIcon={<Icon name="note" size={20} />}
          onClick={onNotes}
          sx={{ minHeight: 44 }}
          aria-label={t('doctor.patients.notesOf', { name: baby.name })}
        >
          {t('doctor.notes.title')}
        </Button>
      </Box>
    </Paper>
  );
}

/**
 * `/patients` (docs/design/16-doctor-access.md): the babies the user follows as their Doctor, with
 * age, the latest entry and how many shared notes she wrote. Opening one selects it into the usual
 * read-only views (Now, Day, Insights); the add button stays hidden for her.
 */
export function PatientsScreen({ initialNow }: { initialNow?: number }) {
  const { t } = useTranslation();
  const db = useDatabase();
  const navigate = useNavigate();
  const { select } = useSelectedBaby();
  const clock = useNow(60_000);
  const now = initialNow ?? clock;
  const rows = useLiveQuery(() => patientRows(db), [db]);

  const open = (babyId: string, to: string) => {
    select(babyId);
    markPatientChosen();
    navigate(to);
  };

  return (
    <Stack spacing={2.5}>
      <Stack>
        <Typography variant="h4" component="h1">
          {t('doctor.patients.title')}
        </Typography>
        <Typography color="text.secondary">{t('doctor.patients.subtitle')}</Typography>
      </Stack>
      {!rows ? (
        <Stack spacing={1.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={120} />
        </Stack>
      ) : rows.length === 0 ? (
        <Alert severity="info">{t('doctor.patients.none')}</Alert>
      ) : (
        <Stack
          component="ul"
          spacing={1.5}
          sx={{ p: 0, m: 0 }}
          aria-label={t('doctor.patients.list')}
        >
          {rows.map((row) => (
            <PatientCard
              key={row.baby.id}
              row={row}
              now={now}
              onOpen={() => open(row.baby.id, '/')}
              onNotes={() => open(row.baby.id, '/notes')}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
