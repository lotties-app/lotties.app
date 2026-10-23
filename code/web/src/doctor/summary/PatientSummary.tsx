import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { useMedications } from '../../db/hooks';
import { useNow } from '../../events/time';
import { formatDate, formatRelative } from '../../i18n/format';
import { isOwnNote, timelineOf } from '../../notes/noteModel';
import { useNotes } from '../../notes/useNotes';
import { usePatientBaby } from '../DoctorDashboardContext';
import { LeavePatient } from '../LeavePatient';
import { NotShared } from '../PatientRoute';
import { hasScope, type DoctorScope } from '../scopes';
import { useClinicalSummary, usePatientEventTypes, type SummaryRange } from '../useDoctorData';
import { SummarySection } from './SummaryKit';
import {
  DiaperSection,
  FeedingSection,
  FormulasSection,
  GrowthSection,
  MedicationsSection,
  NotesSection,
  SleepSection,
  SymptomsSection,
  VaccinesSection,
} from './SummarySections';
import {
  isRangeKind,
  isValidRange,
  notesInRange,
  RANGE_KINDS,
  rangeFor,
  type RangeKind,
} from './summaryRange';
import type { IconName } from '../../ui/icons';
import type { CategoryName } from '../../theme/tokens';

function CustomRange({
  initial,
  onApply,
}: {
  initial: SummaryRange;
  onApply: (range: SummaryRange) => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = isValidRange({ from, to });
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <TextField
        type="date"
        size="small"
        label={t('doctorDashboard.summary.from')}
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        error={!valid}
      />
      <TextField
        type="date"
        size="small"
        label={t('doctorDashboard.summary.to')}
        value={to}
        onChange={(event) => setTo(event.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        error={!valid}
        helperText={valid ? null : t('doctorDashboard.summary.rangeInvalid')}
      />
      <Button
        variant="contained"
        disabled={!valid}
        onClick={() => onApply({ from, to })}
        sx={{ minHeight: 40 }}
      >
        {t('doctorDashboard.summary.apply')}
      </Button>
    </Box>
  );
}

const SCOPE_CARDS: Partial<Record<DoctorScope, { icon: IconName; category: CategoryName }>> = {
  daily_log: { icon: 'calendar', category: 'care' },
  medications: { icon: 'pill', category: 'health' },
  vaccines: { icon: 'vaccine', category: 'health' },
  growth: { icon: 'ruler', category: 'activity' },
  notes: { icon: 'note', category: 'health' },
  formulas: { icon: 'flask', category: 'feeding' },
};

function NotSharedCard({ scope }: { scope: DoctorScope }) {
  const { t } = useTranslation();
  const visual = SCOPE_CARDS[scope] ?? { icon: 'lock' as IconName, category: 'custom' as const };
  return (
    <SummarySection
      id={`off-${scope}`}
      title={t(`doctorDashboard.scopes.titles.${scope}`)}
      icon={visual.icon}
      category={visual.category}
    >
      <NotShared scope={scope} compact />
    </SummarySection>
  );
}

/**
 * `/doctor/:babyId`: one overview of the patient (docs/design/19-doctor-dashboard.md section 5.2).
 * The server computes every number (the same rules as the parents' Insights) for the chosen period;
 * each shared section shows its numbers or "No data in this period", each other section says it was
 * not shared. Notes come from the device (the doctor's own notes sync).
 */
export function PatientSummary() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  const clock = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const notes = useNotes(baby.id);
  const medications = useMedications(baby.id);
  const types = usePatientEventTypes(baby).data;
  const today = useMemo(() => new Date(clock), [clock]);

  const lastNoteAt = useMemo(() => {
    const own = timelineOf(notes ?? []).filter((note) => isOwnNote(baby, note));
    return own[0]?.createdAt ?? null;
  }, [notes, baby]);
  const requested = params.get('range');
  const kind: RangeKind = isRangeKind(requested) ? requested : 'last7';
  const custom = { from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const range = rangeFor(kind, today, { lastNoteAt, custom }) ?? rangeFor('last7', today) ?? custom;
  const [editingCustom, setEditingCustom] = useState(kind === 'custom');
  const summary = useClinicalSummary(baby, range);
  const data = summary.data;

  const choose = (next: RangeKind) => {
    if (next === 'custom') {
      setEditingCustom(true);
      return;
    }
    setEditingCustom(false);
    setParams(next === 'last7' ? {} : { range: next }, { replace: true });
  };
  const applyCustom = (next: SummaryRange) =>
    setParams({ range: 'custom', from: next.from, to: next.to }, { replace: true });

  const shared = (scope: DoctorScope) => hasScope(baby, scope);
  const notesShared = shared('notes');
  const offScopes = (
    ['daily_log', 'medications', 'vaccines', 'growth', 'notes', 'formulas'] as const
  ).filter((scope) => !shared(scope));

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h4" component="h1">
          {t('doctorDashboard.sections.summary')}
        </Typography>
        <Typography color="text.secondary">{t('doctorDashboard.onlyShared')}</Typography>
      </Stack>
      <Box
        role="group"
        aria-label={t('doctorDashboard.summary.range')}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {RANGE_KINDS.map((option) => {
          const selected = editingCustom ? option === 'custom' : option === kind;
          const disabled = option === 'sinceNote' && (!notesShared || !lastNoteAt);
          return (
            <Button
              key={option}
              size="small"
              disabled={disabled}
              variant={selected ? 'contained' : 'outlined'}
              disableElevation
              aria-pressed={selected}
              onClick={() => choose(option)}
              sx={{ minHeight: 36, borderRadius: '999px', px: 1.75, textTransform: 'none' }}
            >
              {t(`doctorDashboard.summary.ranges.${option}`)}
            </Button>
          );
        })}
      </Box>
      {editingCustom && <CustomRange initial={range} onApply={applyCustom} />}
      <Typography variant="body2" color="text.secondary">
        {t('doctorDashboard.summary.rangeText', {
          from: formatDate(range.from, 'dayMonthYear'),
          to: formatDate(range.to, 'dayMonthYear'),
        })}
        {data &&
          Number.isFinite(Date.parse(data.generatedAt)) &&
          ` · ${t('doctorDashboard.summary.updated', {
            when: formatRelative(Math.min(Date.parse(data.generatedAt), clock), clock),
          })}`}
      </Typography>
      {!summary.isFetching && summary.isError && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void summary.refetch()}>
              {t('doctorDashboard.patients.retry')}
            </Button>
          }
        >
          {t('doctorDashboard.summary.loadFailed')}
        </Alert>
      )}
      {summary.fetchStatus === 'idle' && !data && !summary.isError && (
        <Alert severity="info">{t('doctorDashboard.summary.offline')}</Alert>
      )}
      {!data && summary.isPending && summary.fetchStatus !== 'idle' ? (
        <Box
          role="status"
          aria-busy="true"
          aria-label={t('common.loading')}
          sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}
        >
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="rounded" height={220} />
          ))}
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            alignItems: 'start',
            opacity: summary.isPlaceholderData ? 0.6 : 1,
            transition: 'opacity 150ms',
          }}
        >
          {data?.sleep && <SleepSection sleep={data.sleep} today={data.today} />}
          {data?.feeding && <FeedingSection feeding={data.feeding} today={data.today} />}
          {data?.diapers && <DiaperSection diapers={data.diapers} today={data.today} />}
          {data?.symptoms && <SymptomsSection items={data.symptoms.items} types={types} />}
          {data?.medications && (
            <MedicationsSection medications={data.medications} catalog={medications} />
          )}
          {data?.vaccines && <VaccinesSection vaccines={data.vaccines} />}
          {data?.growth && <GrowthSection baby={baby} measurements={data.growth.measurements} />}
          {notesShared && (
            <NotesSection baby={baby} notes={notesInRange(baby, notes ?? [], range)} />
          )}
          {data?.formulas && <FormulasSection formulas={data.formulas} />}
          {offScopes.map((scope) => (
            <NotSharedCard key={scope} scope={scope} />
          ))}
        </Box>
      )}
      <LeavePatient baby={baby} />
    </Stack>
  );
}
